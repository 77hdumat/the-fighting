// Input.js — 키 상태 (hold / justPressed)
export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat && !this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => { if (typing(e)) { this.down.clear(); return; } this.down.delete(e.code); });
    window.addEventListener('blur', () => this.down.clear());
    // 마우스 보조 입력: 좌클릭 = J, 가운데 = U. 키보드 포커스 문제 시 우회용
    const canvas = document.getElementById('gl');
    const mouseMap = { 0: 'KeyJ', 1: 'KeyU' };
    const press = (code) => { if (!this.down.has(code)) this.pressed.add(code); this.down.add(code); };
    if (canvas) {
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; const c = mouseMap[e.button]; if (c) { press(c); e.preventDefault(); } });
      window.addEventListener('pointerup', (e) => { const c = mouseMap[e.button]; if (c) this.down.delete(c); });
    }
  }
  isDown(code) { return this.down.has(code); }
  justPressed(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); }
}
