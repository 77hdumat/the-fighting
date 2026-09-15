// Specials.js — 캐릭터 고유기 키프레임/효과 테이블.
// body(p, wind, strike, sgn): 팔 외 몸 전체 보정. wind/strike 는 0..1 진행 강도, sgn = 왼팔 -1 / 오른팔 +1 (상체 회전 부호)
export const SPECIALS = {
  // ---- IPPO ----
  gazelle: {
    name: 'ガゼルパンチ', ko: '가젤 펀치', side: 'L', dur: 0.6, power: 1.5, cd: 7, heavy: true, launch: 0.75, staggerT: 1.4, step: 2.2,
    wind: { x: 0.6, y: 0.9, z: 0.9, el: -2.2 }, strike: { x: -2.0, y: -1.1, z: 1.25, el: -1.0 },
    body(p, w, s, sgn) {
      p.hipsY += -0.4 * w + 0.36 * s; p.waistX += 0.5 * w - 0.3 * s;
      p.thighLX += -0.55 * w + 0.4 * s; p.thighRX += -0.55 * w + 0.4 * s; p.shinL += 1.0 * w - 0.4 * s; p.shinR += 1.0 * w - 0.4 * s;
      p.waistY += sgn * (0.5 * w - 0.9 * s); p.chestY += sgn * (0.3 * w - 0.6 * s); p.headX += -0.35 * s; p.hipsZ += 0.25 * s;
    },
  },
  liver: {
    name: 'リバーブロー', ko: '리버 블로', side: 'L', dur: 0.42, power: 1.2, cd: 6, heavy: true, zone: 'body', liver: true, staggerT: 1.6, step: 2.6,
    wind: { x: 0.3, y: 0.7, z: 0.8, el: -2.0 }, strike: { x: 0.35, y: -1.45, z: 1.15, el: -0.85 },
    body(p, w, s, sgn) {
      p.hipsY += -0.22 * w - 0.12 * s; p.waistZ += sgn * (0.35 * w); p.waistX += 0.3 * w + 0.35 * s;
      p.waistY += sgn * (0.4 * w - 0.8 * s); p.chestY += sgn * (0.2 * w - 0.5 * s); p.hipsZ += 0.3 * s;
      p.thighLX += -0.3 * w; p.thighRX += -0.3 * w; p.shinL += 0.5 * w; p.shinR += 0.5 * w;
    },
  },
  // ---- MASHIBA ----
  flickerBurst: { name: 'フリッカー連打', ko: '플리커 3연', burst: true, cd: 4.5 },
  chopping: {
    name: 'チョッピングライト', ko: '초핑 라이트', side: 'R', dur: 0.5, power: 1.4, cd: 8, heavy: true, staggerT: 1.2, step: 2.0,
    wind: { x: -2.7, y: 0.5, z: 0.55, el: -1.5 }, strike: { x: -1.15, y: -0.45, z: 0.2, el: -0.15 },
    body(p, w, s, sgn) {
      p.waistX += -0.25 * w + 0.5 * s; p.hipsY += 0.05 * w - 0.15 * s; p.waistY += sgn * (0.35 * w - 0.6 * s);
      p.chestZ += sgn * (-0.2 * w + 0.2 * s); p.headX += -0.2 * w + 0.3 * s; p.hipsZ += 0.2 * s;
    },
  },
  // ---- MIYATA ----
  jolt: {
    name: 'ジョルト', ko: '졸트 카운터', side: 'R', dur: 0.36, power: 1.05, cd: 4, heavy: false, counterMul: 1.4, step: 3.2, quick: true,
    wind: { x: -0.55, y: -0.05, z: 0.1, el: -2.45 }, strike: { x: -1.7, y: -0.2, z: 0.0, el: -0.03 },
    body(p, w, s, sgn) { p.waistY += sgn * (0.25 * w - 0.55 * s); p.waistX += 0.15 * s; p.hipsZ += 0.25 * s; p.hipsY -= 0.1 * s; p.headX += 0.15 * s; },
  },
  backjab: {
    name: 'バックステップジャブ', ko: '백스텝 잽', side: 'L', dur: 0.3, power: 0.6, cd: 3, heavy: false, backstep: 0.28, quick: true,
    wind: { x: -0.6, y: -0.1, z: 0.15, el: -2.4 }, strike: { x: -1.6, y: -0.15, z: 0.05, el: -0.05 },
    body(p, w, s, sgn) { p.waistX += -0.15 * s; p.hipsY -= 0.06 * s; },
  },
  // ---- SENDO ----
  smash: {
    name: 'スマッシュ', ko: '스매시', side: 'R', dur: 0.6, power: 1.7, cd: 9, heavy: true, launch: 0.9, staggerT: 1.5, step: 2.4,
    wind: { x: 0.95, y: -0.5, z: -0.6, el: -1.9 }, strike: { x: -1.75, y: 0.85, z: -1.05, el: -1.1 },
    body(p, w, s, sgn) {
      p.hipsY += -0.38 * w + 0.22 * s; p.waistX += 0.55 * w - 0.2 * s; p.waistZ += sgn * (-0.35 * w + 0.15 * s);
      p.waistY += sgn * (0.55 * w - 1.0 * s); p.chestY += sgn * (0.3 * w - 0.6 * s); p.hipsRotY += sgn * 0.35 * s;
      p.thighLX += -0.5 * w + 0.3 * s; p.thighRX += -0.5 * w + 0.3 * s; p.shinL += 0.9 * w - 0.3 * s; p.shinR += 0.9 * w - 0.3 * s; p.hipsZ += 0.3 * s;
    },
  },
  rush: { name: 'ラッシュ', ko: '러시 3연 훅', burst: true, cd: 6 },
};

// 캐릭터별 키 배정 + 스탠스 + 필살
export const KITS = {
  // cdU: U 반격기 실제 쿨타임(초, 속도 보정 없음). 없으면 spec.cd / sqrt(speedMul)
  ippo:    { stance: 'dempsey', finisher: 'finisherHook', U: 'gazelle', I: 'liver' },
  mashiba: { stance: 'flicker', finisher: 'chopping',     U: 'flickerBurst', I: 'chopping' },
  miyata:  { stance: 'counter', finisher: 'jolt',         U: 'jolt', I: 'backjab', cdU: 3.5 },
  sendo:   { stance: 'smash',   finisher: 'smash',        U: 'smash', I: 'rush', cdU: 10 },
};

export const STANCE_LINES = {
  dempsey: ['デンプシー・ロール…', 'もっと速く…！', 'まだだ…！', 'いけぇぇぇっ！！'],
  flicker: ['フリッカー…', 'もっと鋭く…！', '見えねぇだろ…', '刻めッ！！'],
  counter: ['来い…', '見えてる…', 'そこだ…！', '合わせるッ！！'],
  smash:   ['溜めろ…', 'まだ…！', 'もっとだ…！', 'スマッシュだッ！！'],
};
