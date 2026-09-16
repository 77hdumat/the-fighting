// Portraits.js — 캐릭터 선택용 초상 이미지를 '실제 리그'에서 그려 만든다.
// 외부 일러스트를 쓰지 않으므로 인게임 외형과 항상 일치하고, 캐릭터를 고쳐도 따로 손댈 게 없다.
// 오프스크린 렌더러를 하나 만들어 전원 렌더한 뒤 즉시 정리한다 (WebGL 컨텍스트를 물고 있지 않는다).
import * as THREE from 'three';
import { CHARACTERS, buildBoxer, defaultPose, applyPose } from './Rig.js';

const cache = new Map();

/** 링 조명 근사 — 인게임과 같은 셀 셰이딩 결과가 나오도록 맞춘다 */
function makeScene() {
  const scene = new THREE.Scene();
  const spot = new THREE.SpotLight(0xfff3e2, 240, 0, Math.PI * 0.32, 0.45, 2);
  spot.position.set(0.9, 5.2, 2.4);
  scene.add(spot, spot.target);
  const fillA = new THREE.DirectionalLight(0xbcd0ff, 0.6); fillA.position.set(-3, 2, -2.5);
  const fillB = new THREE.DirectionalLight(0xffd9b0, 0.85); fillB.position.set(2.5, 1.6, 3);
  scene.add(fillA, fillB);
  return scene;
}

/**
 * 주어진 키들의 초상을 만들어 { key: dataURL } 로 돌려준다.
 * 이미 만든 것은 캐시에서 재사용하므로 여러 번 불러도 안전하다.
 */
export function buildPortraits(keys, { w = 240, h = 300 } = {}) {
  const todo = keys.filter((k) => !cache.has(k) && CHARACTERS[k]);
  if (todo.length) {
    let renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
      renderer.setSize(w, h, false);
      renderer.setClearAlpha(0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.95;

      const scene = makeScene();
      const camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);

      for (const key of todo) {
        const def = CHARACTERS[key];
        const rig = buildBoxer(def);
        const pose = defaultPose();
        // 기본 포즈는 글러브를 얼굴 앞까지 올린 가드 자세라 초상에서 얼굴이 가려진다.
        // 팔꿈치를 펴고 어깨를 내려 가슴 높이 가드로 바꾼다 — 얼굴이 보이면서도 복서다운 자세.
        pose.shLX = -0.30; pose.shRX = -0.26;
        pose.elL = -1.50;  pose.elR = -1.55;
        pose.shLZ = 0.34;  pose.shRZ = -0.34;
        pose.headX = 0.02;                    // 턱을 살짝 들어 정면을 본다
        pose.headY = 0.02;
        pose.waistX = 0.06;
        applyPose(rig, pose);
        rig.root.rotation.y = 0.32;           // 살짝 비스듬히 (철권식 3/4 뷰)
        scene.add(rig.root);

        // 머리~가슴 사이를 조준한다. 가슴만 보면 머리가 프레임 위로 잘린다.
        // 캐릭터마다 키가 달라 절대 좌표를 쓰면 안 되고, 본 위치에서 계산해야 한다.
        const head = rig.headMesh.getWorldPosition(new THREE.Vector3());
        const chest = rig.chest.getWorldPosition(new THREE.Vector3());
        const target = head.clone().lerp(chest, 0.45);
        camera.position.set(target.x + 0.34, target.y + 0.10, target.z + 1.58);
        camera.lookAt(target);
        camera.updateProjectionMatrix();
        scene.add(camera);

        renderer.render(scene, camera);
        cache.set(key, renderer.domElement.toDataURL('image/png'));

        scene.remove(rig.root);
        rig.root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.dispose) o.geometry.dispose(); });
      }
    } catch (e) {
      // WebGL 컨텍스트를 더 못 만드는 환경이면 초상 없이 기존 카드로 표시된다
      for (const k of todo) cache.set(k, null);
    } finally {
      if (renderer) { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); }
    }
  }
  const out = {};
  for (const k of keys) out[k] = cache.get(k) || null;
  return out;
}
