// VoiceManager.js — 캐릭터 음성.
//  1) assets/voice/manifest.json 이 있으면 파일(mp3/ogg/wav) 재생 (키: "dempsey_start", 캐릭터별: "ippo:dempsey_start")
//  2) 없으면 브라우저 일본어 TTS(speechSynthesis) 로 자막 대사를 외치고, 기합/신음은 Web Audio 합성
const TEXT_KEYS = [
  ['デンプシー・ロール', 'dempsey_start'], ['もっと速く', 'faster'], ['まだだ', 'notyet'], ['いけぇ', 'go'],
  ['うおおお', 'finisher'], ['ぶっ飛べ', 'finisher_hit'], ['ダウン', 'down'], ['カウンター', 'counter'],
  ['ファイッ', 'fight'], ['潰す', 'crush'], ['ガード', 'guardbreak'], ['効いてる', 'effective'], ['効かねぇ', 'noeffect'],
];
import { CHARACTERS } from './Rig.js';

// 캐릭터별 목소리 톤 (여성 캐릭터는 높고 빠르게)
const PITCH = {
  ippo: 1.15, miyata: 1.05, mashiba: 0.72, sendo: 0.65, coach: 0.5,
  chaechae: 1.35, jjeonghyo: 1.15, ohsh: 1.45,         // 여성
  ppyeo: 0.85, jungjuwon: 0.7, gokomong: 0.8,          // 남성
};
const RATE = {
  ippo: 1.3, miyata: 1.25, mashiba: 1.05, sendo: 0.95, coach: 1.15,
  chaechae: 1.45, jjeonghyo: 1.1, ohsh: 1.35,
  ppyeo: 1.2, jungjuwon: 1.0, gokomong: 0.85,
};
const genderOf = (charKey) => (charKey === 'coach' ? 'm' : ((CHARACTERS[charKey] && CHARACTERS[charKey].gender) || 'm'));

// 브라우저/OS 별 음성 이름 → 성별 (표준 API 엔 성별 필드가 없어서 이름으로 판별)
const VOICE_GENDER = {
  f: ['kyoko', 'o-ren', 'haruka', 'ayumi', 'nanami', 'sayaka', 'mizuki', 'female',
      'yuna', 'heami', 'sunhi', 'seoyeon', 'jimin', 'sora', 'jiwon', '한국의', 'google 일본어',
      '유나', '해미', '선히', '서연', '지민', '소라', '미사키', '교코'],
  m: ['otoya', 'hattori', 'ichiro', 'daichi', 'keita', 'takumi', 'male',
      'injoon', 'minsu', 'gyeong', 'jinho', 'bongjin', 'hyunsu',
      '인준', '민수', '현수', '진호', '오토야', '핫토리'],
};
function guessGender(v) {
  const n = (v.name || '').toLowerCase();
  for (const g of ['f', 'm']) if (VOICE_GENDER[g].some((k) => n.includes(k))) return g;
  return null;
}

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
        const byLang = (re) => vs.filter((v) => re.test(v.lang));
        const ja = byLang(/ja/i), ko = byLang(/ko/i);
        const split = (list) => {
          const m = list.filter((v) => guessGender(v) === 'm');
          const f = list.filter((v) => guessGender(v) === 'f');
          const rest = list.filter((v) => !guessGender(v));
          return { m: m[0] || rest[0] || list[0] || null, f: f[0] || rest[0] || list[0] || null, any: list[0] || null };
        };
        this.ja = split(ja); this.ko = split(ko);
        this.voice = this.ja.m || this.ja.any;        // 하위 호환
        this.voiceKo = this.ko.f || this.ko.any;
        this.ttsReady = !!(this.ja.any || this.ko.any);
        this.voiceInfo = {
          ja: { m: this.ja.m && this.ja.m.name, f: this.ja.f && this.ja.f.name },
          ko: { m: this.ko.m && this.ko.m.name, f: this.ko.f && this.ko.f.name },
        };
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
    const gd = genderOf(charKey);
    const pool = isKo ? this.ko : this.ja;
    const chosen = pool ? (pool[gd] || pool.any) : null;
    if (chosen) u.voice = chosen;
    u.lang = isKo ? 'ko-KR' : 'ja-JP';
    // 성별 전용 음성이 없어 남녀가 같은 목소리를 공유하면(예: 한국어 '유나' 하나뿐) 피치로 구분한다
    const shared = chosen && pool && pool.m === pool.f;
    const vg = chosen ? guessGender(chosen) : null;
    let genderShift = 1;
    if (shared && vg && vg !== gd) genderShift = gd === 'f' ? 1.45 : 0.6;   // 반대 성별 음성 → 크게 보정
    else if (shared) genderShift = gd === 'f' ? 1.15 : 0.85;
    u.pitch = Math.max(0.1, Math.min(2, (PITCH[charKey] || (gd === 'f' ? 1.4 : 0.95)) * genderShift * (strong ? 0.95 : 1)));
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
    const isKo = /[\uac00-\ud7a3]/.test(clean);
    const pool = isKo ? this.ko : this.ja;
    if (pool && (pool.m || pool.any)) u.voice = pool.m || pool.any;
    u.lang = isKo ? 'ko-KR' : 'ja-JP';
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
    const gd = genderOf(charKey);
    const gMul = gd === 'f' ? 1.55 : 1;                    // 여성은 성대 기본 주파수가 높다
    const base = (isHurt ? 150 : 200) * (PITCH[charKey] || (gd === 'f' ? 1.4 : 1)) * gMul * (0.95 + Math.random() * 0.1);
    const dur = isHurt ? 0.22 : 0.16 + 0.06 * power;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * (isHurt ? 1.1 : 1.3), t);
    o.frequency.exponentialRampToValueAtTime(base * (isHurt ? 0.7 : 0.95), t + dur);
    // 모음 포먼트: 기합 "あ"(700/1200) , 신음 "う"(350/900)
    const fScale = gd === 'f' ? 1.18 : 1;                  // 여성은 포먼트도 위로
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 6; f1.frequency.value = (isHurt ? 350 : 700) * fScale;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 8; f2.frequency.value = (isHurt ? 900 : 1200) * fScale;
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
