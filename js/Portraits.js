// Portraits.js — 캐릭터 선택용 초상 이미지를 '실제 리그'에서 그려 만든다.
// 외부 일러스트를 쓰지 않으므로 인게임 외형과 항상 일치하고, 캐릭터를 고쳐도 따로 손댈 게 없다.
// 별도의 WebGL 컨텍스트를 만들지 않는다 — 게임의 메인 렌더러로 렌더타겟에 그린 뒤 픽셀을 읽어 2D 캔버스에 옮긴다.
// (모바일/인앱 브라우저는 동시 WebGL 컨텍스트 수 제한이 빡빡해서, 컨텍스트를 하나 더 만들면
//  메인 캔버스 컨텍스트가 죽거나 아예 생성 실패("Error creating WebGL context")로 이어질 수 있다.)
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

// 렌더타겟에 그리면 톤매핑/sRGB 변환이 빠져(three 는 화면 출력에만 적용) 인게임과 색이 달라진다.
// 그래서 메인 캔버스에 직접 그리고 같은 태스크 안에서 바로 읽는다 (합성 전이라 preserveDrawingBuffer 없이도 읽힌다).
// 메인 캔버스는 불투명이라 배경을 검정·흰색으로 두 번 그려 차이로 알파를 복원한다 (difference matting).
function readCanvas(renderer, W, H, buf) {
  const gl = renderer.getContext();
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
}
function matteToDataURL(black, white, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const out = img.data;
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W * 4, dst = y * W * 4;   // GL 은 원점이 아래쪽
    for (let x = 0; x < W * 4; x += 4) {
      const br = black[src + x], bg = black[src + x + 1], bb = black[src + x + 2];
      const a = 1 - ((white[src + x] - br) + (white[src + x + 1] - bg) + (white[src + x + 2] - bb)) / (3 * 255);
      const A = a < 0.02 ? 0 : a > 0.98 ? 1 : a;
      // 검정 배경 결과 = 색×알파 → 알파로 나눠 원색 복원
      out[dst + x] = A ? Math.min(255, br / A) : 0;
      out[dst + x + 1] = A ? Math.min(255, bg / A) : 0;
      out[dst + x + 2] = A ? Math.min(255, bb / A) : 0;
      out[dst + x + 3] = Math.round(A * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * 주어진 키들의 초상을 만들어 { key: dataURL } 로 돌려준다.
 * renderer 는 게임의 메인 WebGLRenderer. 이미 만든 것은 캐시에서 재사용하므로 여러 번 불러도 안전하다.
 * 렌더러가 없거나 컨텍스트가 죽어 있으면 초상 없이 (null) 돌려주고, 카드는 이름/능력치만 표시된다.
 */
export function buildPortraits(keys, { renderer = null, w = 240, h = 300 } = {}) {
  const todo = keys.filter((k) => !cache.has(k) && CHARACTERS[k]);
  const ctxOk = renderer && renderer.getContext && !renderer.getContext().isContextLost();
  if (todo.length && ctxOk) {
    const canvas = renderer.domElement;
    // 메인 렌더러 상태를 건드리므로 끝나면 전부 원복한다
    const prev = {
      target: renderer.getRenderTarget(), shadow: renderer.shadowMap.enabled, autoClear: renderer.autoClear,
      clearColor: renderer.getClearColor(new THREE.Color()), clearAlpha: renderer.getClearAlpha(),
      size: renderer.getSize(new THREE.Vector2()), dpr: renderer.getPixelRatio(),
    };
    try {
      const scene = makeScene();
      const camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
      renderer.setRenderTarget(null);
      renderer.shadowMap.enabled = false;
      renderer.autoClear = true;
      renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
      renderer.setSize(w, h, false);          // 드로잉 버퍼만 바꾼다 (CSS 크기는 그대로)
      const W = canvas.width, H = canvas.height;
      const black = new Uint8Array(W * H * 4), white = new Uint8Array(W * H * 4);

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

        renderer.setClearColor(0x000000, 1); renderer.render(scene, camera); readCanvas(renderer, W, H, black);
        renderer.setClearColor(0xffffff, 1); renderer.render(scene, camera); readCanvas(renderer, W, H, white);
        cache.set(key, matteToDataURL(black, white, W, H));

        scene.remove(rig.root);
        rig.root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.dispose) o.geometry.dispose(); });
      }
    } catch (e) {
      // 못 그리는 환경이면 초상 없이 기존 카드로 표시된다
      for (const k of todo) cache.set(k, null);
    } finally {
      renderer.setPixelRatio(prev.dpr);
      renderer.setSize(prev.size.x, prev.size.y, false);
      renderer.setRenderTarget(prev.target);
      renderer.shadowMap.enabled = prev.shadow;
      renderer.autoClear = prev.autoClear;
      renderer.setClearColor(prev.clearColor, prev.clearAlpha);
    }
  }
  const out = {};
  for (const k of keys) out[k] = cache.get(k) || null;
  return out;
}
