// Coach.js — 만화식 코치 말풍선 + 음성. CoachBrain 은 호스트에서 각 사람 파이터의 상황을 보고 대사 키를 고른다.
export const COACH_LINES = {
  deeper:   { ja: 'もっと深く踏み込めッ！！', ko: '좀 더 깊숙이 들어가야지!!' },
  guard:    { ja: 'ガードを固めろッ！！', ko: '가드 올려!!' },
  head:     { ja: '頭を振れ！ 止まるなッ！', ko: '머리 흔들어! 멈추지 마!' },
  now:      { ja: '今だッ！ 一気に行けぇッ！！', ko: '지금이다! 몰아붙여!!' },
  faster:   { ja: '腰を落とせ！ もっと速くッ！', ko: '허리 낮춰! 더 빠르게!' },
  finish:   { ja: '決めろッ！ 必殺の一撃だ！！', ko: '끝내! 필살의 한 방!!' },
  standup:  { ja: '立てッ！ まだ終わってねぇ！！', ko: '일어서! 아직 안 끝났어!!' },
  body:     { ja: '腹を締めろッ！', ko: '배에 힘 줘!' },
  counter:  { ja: '相手の拳を見ろ！ 合わせろッ！', ko: '상대 주먹을 봐! 맞춰 쳐!' },
  enough:   { ja: 'もういい！ 倒れてるだろッ！！', ko: '그만! 이미 쓰러졌잖아!!' },
  breathe:  { ja: '呼吸を忘れるな！', ko: '호흡 잊지 마!' },
  turtle:   { ja: 'ガードはお前の腕じゃねぇのかッ！？', ko: '가드는 니 팔 아니냐?! 치라고!' },
};

export class CoachBubble {
  constructor(voice) {
    this.el = document.getElementById('coach');
    this.voice = voice;
    this.timer = null;
  }
  show(key) {
    const L = COACH_LINES[key]; if (!L) return;
    const el = this.el;
    el.innerHTML = `<div class="who">COACH</div><div class="ja">${L.ja}</div><div class="ko">${L.ko}</div>`;
    el.classList.remove('hidden', 'pop');
    void el.offsetWidth; // 애니메이션 재시작
    el.classList.add('pop');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => el.classList.add('hidden'), 2600);
    if (this.voice) this.voice.coach(L.ja);
  }
}

/** 호스트 측 판단 로직 (파이터 1명당 1개) */
export class CoachBrain {
  constructor() {
    this.cool = 3;          // 첫 대사까지 잠깐 대기
    this.hurtTimes = [];
    this.whiffs = 0;
    this.lastKey = null;
    this.said = {};
  }
  _pick(key, dt, cooldown = 6) {
    if (this.cool > 0 || this.lastKey === key && (this.said[key] || 0) < 2) { /* 같은 말 연속 억제 */ }
    this.cool = cooldown; this.lastKey = key; this.said[key] = (this.said[key] || 0) + 1;
    return key;
  }
  onHurt(zone) { this.hurtTimes.push(performance.now()); this.hurtTimes = this.hurtTimes.filter((t) => performance.now() - t < 4000); this.lastZone = zone; }
  onPunchEnd(hit) { if (hit) this.whiffs = 0; else this.whiffs++; }
  onDownedHit() { this.wantEnough = true; }

  update(dt, f, fighters) {
    this.cool -= dt;
    if (this.wantEnough && !this.said.enough) { this.wantEnough = false; return this._pick('enough', dt, 8); }
    // 가드만 4초 이상 올리고 있으면 잔소리 (쿨 전에도)
    if (f.guardHold > 4 && (this.turtleCool || 0) <= 0) { this.turtleCool = 9; this.cool = 3; this.lastKey = 'turtle'; return 'turtle'; }
    this.turtleCool = (this.turtleCool || 0) - dt;
    this.wantEnough = false;
    if (this.cool > 0 || f.ko) return null;
    const d = f.dempsey;
    const tgt = f.target;
    if (f.hp < f.maxHp * 0.3 && !this.said.standup) return this._pick('standup', dt, 12);
    if (this.hurtTimes.length >= 3) { this.hurtTimes = []; return this._pick(this.lastZone === 'body' ? 'body' : Math.random() < 0.5 ? 'guard' : 'head', dt, 7); }
    if (this.whiffs >= 3) { this.whiffs = 0; return this._pick('deeper', dt, 7); }
    if (tgt && tgt.stagger > 0.5 && !d.active) return this._pick('now', dt, 6);
    if (d.maxSpeed && d.charge >= 2) return this._pick('finish', dt, 9);
    if (d.active && d.gauge > 55 && d.gauge < 90 && Math.random() < dt * 0.6) return this._pick('faster', dt, 9);
    if (tgt && tgt.punch && tgt.dempsey.active && !f.guard && Math.random() < dt * 0.5) return this._pick('counter', dt, 10);
    return null;
  }
}
