// SubtitleManager.js — 애니메이션 자막 (fade-in → 확대 → fade-out, 강한 대사는 미세 진동)
export class SubtitleManager {
  constructor(container) {
    this.el = container;
    this.current = null;
    this.timer = null;
    this.voice = null;      // VoiceManager
    this.myChar = 'ippo';   // 화자 캐릭터 (Game 이 갱신)
    this.oppChar = 'mashiba';
  }

  /** 상황별 대사 (쿨다운 있음). kind: 'hit' | 'bigHit' | 'counter' | 'hurt' | 'oppHurt' | 'oppHit' */
  line(kind, opts = {}) {
    const now = performance.now();
    if (kind !== 'counter' && now - (this.lastLine || 0) < 1100) return;
    const pools = {
      hit: ['効いてるか…！', 'まだまだっ！', 'これがデンプシー・ロールだ！', '止まるなっ…！', 'もう一発っ！'],
      bigHit: ['ぶっ飛べぇっ！！', '届けぇぇっ！！', '全部乗せるっ！！'],
      counter: ['カウンター！！', 'クロスカウンター！！'],
      hurt: ['ぐっ…！', '痛ぇ…！', 'まだ倒れない…！', '効かねぇ…！'],
      oppHurt: ['なっ…！？', 'この野郎…！', 'ぐはっ…！', '…見えねぇ…！'],
      oppHit: ['遅ぇよ…', '潰す…！', '沈めッ！', 'それで終わりか？'],
    };
    const pool = pools[kind];
    const text = pool[Math.floor(Math.random() * pool.length)];
    this.lastLine = now;
    this.show(text, Object.assign({ duration: 1.1, speaker: kind.startsWith('opp') ? 'opp' : 'player' }, opts));
  }

  show(text, { duration = 1.4, strong = false, mid = false, speaker = 'player', charKey = null, voice = true } = {}) {
    if (voice && this.voice) this.voice.onSubtitle(text, charKey || (speaker === 'opp' ? this.oppChar : this.myChar) || 'ippo', strong);
    if (this.current) {
      const old = this.current;
      old.style.transition = 'opacity .12s';
      old.style.opacity = '0';
      setTimeout(() => old.remove(), 130);
      clearTimeout(this.timer);
    }
    const el = document.createElement('div');
    el.className = 'sub' + (strong ? ' strong' : mid ? ' mid' : '') + (speaker === 'opp' ? ' opp' : '');
    el.style.setProperty('--dur', duration + 's');
    const inner = document.createElement('span');
    inner.className = 'inner';
    inner.textContent = text;
    el.appendChild(inner);
    this.el.appendChild(el);
    this.current = el;
    this.timer = setTimeout(() => { el.remove(); if (this.current === el) this.current = null; }, duration * 1000 + 80);
  }

  clear() {
    if (this.current) { this.current.remove(); this.current = null; }
    clearTimeout(this.timer);
  }
}
