// Punch.js — 훅 / 스트레이트 팔·상체 애니메이션 (Player, Opponent 공용)

export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
export const clamp01 = (t) => Math.max(0, Math.min(1, t));

// 팔 키프레임 (왼팔 기준, 오른팔은 y/z 부호 반전)
const HOOK_WIND   = { x: -0.25, y: 0.95, z: 1.25, el: -1.9 };
const HOOK_STRIKE = { x: -0.25, y: -1.6, z: 1.25, el: -1.12 };
const STR_WIND    = { x: -0.55, y: -0.15, z: 0.12, el: -2.45 };
const STR_STRIKE  = { x: -1.62, y: -0.15, z: 0.02, el: -0.16 };
// 플리커 잽: 축 늘어진 팔을 채찍처럼 아래에서 위로 후려친다
const FLK_WIND    = { x: 0.35, y: -0.1, z: 0.35, el: -0.35 };
const FLK_STRIKE  = { x: -1.5, y: -0.2, z: 0.2, el: -0.14 };

/** 점 p 와 선분 ab 사이 거리 (몸통 캡슐 판정용) */
export function pointSegmentDist(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 1e-8 ? (apx * abx + apy * aby + apz * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 선분 p1p2 와 선분 q1q2 사이 최소 거리 + 두 번째 선분 위의 최근접 파라미터 t(0..1). 스윕 판정용 */
export function segSegDist(p1, p2, q1, q2, out = {}) {
  const ux = p2.x - p1.x, uy = p2.y - p1.y, uz = p2.z - p1.z;
  const vx = q2.x - q1.x, vy = q2.y - q1.y, vz = q2.z - q1.z;
  const wx = p1.x - q1.x, wy = p1.y - q1.y, wz = p1.z - q1.z;
  const a = ux * ux + uy * uy + uz * uz, b = ux * vx + uy * vy + uz * vz, c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz, e = vx * wx + vy * wy + vz * wz;
  const D = a * c - b * b;
  let sN, sD = D, tN, tD = D;
  if (D < 1e-9) { sN = 0; sD = 1; tN = e; tD = c; }
  else { sN = b * e - c * d; tN = a * e - b * d; if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; } }
  if (tN < 0) { tN = 0; if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; } }
  else if (tN > tD) { tN = tD; if (-d + b < 0) sN = 0; else if (-d + b > a) sN = sD; else { sN = -d + b; sD = a; } }
  const sc = Math.abs(sN) < 1e-9 ? 0 : sN / sD, tc = Math.abs(tN) < 1e-9 ? 0 : tN / tD;
  const dx = wx + ux * sc - vx * tc, dy = wy + uy * sc - vy * tc, dz = wz + uz * sc - vz * tc;
  out.s = sc; out.t = tc;
  out.px = p1.x + ux * sc; out.py = p1.y + uy * sc; out.pz = p1.z + uz * sc;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

import { SPECIALS } from './Specials.js';

export function createPunch(side, type, dur, power = 0.5) {
  return { side, type, dur, power, t: 0, hit: false, done: false };
}

function mirror(k, side) {
  return side === 'L' ? k : { x: k.x, y: -k.y, z: -k.z, el: k.el };
}

/**
 * 펀치 진행도에 따라 pose 에 팔/상체 회전을 덮어쓴다.
 * 반환값: { strike, wind } — 이펙트/히트 판정용 진행 강도
 */
/**
 * 원거리 사격 자세 (우랄라): 양팔을 앞으로 곧게 뻗어 두 손으로 조준한 채 제자리. 쏘는 쪽 팔만 반동으로 살짝 튄다.
 * 펀치 모션 대신 쓰므로 '장풍' 처럼 안 보인다. 반환값은 applyPunchToPose 와 같은 형태.
 */
export function applyAimToPose(pose, punch) {
  const p = clamp01(punch.t / punch.dur);
  // 쌍권총 조준: 양팔을 앞으로 곧게 뻗어 두 총으로 겨눈다 (좌우 개념 없음). 어깨너비보다 살짝 벌려 등 뒤에서도 두 팔이 다 보이게.
  // 현재 값에서 목표로 수렴시켜 어떤 자세(가드)에서 시작해도 팔이 곧게 뻗는다
  const settle = Math.min(1, p / 0.1);
  const to = (k, v) => { pose[k] += (v - pose[k]) * settle; };
  to('shLX', -1.64); to('shRX', -1.64);       // 어깨: 양팔 수평 앞으로
  to('elL', -0.03); to('elR', -0.03);         // 팔꿈치: 쭉 편다
  to('shLY', 0.05); to('shRY', -0.05);
  to('shLZ', 0.3); to('shRZ', -0.3);          // 살짝 벌린다 (V 자)
  // 우아함: 상체를 살짝 세우고 고개를 들며, 한쪽 골반을 내밀고 뒷다리를 편다
  pose.chestX += -0.1 * settle; pose.headX += -0.08 * settle; pose.hipsY += -0.02 * settle;
  pose.hipsX += 0.1 * settle; pose.hipsRotY += 0.12 * settle; pose.waistZ += -0.06 * settle;
  pose.thighLX += -0.12 * settle; pose.thighRX += 0.25 * settle; pose.shinR += 0.1 * settle;
  // 반동: 발사(0.22) 직후 두 팔이 동시에 위로 튀었다가 0.25초 안에 복귀
  const r = p < 0.22 ? 0 : Math.max(0, 1 - (p - 0.22) / 0.4);
  const kick = Math.sin(r * Math.PI);
  pose.shLX += 0.3 * kick; pose.shRX += 0.3 * kick; pose.elL += -0.3 * kick; pose.elR += -0.3 * kick;
  pose.chestX += 0.07 * kick; pose.headX += 0.04 * kick;
  return { p, strike: kick, wind: 0 };
}

export function applyPunchToPose(pose, punch) {
  const p = clamp01(punch.t / punch.dur);
  const side = punch.side;
  const isHook = punch.type === 'hook';
  const isFlk = punch.type === 'flicker';
  const spec = punch.kind ? SPECIALS[punch.kind] : null;
  let wind = spec ? mirror(spec.wind, side) : mirror(isHook ? HOOK_WIND : isFlk ? FLK_WIND : STR_WIND, side);
  let strike = spec ? mirror(spec.strike, side) : mirror(isHook ? HOOK_STRIKE : isFlk ? FLK_STRIKE : STR_STRIKE, side);
  if (punch.heavy) {
    wind = { x: wind.x, y: wind.y * 1.35, z: wind.z * 1.1, el: wind.el };
    strike = { x: strike.x - 0.1, y: strike.y * 1.15, z: strike.z * 1.05, el: strike.el };
  }

  const kx = side === 'L' ? 'shLX' : 'shRX';
  const ky = side === 'L' ? 'shLY' : 'shRY';
  const kz = side === 'L' ? 'shLZ' : 'shRZ';
  const ke = side === 'L' ? 'elL' : 'elR';
  const guard = { x: pose[kx], y: pose[ky], z: pose[kz], el: pose[ke] };

  let from, to, t, windAmt = 0, strikeAmt = 0;
  if (p < 0.3) {             // 와인드업: 팔을 뒤로 당김 (예비동작 — 읽고 막을 시간)
    from = guard; to = wind; t = easeOutQuad(p / 0.3); windAmt = t;
  } else if (p < 0.52) {     // 스트라이크: 빠르게 휘두름
    from = wind; to = strike; t = easeOutCubic((p - 0.3) / 0.22); windAmt = 1 - t; strikeAmt = t;
  } else if (p < 0.62) {     // 임팩트 유지
    from = strike; to = strike; t = 1; strikeAmt = 1;
  } else {                   // 회수
    from = strike; to = guard; t = easeInOut((p - 0.6) / 0.4); strikeAmt = 1 - t;
  }
  pose[kx] = from.x + (to.x - from.x) * t;
  pose[ky] = from.y + (to.y - from.y) * t;
  pose[kz] = from.z + (to.z - from.z) * t;
  pose[ke] = from.el + (to.el - from.el) * t;

  // 상체 연동: 와인드업 때 반대로 감았다가 스트라이크에 강하게 풀림
  const sgn = side === 'L' ? -1 : 1; // 왼쪽 어깨(+X)가 앞으로 나오려면 Y 회전 음수
  if (spec && spec.body) { spec.body(pose, windAmt, strikeAmt, sgn); return { p, strike: strikeAmt, wind: windAmt }; }
  const H = punch.heavy ? 1.6 : 1;    // 뎀프시 훅: 회오리처럼 상체 전체가 돈다
  const twist = (isHook ? 1.0 : 0.6) * H;
  pose.chestY += sgn * (twist * strikeAmt - 0.45 * H * windAmt);
  pose.waistY += sgn * (0.5 * twist * strikeAmt - 0.2 * H * windAmt);
  if (punch.heavy) { pose.hipsRotY += sgn * 0.45 * strikeAmt; pose.waistZ += -sgn * 0.15 * strikeAmt; pose.hipsY -= 0.08 * strikeAmt; }
  pose.waistX += 0.18 * strikeAmt;
  pose.hipsZ += (isHook ? 0.32 : 0.2) * strikeAmt; // 체중을 앞으로 실음 (돌진)
  pose.hipsY -= 0.05 * strikeAmt;
  pose.headY += sgn * 0.25 * strikeAmt;
  pose.headX += 0.1 * strikeAmt;

  // ---- 하체: 도움닫기 (뒷발로 밀고 앞발이 들어간다) ----
  // 와인드업엔 무릎을 굽혀 체중을 뒤로, 타격 순간 뒷발이 펴지며 앞발이 착지한다
  const lead = side === 'L' ? 'L' : 'R';          // 치는 쪽 팔의 반대 발이 앞발
  const frontThigh = lead === 'L' ? 'thighRX' : 'thighLX';
  const backThigh = lead === 'L' ? 'thighLX' : 'thighRX';
  const frontShin = lead === 'L' ? 'shinR' : 'shinL';
  const backShin = lead === 'L' ? 'shinL' : 'shinR';
  const H2 = punch.heavy ? 1.35 : 1;
  // 예비: 살짝 주저앉으며 뒷발에 체중
  pose.hipsY += -0.07 * H2 * windAmt;
  pose[backThigh] += 0.28 * H2 * windAmt;
  pose[backShin] += 0.34 * H2 * windAmt;
  pose[frontThigh] += -0.12 * windAmt;
  // 타격: 뒷발이 쭉 펴지고(푸시) 앞발이 앞으로 들어간다
  pose[backThigh] += 0.42 * H2 * strikeAmt;
  pose[backShin] += -0.18 * strikeAmt;
  pose[frontThigh] += -0.5 * H2 * strikeAmt;
  pose[frontShin] += 0.28 * strikeAmt;
  pose.hipsRotY += sgn * 0.18 * H2 * strikeAmt;   // 골반 회전으로 힘 전달
  pose.hipsX += sgn * 0.05 * strikeAmt;
  if (isHook) {
    pose.waistZ += -sgn * 0.12 * strikeAmt;
    pose.chestZ += -sgn * 0.1 * strikeAmt;
  }
  return { p, strike: strikeAmt, wind: windAmt };
}
