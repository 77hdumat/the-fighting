// AIBrain.js — 극한 난이도 AI: 거리 조절, 콤보, 반격, 블록/슬리핑/크로스 카운터 읽기, 자체 뎀프시롤, 필살기 회피
import { InputState } from './InputState.js';

export class AIBrain {
  constructor(fighter, difficulty = 1) {
    this.f = fighter;
    fighter.isAI = true;
    fighter.brain = this;
    this.input = new InputState();
    this.diff = difficulty;         // 1 = 극한. 연습 모드 레벨에 따라 1.4^(lv-1) 로 기하급수 증가
    this.pw = Math.min(2.4, Math.pow(1.1, Math.max(0, Math.log(difficulty) / Math.log(1.4))));   // 레벨당 위력 +10%
    this.actTimer = 1.0 + Math.random();
    this.retaliate = 0;
    this.strafeDir = 1; this.strafeTimer = 1;
    this.dempseyCharge = 0.3; this.dempseyCool = 6 + Math.random() * 4; this.dempseyT = 0; this.wantsDempsey = false;
    this.hookHold = false;
  }

  onHurt() {
    // 맞으면 뎀프시 게이지가 조금 찬다 (분노)
    this.dempseyCharge = Math.min(1, this.dempseyCharge + 0.06);
  }

  /** 타겟(또는 나를 노리는 상대)이 펀치를 시작 — 읽기 */
  onEnemyPunch(type, enemy) {
    const f = this.f;
    if (f.ko || f.stagger > 0 || f.dempsey.active || f.finisher) return;
    const rnd = Math.random();
    if (type === 'finisher') {
      if (enemy.finisher && enemy.finisher.charge < 3 && rnd < Math.min(0.95, 0.45 * this.diff)) f.doBackstep();
      return;
    }
    if (f.slip > 0 || f.block > 0) return;
    if (type === 'straight') {
      if (rnd < Math.min(0.6, 0.22 * this.diff) && !f.punch) {
        f.startPunch('R', 'straight', 0.24, 1.0 * this.pw);
        if (f.punch) { f.punch.counter = true; f.queue.length = 0; }
      } else if (rnd < Math.min(0.97, 0.62 * Math.sqrt(this.diff))) f.doBlock();
      else if (rnd < 0.9) f.doSlip();
    } else if (type === 'hook') {
      const I = enemy.dempsey.intensity;
      const chance = Math.min(0.95, (0.62 - 0.42 * I + f.readSkill) * this.diff);
      if (rnd < chance) f.doBlock();
    }
  }

  /** 매 틱: InputState 를 채우고 직접 행동도 트리거 */
  update(dt, fighters) {
    const f = this.f, D = f.dempsey;
    const inp = this.input;
    inp.prev = inp.bits;
    let bits = 0; let mx = 0, mz = 0;
    const tgt = f.target;
    if (f.ko || !tgt) { inp.set(0, 0, 0); return inp; }
    const dist = tgt.pos.distanceTo(f.pos);
    const canAct = f.stagger <= 0 && !f.finisher;

    // ---- 필살 (게이지 MAX 면 거리 맞춰 발동) ----
    this.dempseyCool -= dt;
    if (D.maxSpeed && canAct && !f.punch && dist < (f.kit.finisher === 'finisherHook' ? 2.4 : 1.7) && Math.random() < dt * 1.5) bits |= 128;
    // ---- 고유기 ----
    if (canAct && !D.active && !f.punch && dist < 1.9) {
      if (f.cd.U <= 0 && Math.random() < dt * 0.35 * this.diff) f.startSpecial('U');
      else if (f.cd.I <= 0 && Math.random() < dt * 0.3 * this.diff && (f.kit.I !== 'backjab' || dist < 1.2)) f.startSpecial('I');
    }

    // ---- 이동 ----
    const style = f.stanceStyle;
    if (canAct) {
      const want = D.active ? (style === 'flicker' ? 1.3 : 0.9) : tgt.dempseyActive ? 0.95 : 1.2;
      const err = dist - want;
      if (Math.abs(err) > 0.1) { const k = Math.sign(err) * Math.min(1, Math.abs(err) * 2.2) * 0.4; mx += f.forward.x * k; mz += f.forward.z * k; }
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafeTimer = 1.0 + Math.random() * 2; this.strafeDir = Math.random() > 0.5 ? 1 : -1; }
      mx += f.side.x * this.strafeDir * 0.22; mz += f.side.z * this.strafeDir * 0.22;
    }

    // ---- 반격 ----
    if (this.retaliate > 0 && canAct && !D.active) {
      this.retaliate -= dt;
      if (this.retaliate <= 0 && !f.punch && dist < 2.0) {
        f.block = 0;
        const r = Math.random();
        const P = this.pw;
        if (r < 0.45) f.startPunch('R', 'straight', 0.28, 0.8 * P);
        else if (r < 0.8) { f.startPunch('L', 'hook', 0.3, 0.75 * P); f.queue.push({ side: 'R', type: 'hook', dur: 0.28, power: 0.85 * P }); }
        else { f.startPunch('L', 'flicker', 0.28, 0.4 * P); f.queue.push({ side: 'R', type: 'straight', dur: 0.28, power: 0.85 * P }); }
      }
    }

    // ---- 공격 ----
    if (canAct && !D.active && f.block <= 0 && f.slip <= 0) {
      this.actTimer -= dt;
      if (!f.punch && !f.queue.length && this.actTimer <= 0 && dist < 2.1) {
        const aggressive = tgt.dempseyActive || tgt.stagger > 0;
        this.actTimer = ((aggressive ? 0.5 : 0.85) + Math.random() * 0.8) / this.diff / Math.sqrt(f.def.speedMul);
        const r = Math.random(); const P = this.pw;
        if (r < 0.35) f.startPunch('L', 'flicker', 0.38, 0.3 * P);
        else if (r < 0.6) f.startPunch('R', 'straight', 0.34, 0.55 * P);
        else if (r < 0.82) { f.startPunch('L', 'flicker', 0.34, 0.3 * P); f.queue.push({ side: 'R', type: 'straight', dur: 0.32, power: 0.65 * P }); }
        else { f.startPunch('L', 'hook', 0.34, 0.65 * P); f.queue.push({ side: 'R', type: 'hook', dur: 0.32, power: 0.8 * P }, { side: 'R', type: 'straight', dur: 0.3, power: 0.85 * P }); }
      }
    }
    inp.set(bits, mx, mz);
    return inp;
  }
}
