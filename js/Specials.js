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

  // ---- 히든: 채채더킴 ----
  nyangRush: { name: 'にゃんにゃん連打', ko: '냥냥펀치 4연', burst: true, cd: 4 },
  catSlap: {
    name: 'キャットスラップ', ko: '고양이 할퀴기', side: 'R', dur: 0.3, power: 0.85, cd: 5, heavy: false, staggerT: 0.7, step: 3.0, quick: true,
    wind: { x: -0.4, y: 0.5, z: 0.7, el: -2.1 }, strike: { x: -1.5, y: -0.5, z: 0.35, el: -0.2 },
    body(p, w, s, sgn) { p.waistY += sgn * (0.3 * w - 0.6 * s); p.hipsY += 0.08 * w - 0.05 * s; p.headX += -0.12 * s; },
  },
  // ---- 히든: 쩡효 ----
  dumbbell: {
    name: 'ダンベルブロー', ko: '덤벨 훅', side: 'R', dur: 0.5, power: 1.55, cd: 7, heavy: true, staggerT: 1.3, step: 2.1,
    wind: { x: 0.8, y: -0.4, z: -0.5, el: -2.0 }, strike: { x: -1.6, y: 0.5, z: -0.8, el: -0.9 },
    body(p, w, s, sgn) {
      p.hipsY += -0.3 * w + 0.18 * s; p.waistX += 0.45 * w - 0.2 * s; p.waistY += sgn * (0.45 * w - 0.85 * s);
      p.thighLX += -0.4 * w + 0.25 * s; p.thighRX += -0.4 * w + 0.25 * s; p.shinL += 0.7 * w; p.shinR += 0.7 * w; p.hipsZ += 0.25 * s;
    },
  },
  deadlift: {
    name: 'デッドリフト', ko: '데드리프트 업', side: 'L', dur: 0.56, power: 1.35, cd: 8, heavy: true, launch: 0.85, staggerT: 1.4, step: 1.8,
    wind: { x: 0.9, y: 0.3, z: 0.5, el: -2.3 }, strike: { x: -2.1, y: -0.6, z: 0.9, el: -0.6 },
    body(p, w, s, sgn) {
      p.hipsY += -0.5 * w + 0.4 * s; p.waistX += 0.85 * w - 0.5 * s; p.thighLX += -0.7 * w + 0.45 * s; p.thighRX += -0.7 * w + 0.45 * s;
      p.shinL += 1.2 * w - 0.5 * s; p.shinR += 1.2 * w - 0.5 * s; p.chestX += 0.3 * w - 0.25 * s; p.headX += -0.3 * s;
    },
  },
  // ---- 히든: 뼈석원 ----
  boneJab: {
    name: 'ボーンジャブ', ko: '뼈 찌르기', side: 'L', dur: 0.26, power: 0.7, cd: 3.5, heavy: false, quick: true, step: 3.6,
    wind: { x: -0.5, y: -0.1, z: 0.15, el: -2.5 }, strike: { x: -1.75, y: -0.1, z: 0.0, el: 0.05 },
    body(p, w, s, sgn) { p.waistY += sgn * (0.2 * w - 0.5 * s); p.chestX += 0.12 * s; p.hipsZ += 0.2 * s; },
  },
  elbowSpin: {
    name: 'スピンエルボー', ko: '회전 팔꿈치', side: 'R', dur: 0.46, power: 1.3, cd: 7, heavy: true, staggerT: 1.2, step: 2.6,
    wind: { x: -0.3, y: 1.3, z: 0.4, el: -2.4 }, strike: { x: -1.3, y: -1.2, z: 0.4, el: -1.6 },
    body(p, w, s, sgn) { p.waistY += sgn * (1.1 * w - 1.6 * s); p.chestY += sgn * (0.5 * w - 0.8 * s); p.hipsRotY += sgn * (0.4 * w - 0.6 * s); p.hipsY += -0.12 * w; },
  },
};

// 캐릭터별 키 배정 + 스탠스 + 필살
export const KITS = {
  // cdU: U 반격기 실제 쿨타임(초, 속도 보정 없음). 없으면 spec.cd / sqrt(speedMul)
  ippo:    { stance: 'dempsey', finisher: 'finisherHook', U: 'gazelle', I: 'liver' },
  mashiba: { stance: 'flicker', finisher: 'chopping',     U: 'flickerBurst', I: 'chopping' },
  miyata:  { stance: 'counter', finisher: 'jolt',         U: 'jolt', I: 'backjab', cdU: 3.5 },
  sendo:   { stance: 'smash',   finisher: 'smash',        U: 'smash', I: 'rush', cdU: 10 },
  // 히든
  chaechae:  { stance: 'flicker', finisher: 'reels',   U: 'nyangRush', I: 'catSlap', cdU: 4 },
  jjeonghyo: { stance: 'smash',   finisher: 'barbell', U: 'dumbbell',  I: 'deadlift', cdU: 6.5 },
  ppyeo:     { stance: 'counter', finisher: 'bike',    U: 'boneJab',   I: 'elbowSpin', cdU: 3.5 },
};

export const STANCE_LINES = {
  dempsey: ['デンプシー・ロール…', 'もっと速く…！', 'まだだ…！', 'いけぇぇぇっ！！'],
  flicker: ['フリッカー…', 'もっと鋭く…！', '見えねぇだろ…', '刻めッ！！'],
  counter: ['来い…', '見えてる…', 'そこだ…！', '合わせるッ！！'],
  smash:   ['溜めろ…', 'まだ…！', 'もっとだ…！', 'スマッシュだッ！！'],
};

// 히든 캐릭터 전용 대사 (한국어 — 게이지/필살/등장)
export const HIDDEN_LINES = {
  chaechae: { intro: '난 문화생활을 좋아해~', max: '이거 릴스각인데?', fin: '자, 같이 춤춰!', hit: ['냥!', '냥냥!', '이건 찍어야 해'] },
  jjeonghyo: { intro: '3대 500 미만 대화 금지.', max: '무게 올린다.', fin: '데드리프트… 받아!', hit: ['하압!', '한 세트 더!', '가볍네'] },
  ppyeo: { intro: '난 먹어도 살 안 쪄.', max: '시동 건다.', fin: '부아아앙—!!', hit: ['뼈!', '뼈뼈!', '부릉'] },
};
