// VoiceManager.js — 캐릭터 음성.
//  1) assets/voice/manifest.json 이 있으면 파일(mp3/ogg/wav) 재생 (키: "dempsey_start", 캐릭터별: "ippo:dempsey_start")
//  2) 없으면 브라우저 일본어 TTS(speechSynthesis) 로 자막 대사를 외치고, 기합/신음은 Web Audio 합성
const TEXT_KEYS = [
  ['デンプシー・ロール', 'dempsey_start'], ['もっと速く', 'faster'], ['まだだ', 'notyet'], ['いけぇ', 'go'],
  ['うおおお', 'finisher'], ['ぶっ飛べ', 'finisher_hit'], ['ダウン', 'down'], ['カウンター', 'counter'],
  ['ファイッ', 'fight'], ['潰す', 'crush'], ['ガード', 'guardbreak'], ['効いてる', 'effective'], ['効かねぇ', 'noeffect'],
];
const PITCH = { ippo: 1.15, miyata: 1.05, mashiba: 0.72, takamura: 0.6, coach: 0.5 };
const RATE = { ippo: 1.3, miyata: 1.25, mashiba: 1.05, takamura: 1.0, coach: 1.15 };

export class VoiceManager {
  constructor(audio) {
    this.audio = audio;
    this.files = {};        // key → AudioBuffer[]
    this.hasFiles = false;
    this.enabled = true;
    this.mode = 'tts';      // 'file' | 'tts' | 'off'
    this.lastGrunt = {};
    this.voice = null;
    this.ttsReady = false;
    this.loadManifest();
    if ('speechSynthesis' in window) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        const ja = vs.filter((v) => /ja/i.test(v.lang));
        const pref = ['Otoya', 'Hattori', 'Google 日本語', 'Microsoft Keita', 'Kyoko', 'O-Ren'];
        this.voice = pref.map((n) => ja.find((v) => v.name.includes(n))).find(Boolean) || ja[0] || null;
        // 한국어 음성 (한글 자막/자기소개용)
        const ko = vs.filter((v) => /ko/i.test(v.lang));
        const prefKo = ['Yuna', 'Google 한국의', 'Microsoft Heami', 'Suhyun', 'Jian'];
        this.voiceKo = prefKo.map((n) => ko.find((v) => v.name.includes(n))).find(Boolean) || ko[0] || null;
        this.ttsReady = !!(this.voice || this.voiceKo);
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    }
  }

  async loadManifest() {
    try {
      const res = await fetch('assets/voice/manifest.json', { cache: 'no-store' });
      if (!res.ok) return;
      const man = await res.json();
      const ctx = () => this.audio.ctx;
      const entries = Object.entries(man);
      for (const [key, val] of entries) {
        const list = Array.isArray(val) ? val : [val];
        this.files[key] = [];
        for (const file of list) {
          try {
            const buf = await (await fetch('assets/voice/' + file)).arrayBuffer();
            // AudioContext 는 사용자 제스처 후 생기므로 디코딩은 지연
            this.files[key].push({ raw: buf, decoded: null });
          } catch (e) { console.warn('voice file missing', file); }
        }
      }
      this.hasFiles = entries.length > 0;
      if (this.hasFiles) this.mode = 'file';
      console.log('[voice] manifest loaded:', entries.length, 'keys');
    } catch (e) { /* manifest 없음 → TTS */ }
  }

  toggle() {
    const order = this.hasFiles ? ['file', 'tts', 'off'] : ['tts', 'off'];
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
    if (this.mode !== 'tts' && 'speechSynthesis' in window) speechSynthesis.cancel();
    return this.mode;
  }

  _lookup(key, charKey) {
    const a = this.files[charKey + ':' + key] || this.files[key];
    return a && a.length ? a[Math.floor(Math.random() * a.length)] : null;
  }

  async _playFile(entry, pitch = 1, vol = 1) {
    const ctx = this.audio.ctx; if (!ctx) return;
    if (!entry.decoded) { try { entry.decoded = await ctx.decodeAudioData(entry.raw.slice(0)); } catch (e) { return; } }
    const src = ctx.createBufferSource();
    src.buffer = entry.decoded;
    src.playbackRate.value = pitch;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(g); g.connect(this.audio.master);
    src.start();
  }

  /** 자막이 표시될 때 호출: 파일 → TTS 순으로 시도 */
  onSubtitle(text, charKey = 'ippo', strong = false) {
    if (this.mode === 'off') return;
    const hit = TEXT_KEYS.find(([t]) => text.includes(t));
    if (this.mode === 'file' && hit) {
      const e = this._lookup(hit[1], charKey);
      if (e) { this._playFile(e, 1, strong ? 1 : 0.85); return; }
    }
    if (!('speechSynthesis' in window) || !this.ttsReady) return;
    // 기호 정리: "いけぇぇぇっ！！" → "いけぇぇぇっ"
    const clean = text.replace(/[…！!？?・\s]+/g, ' ').trim();
    if (!clean) return;
    if (strong) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const isKo = /[\uac00-\ud7a3]/.test(clean);
    if (isKo && this.voiceKo) { u.voice = this.voiceKo; u.lang = 'ko-KR'; }
    else if (isKo) { u.lang = 'ko-KR'; }
    else { u.voice = this.voice; u.lang = 'ja-JP'; }
    u.pitch = (PITCH[charKey] || 1) * (strong ? 0.95 : 1);
    u.rate = (RATE[charKey] || 1.2) * (strong ? 1.1 : 1);
    u.volume = 1;
    speechSynthesis.speak(u);
  }

  /** 코치 외침: 파일(coach:*) → TTS(굵은 저음). 앞에 짧은 호루라기 큐 */
  coach(text) {
    if (this.mode === 'off') return;
    const ctx = this.audio.ctx;
    if (ctx) {
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(2200, t); o.frequency.exponentialRampToValueAtTime(2900, t + 0.08); o.frequency.exponentialRampToValueAtTime(2400, t + 0.16);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(this.audio.master); o.start(t); o.stop(t + 0.2);
    }
    if (this.mode === 'file') { const e = this._lookup('shout', 'coach'); if (e) { this._playFile(e, 1, 1); return; } }
    if (!('speechSynthesis' in window) || !this.ttsReady) return;
    const clean = text.replace(/[…！!？?・\s]+/g, ' ').trim();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    if (/[\uac00-\ud7a3]/.test(clean) && this.voiceKo) { u.voice = this.voiceKo; u.lang = 'ko-KR'; } else { u.voice = this.voice; u.lang = 'ja-JP'; }
    u.pitch = PITCH.coach; u.rate = RATE.coach; u.volume = 1;
    speechSynthesis.speak(u);
  }

  /** 펀치 기합 (짧은 합성 목소리 "はっ") */
  grunt(slot, charKey = 'ippo', power = 0.5) {
    if (this.mode === 'off') return;
    const now = performance.now();
    if (now - (this.lastGrunt[slot] || 0) < 140) return;
    this.lastGrunt[slot] = now;
    if (this.mode === 'file') { const e = this._lookup('grunt', charKey); if (e) { this._playFile(e, 0.95 + Math.random() * 0.1, 0.8); return; } }
    this._synthVoice(charKey, power, false);
  }

  /** 피격 신음 */
  hurt(slot, charKey = 'ippo', power = 0.5) {
    if (this.mode === 'off') return;
    const now = performance.now();
    if (now - (this.lastGrunt[slot] || 0) < 120) return;
    this.lastGrunt[slot] = now;
    if (this.mode === 'file') { const e = this._lookup('hurt', charKey); if (e) { this._playFile(e, 0.95 + Math.random() * 0.1, 0.9); return; } }
    this._synthVoice(charKey, power, true);
  }

  /** 포먼트 필터 두 개로 만드는 짧은 목소리: 기합("はっ") / 신음("ぐっ") */
  _synthVoice(charKey, power, isHurt) {
    const ctx = this.audio.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const base = (isHurt ? 150 : 200) * (PITCH[charKey] || 1) * (0.95 + Math.random() * 0.1);
    const dur = isHurt ? 0.22 : 0.16 + 0.06 * power;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * (isHurt ? 1.1 : 1.3), t);
    o.frequency.exponentialRampToValueAtTime(base * (isHurt ? 0.7 : 0.95), t + dur);
    // 모음 포먼트: 기합 "あ"(700/1200) , 신음 "う"(350/900)
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 6; f1.frequency.value = isHurt ? 350 : 700;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 8; f2.frequency.value = isHurt ? 900 : 1200;
    const mix = ctx.createGain(); mix.gain.value = 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 + 0.3 * power, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // 숨소리 (자음 h)
    const n = ctx.createBufferSource(); n.buffer = this.audio.noise;
    const nh = ctx.createBiquadFilter(); nh.type = 'highpass'; nh.frequency.value = 1500;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(isHurt ? 0.08 : 0.25, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(f1); o.connect(f2); f1.connect(mix); f2.connect(mix); mix.connect(g); g.connect(this.audio.master);
    n.connect(nh); nh.connect(ng); ng.connect(this.audio.master);
    o.start(t); o.stop(t + dur + 0.02); n.start(t); n.stop(t + 0.08);
  }
}
