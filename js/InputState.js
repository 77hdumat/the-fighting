// InputState.js — 로컬 키보드 / 네트워크 / AI 가 공통으로 채우는 입력 상태
// 비트: 0 W, 1 A, 2 S, 3 D, 4 Space, 5 J, 6 K, 7 L, 8 Shift, 9 U, 10 I
export const BIT = { KeyW: 1, KeyA: 2, KeyS: 4, KeyD: 8, Space: 16, KeyJ: 32, KeyK: 64, KeyL: 128, ShiftLeft: 256, ShiftRight: 256, KeyU: 512, KeyI: 1024 };

export class InputState {
  constructor() {
    this.bits = 0;
    this.prev = 0;
    this.mx = 0; // 월드 기준 이동 벡터 (카메라 상대 → 보내는 쪽에서 계산)
    this.mz = 0;
  }
  /** 로컬 키보드(Input) 로부터 채움. move 는 월드 벡터 */
  fromInput(input, move) {
    let b = 0;
    // 한 프레임 안에 눌렀다 뗀 짧은 탭도 놓치지 않도록 justPressed 도 포함
    for (const k in BIT) if (input.isDown(k) || input.justPressed(k)) b |= BIT[k];
    this.bits = b;
    this.mx = move.x; this.mz = move.z;
  }
  set(bits, mx, mz) { this.bits = bits; this.mx = mx; this.mz = mz; }
  isDown(code) { const m = BIT[code]; return !!m && (this.bits & m) !== 0; }
  justPressed(code) { const m = BIT[code]; return !!m && (this.bits & m) !== 0 && (this.prev & m) === 0; }
  endFrame() { this.prev = this.bits; }
  pack() { return [this.bits, +this.mx.toFixed(2), +this.mz.toFixed(2)]; }
}
