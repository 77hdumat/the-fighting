// Touch.js — 모바일 가로 모드 터치 조작: 왼쪽 = 가상 조이스틱(이동), 오른쪽 = 버튼(펀치/스킬/가드)
// Input 의 down/pressed Set 에 직접 키 코드를 넣어 키보드와 같은 경로로 흘려보낸다.
export const isTouchDevice = () => ('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;

const BUTTONS = [
  // [코드, 라벨, 서브라벨, css class]
  ['PUNCH', '펀치', 'L↔R', 'big'],   // 한 버튼: 누를 때마다 좌/우 번갈아 (J, K, J, K…)
  ['KeyL', '必殺', 'MAX', 'fin'],
  ['KeyU', '반격', 'U', ''],
  ['KeyI', '고유', 'I', ''],
  ['ShiftLeft', '가드', 'HOLD', 'guard'],
];

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.move = { x: 0, y: 0 };   // 화면 기준: x 오른쪽 +, y 앞(위) +
    this.active = false;
    this.stickId = null; this.stickOrigin = { x: 0, y: 0 };
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="tzone left" id="touch-left"><div class="stick" id="stick"><div class="knob" id="stick-knob"></div></div></div>
      <div class="tzone right" id="touch-right">
        ${BUTTONS.map(([c, l, s, cls]) => `<button class="tbtn ${cls}" data-code="${c}"><span>${l}</span><small>${s}</small></button>`).join('')}
      </div>
      <button class="tbtn chat" id="touch-chat">CHAT</button>`;
    document.body.appendChild(this.root);
    // iOS 꾹 누름 돋보기/선택/콜아웃 차단
    const block = (e) => e.preventDefault();
    this.root.addEventListener('touchstart', block, { passive: false });
    this.root.addEventListener('touchmove', block, { passive: false });
    this.root.addEventListener('selectstart', block);
    document.addEventListener('selectstart', (e) => { const t = e.target; if (!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) e.preventDefault(); });
    this.knob = this.root.querySelector('#stick-knob');
    this.stick = this.root.querySelector('#stick');
    this.bindStick(this.root.querySelector('#touch-left'));
    this.bindButtons();
    this.setVisible(false);
  }

  setVisible(v) { this.active = v; this.root.classList.toggle('on', v); if (!v) this.releaseAll(); }

  press(code) {
    if (code === 'PUNCH') {
      // 한 번 탭 = 한 방 (좌/우 번갈아). 꾹 누르면 일정 간격으로 좌우 연타
      this._punchOnce();
      clearInterval(this.punchTimer);
      // 이전 펀치가 캔슬 가능 구간에 들어왔을 때만 다음 펀치 (입력 씹힘 방지 → 좌/우가 정확히 번갈아 나감)
      this.punchTimer = setInterval(() => {
        const f = this.fighter; const pu = f && f.punch;
        if (pu && pu.t < pu.dur * 0.56) return;
        if (f && f.busy) return;
        this._punchOnce();
      }, 50);
      return;
    }
    const i = this.input; if (!i.down.has(code)) i.pressed.add(code); i.down.add(code); i.notify();
  }
  _punchOnce() {
    if (this.punchHeld) this.input.down.delete(this.punchHeld);
    this.punchSide = this.punchSide === 'KeyJ' ? 'KeyK' : 'KeyJ';
    this.punchHeld = this.punchSide;
    const i = this.input; i.pressed.add(this.punchSide); i.down.add(this.punchSide); i.notify();
  }
  release(code) {
    if (code === 'PUNCH') { clearInterval(this.punchTimer); this.punchTimer = null; code = this.punchHeld; this.punchHeld = null; if (!code) return; }
    this.input.down.delete(code); this.input.notify();
  }
  releaseAll() { for (const [c] of BUTTONS) this.release(c); this.release('KeyJ'); this.release('KeyK'); this.move.x = this.move.y = 0; this.stickId = null; this.stick.classList.remove('on'); }

  bindStick(zone) {
    const R = 56;   // 최대 반경 px
    const upd = (e) => {
      const dx = e.clientX - this.stickOrigin.x, dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy) || 1, k = Math.min(1, len / R);
      const nx = dx / len * k, ny = dy / len * k;
      this.knob.style.transform = `translate(${nx * R}px, ${ny * R}px)`;
      // 데드존 0.18 → 그 밖은 아날로그
      const dead = 0.18; const m = k < dead ? 0 : (k - dead) / (1 - dead);
      this.move.x = dx / len * m; this.move.y = -dy / len * m;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      try { zone.setPointerCapture(e.pointerId); } catch (_) {}
      this.stick.style.left = e.clientX + 'px'; this.stick.style.top = e.clientY + 'px';
      this.stick.classList.add('on'); this.knob.style.transform = 'translate(0,0)';
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) { upd(e); e.preventDefault(); } });
    const end = (e) => { if (e.pointerId !== this.stickId) return; this.stickId = null; this.move.x = this.move.y = 0; this.stick.classList.remove('on'); };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end); zone.addEventListener('lostpointercapture', end);
  }

  bindButtons() {
    for (const b of this.root.querySelectorAll('.tbtn[data-code]')) {
      const code = b.dataset.code;
      const down = (e) => { this.press(code); b.classList.add('down'); try { b.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); };
      const up = () => { this.release(code); b.classList.remove('down'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    this.root.querySelector('#touch-chat').addEventListener('click', () => { const ci = document.getElementById('chat-input'); const c = document.getElementById('chat'); if (ci && c) { c.classList.remove('hidden'); ci.focus(); } });
  }

  /** HUD 갱신: 필살 버튼 MAX 강조, 쿨다운 반영 */
  update(fighter) {
    this.fighter = fighter;
    if (!this.active || !fighter) return;
    const fin = this.root.querySelector('.tbtn.fin'); if (fin) fin.classList.toggle('ready', !!fighter.dempsey.maxSpeed);
    const u = this.root.querySelector('[data-code="KeyU"]'), i = this.root.querySelector('[data-code="KeyI"]');
    if (u) u.classList.toggle('cd', fighter.cd.U > 0); if (i) i.classList.toggle('cd', fighter.cd.I > 0);
  }
}
