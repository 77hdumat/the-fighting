import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Retain the gameplay transform hierarchy; draw its rigid parts as one skinned mesh.
// One weight per vertex reproduces existing joint motion without changing topology.
export function batchRig(rig, { ghost = false } = {}) {
  const root = rig.root;
  root.updateMatrixWorld(true);
  const anchors = new Set(Object.values(rig).filter(value => value?.isObject3D));
  const protectedNodes = new Set(ghost ? [] : [rig.gloveL, rig.gloveR]);
  const candidates = [];
  const canMerge = object => object.isMesh && !Array.isArray(object.material) &&
    (object.material.isMeshPhysicalMaterial || (ghost && object.material.isMeshBasicMaterial)) &&
    !object.material.map && (ghost || !object.material.transparent);
  root.traverse(object => {
    if (!canMerge(object)) return;
    for (let parent = object; parent && parent !== root; parent = parent.parent) if (protectedNodes.has(parent)) return;
    // Do not hide retained text planes or transparent accessories under a merged parent.
    let retainedChild = false;
    object.traverse(child => { if (child !== object && child.isMesh && !canMerge(child)) retainedChild = true; });
    if (!retainedChild) candidates.push(object);
  });
  if (candidates.length < 2) return;
  const targets = [], groups = new Map(), inverseRoot = root.matrixWorld.clone().invert();
  const matrix = new THREE.Matrix4();
  for (const object of candidates) {
    let anchor = object;
    while (!anchors.has(anchor)) anchor = anchor.parent;
    let boneIndex = targets.indexOf(anchor);
    if (boneIndex < 0) { boneIndex = targets.length; targets.push(anchor); }
    const material = object.material;
    const key = [material.roughness, material.metalness, material.sheen, material.clearcoat,
      material.clearcoatRoughness, material.side, material.emissive?.getHex()].join(':');
    if (!groups.has(key)) {
      const shared = material.clone(); shared.color.set(0xffffff); shared.sheenColor?.set(0xffffff); shared.vertexColors = true;
      groups.set(key, {material:shared, geometries:[]});
    }
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    matrix.multiplyMatrices(inverseRoot, object.matrixWorld); geometry.applyMatrix4(matrix);
    // All source primitives share only position/normal/uv after this normalization.
    for (const name of Object.keys(geometry.attributes)) if (!['position','normal','uv'].includes(name)) geometry.deleteAttribute(name);
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3), indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      colors[i*3] = material.color.r; colors[i*3+1] = material.color.g; colors[i*3+2] = material.color.b;
      indices[i*4] = boneIndex; weights[i*4] = 1;
    }
    if (!geometry.attributes.uv) geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(count*2),2));
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    geometry.setAttribute('skinIndex',new THREE.BufferAttribute(indices,4));
    geometry.setAttribute('skinWeight',new THREE.BufferAttribute(weights,4));
    groups.get(key).geometries.push(geometry);
  }
  const mergedGroups = [], materials = [];
  for (const group of groups.values()) {
    const geometry = mergeGeometries(group.geometries,false);
    for (const source of group.geometries) source.dispose();
    mergedGroups.push(geometry); materials.push(group.material);
  }
  const geometry = mergeGeometries(mergedGroups,true);
  for (const part of mergedGroups) part.dispose();
  const bones = targets.map(target => { const bone = new THREE.Bone(); bone.matrixAutoUpdate = false; bone.matrixWorld.copy(target.matrixWorld); return bone; });
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(geometry,materials);
  mesh.name = 'Batched boxer'; mesh.castShadow = mesh.receiveShadow = !ghost;
  mesh.frustumCulled = false; // Animated bounds; root is hidden by the game's bench logic.
  mesh.bind(skeleton,root.matrixWorld);
  const sync = () => {
    for (let i=0;i<targets.length;i++) bones[i].matrixWorld.copy(targets[i].matrixWorld);
    skeleton.update();
  };
  mesh.onBeforeRender = sync; mesh.onBeforeShadow = sync;
  root.add(mesh);
  const mergedMaterials = new Set(candidates.map(object=>object.material));
  const retainedMaterials = rig.bodyMats.filter(material=>!mergedMaterials.has(material));
  rig.bodyMats.splice(0,rig.bodyMats.length,...retainedMaterials,...materials);
  for (const object of candidates) object.visible = false;
  // Original meshes remain as lightweight transform anchors, retaining hitbox references.
  rig.batch = {mesh,skeleton,targets,sourceMeshes:candidates};
}
