// Music.js — 칩튠 BGM (Web Audio 합성, 외부 음원 없음)
// 90년대 스포츠 드라마풍 8비트 록: 펄스 리드 + 펄스 하모니 + 삼각파 베이스 + 노이즈 드럼.
// 원곡 멜로디를 쓰지 않은 오리지널 진행 (Am 계열 질주감).

const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
/** 'A4' → 주파수 */
function hz(n) {
  if (!n || n === '-') return 0;
  const m = /^([A-G]#?)(-?\d)$/.exec(n);
  if (!m) return 0;
  return 440 * Math.pow(2, (NOTE[m[1]] + (+m[2] - 4) * 12 - 9) / 12);
}

// ---- 패턴 (한 칸 = 16분음표, 16칸 = 1마디) ----
// 리드: 메인 테마 (Am - F - C - G / Am - F - G - E7 느낌). 오리지널 라인.
const LEAD_A = [
  'A4', '-', 'C5', 'E5', '-', 'D5', 'C5', '-', 'A4', '-', 'B4', 'C5', '-', 'E5', '-', '-',
  'F4', '-', 'A4', 'C5', '-', 'B4', 'A4', '-', 'G4', '-', 'A4', 'B4', '-', 'C5', '-', '-',
  'C5', '-', 'E5', 'G5', '-', 'F5', 'E5', '-', 'D5', '-', 'C5', 'D5', '-', 'E5', '-', '-',
  'G4', '-', 'B4', 'D5', '-', 'C5', 'B4', '-', 'A4', '-', 'B4', 'C5', '-', 'B4', 'A4', '-',
];
// 리드: 후렴 (더 높고 끈질기게)
const LEAD_B = [
  'E5', 'E5', '-', 'F5', 'E5', '-', 'D5', '-', 'C5', '-', 'D5', 'E5', '-', '-', 'A4', '-',
  'F5', 'F5', '-', 'G5', 'F5', '-', 'E5', '-', 'D5', '-', 'E5', 'F5', '-', '-', 'C5', '-',
  'G5', '-', 'F5', 'E5', '-', 'D5', 'C5', '-', 'B4', '-', 'C5', 'D5', '-', 'E5', '-', '-',
  'A5', '-', '-', 'G5', '-', 'E5', '-', 'D5', 'C5', '-', 'B4', '-', 'A4', '-', '-', '-',
];
// 베이스 (8분 질주)
const BASS_A = [
  'A2', 'A2', 'A3', 'A2', 'A2', 'A2', 'A3', 'A2', 'A2', 'A2', 'A3', 'A2', 'A2', 'A3', 'A2', 'A3',
  'F2', 'F2', 'F3', 'F2', 'F2', 'F2', 'F3', 'F2', 'F2', 'F2', 'F3', 'F2', 'F2', 'F3', 'F2', 'F3',
  'C3', 'C3', 'C4', 'C3', 'C3', 'C3', 'C4', 'C3', 'C3', 'C3', 'C4', 'C3', 'C3', 'C4', 'C3', 'C4',
  'G2', 'G2', 'G3', 'G2', 'G2', 'G2', 'G3', 'G2', 'E2', 'E2', 'E3', 'E2', 'E2', 'E3', 'E2', 'E3',
];
const BASS_B = [
  'A2', 'A2', 'A3', 'A2', 'A2', 'A2', 'A3', 'A2', 'F2', 'F2', 'F3', 'F2', 'F2', 'F2', 'F3', 'F2',
  'D2', 'D2', 'D3', 'D2', 'D2', 'D2', 'D3', 'D2', 'G2', 'G2', 'G3', 'G2', 'G2', 'G2', 'G3', 'G2',
  'C3', 'C3', 'C4', 'C3', 'C3', 'C3', 'C4', 'C3', 'A2', 'A2', 'A3', 'A2', 'A2', 'A2', 'A3', 'A2',
  'F2', 'F2', 'F3', 'F2', 'G2', 'G2', 'G3', 'G2', 'E2', 'E2', 'E3', 'E2', 'E3', 'E3', 'E3', 'E3',
];
// 하모니 (3도/5도 받침, 리드보다 조용)
const HARM_A = LEAD_A.map((n) => (n === '-' ? '-' : n));
// 드럼: k=킥 s=스네어 h=하이햇 (대문자 H = 오픈)
const DRUM = 'k h s h k h s h k h s h k k s H'.split(' ');
const DRUM_FILL = 'k h s h k h s h k h s s s s s H'.split(' ');

// 메뉴/로비용: 느긋한 아르페지오
const MENU_LEAD = [
  'A4', '-', 'E5', '-', 'C5', '-', 'E5', '-', 'F4', '-', 'C5', '-', 'A4', '-', 'C5', '-',
  'G4', '-', 'D5', '-', 'B4', '-', 'D5', '-', 'E4', '-', 'B4', '-', 'G4', '-', 'B4', '-',
];
const MENU_BASS = [
  'A2', '-', '-', '-', '-', '-', '-', '-', 'F2', '-', '-', '-', '-', '-', '-', '-',
  'G2', '-', '-', '-', '-', '-', '-', '-', 'E2', '-', '-', '-', '-', '-', '-', '-',
];

const TRACKS = {
  menu:   { bpm: 104, lead: MENU_LEAD, harm: null, bass: MENU_BASS, drums: false, leadVol: 0.1, duty: 0.5 },
  battle: { bpm: 168, lead: LEAD_A, harm: HARM_A, bass: BASS_A, drums: true, leadVol: 0.13, duty: 0.25 },
  chorus: { bpm: 168, lead: LEAD_B, harm: null, bass: BASS_B, drums: true, leadVol: 0.14, duty: 0.25 },
};

export class Music {
  constructor(audio) {
    this.audio = audio;         // AudioManager (ctx/master 공유)
    this.enabled = true;
    try { this.enabled = localStorage.getItem('dr-bgm') !== 'off'; } catch (e) {}
    this.track = null;          // 'menu' | 'battle' | 'chorus'
    this.timer = null;
    this.step = 0;              // 16분음표 인덱스
    this.bar = 0;
    this.nextTime = 0;
    this.gain = null;
    this.duck = 1;
  }

  get ctx() { return this.audio.ctx; }

  _ensure() {
    const ctx = this.ctx; if (!ctx) return false;
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      // 칩튠은 조금 좁게 — 살짝 로우패스로 찢어짐 완화
      this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 7000;
      this.gain.connect(this.lp); this.lp.connect(this.audio.master);
    }
    return true;
  }

  /** 펄스파 (듀티 사이클) 오실레이터 */
  _pulse(freq, t, dur, vol, duty = 0.5, detune = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    if (duty === 0.5) o.type = 'square';
    else {
      // PeriodicWave 로 듀티 구현 (25% / 12.5%)
      const n = 24, real = new Float32Array(n), imag = new Float32Array(n);
      for (let i = 1; i < n; i++) imag[i] = (2 / (i * Math.PI)) * Math.sin(Math.PI * i * duty);
      o.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    }
    o.frequency.setValueAtTime(freq, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.setValueAtTime(vol, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.gain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _bass(freq, t, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.95);
    o.connect(g); g.connect(this.gain);
    o.start(t); o.stop(t + dur);
  }

  _drum(kind, t) {
    const ctx = this.ctx;
    if (kind === 'k') {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(this.gain); o.start(t); o.stop(t + 0.18);
      return;
    }
    const src = ctx.createBufferSource(); src.buffer = this.audio.noise;
    src.playbackRate.value = kind === 's' ? 1 : 1.8;
    const f = ctx.createBiquadFilter();
    f.type = kind === 's' ? 'bandpass' : 'highpass';
    f.frequency.value = kind === 's' ? 1700 : 7000;
    f.Q.value = kind === 's' ? 1.1 : 0.7;
    const dur = kind === 's' ? 0.13 : kind === 'H' ? 0.12 : 0.035;
    const g = ctx.createGain();
    g.gain.setValueAtTime(kind === 's' ? 0.3 : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.gain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /** 16분음표 한 칸 예약 */
  _schedule(t) {
    const T = TRACKS[this.track]; if (!T) return;
    const i = this.step % T.lead.length;
    const spb = 60 / T.bpm / 4;   // 16분 길이
    const lead = T.lead[i];
    if (lead && lead !== '-') {
      // 다음 쉼표까지 길이 계산 (레가토)
      let len = 1;
      while (len < 8 && T.lead[(i + len) % T.lead.length] === '-') len++;
      const dur = spb * len * 0.92;
      this._pulse(hz(lead), t, dur, T.leadVol, T.duty);
      this._pulse(hz(lead), t, dur, T.leadVol * 0.45, T.duty, 9);   // 디튠 두께
    }
    if (T.harm) {
      const h = T.harm[(i + 8) % T.harm.length];
      if (h && h !== '-') this._pulse(hz(h) / 2, t, spb * 1.6, T.leadVol * 0.3, 0.125);
    }
    const b = T.bass[i % T.bass.length];
    if (b && b !== '-') this._bass(hz(b), t, spb * 1.7, 0.22);
    if (T.drums) {
      const fill = this.bar % 8 === 7;
      const d = (fill ? DRUM_FILL : DRUM)[i % 16];
      if (d && d !== '-') this._drum(d, t);
    }
    this.step++;
    if (this.step % 16 === 0) this.bar++;
    // 전투곡은 4마디 A → 4마디 후렴 교대
    if (T.drums && this.step % T.lead.length === 0) {
      const next = this.track === 'battle' ? 'chorus' : 'battle';
      this.track = next; this.step = 0;
    }
  }

  _tick() {
    const ctx = this.ctx; if (!ctx || !this.track) return;
    const T = TRACKS[this.track];
    const spb = 60 / T.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.25) {
      if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.02;
      this._schedule(this.nextTime);
      this.nextTime += spb;
    }
  }

  /** 트랙 재생 ('menu' | 'battle'). 이미 같은 계열이면 유지 */
  play(name) {
    if (!this.enabled || !this._ensure()) { this.pending = name; return; }
    const want = name === 'battle' ? 'battle' : 'menu';
    const cur = this.track === 'chorus' ? 'battle' : this.track;
    if (cur === want && this.timer) return;
    this.track = want; this.step = 0; this.bar = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(this.vol, t + 0.6);
    clearInterval(this.timer);
    this.timer = setInterval(() => this._tick(), 60);
    this._tick();
  }

  get vol() { return (this.track === 'menu' ? 0.5 : 0.36) * this.duck; }

  stop(fade = 0.5) {
    if (!this.gain) { this.track = null; return; }
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0.0001, t + fade);
    clearInterval(this.timer); this.timer = null;
    setTimeout(() => { if (!this.timer) this.track = null; }, fade * 1000 + 50);
  }

  /** 필살기·KO 연출 때 잠깐 줄이기 */
  setDuck(v) {
    this.duck = v;
    if (this.gain && this.track) {
      const t = this.ctx.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(this.gain.gain.value, t);
      this.gain.gain.linearRampToValueAtTime(this.vol, t + 0.12);
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('dr-bgm', this.enabled ? 'on' : 'off'); } catch (e) {}
    if (!this.enabled) this.stop(0.25);
    else this.play(this.pendingTrack || 'menu');
    return this.enabled;
  }

  /** 오디오 컨텍스트가 늦게 열렸을 때 */
  resumePending() { if (this.pending) { const p = this.pending; this.pending = null; this.play(p); } }
}
