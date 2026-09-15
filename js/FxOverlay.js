// FxOverlay.js — WebGL 위에 얹는 2D 캔버스: 집중선(speed line), 방향성 스트릭, 임팩트 링/버스트,
// 화이트 플래시, 히트스톱 만화 임팩트 프레임, 의성어 텍스트, MAX SPEED 비네트
const SFX_WORDS = ['ドゴォ', 'バキィ', 'ゴッ', 'ドンッ', 'ズガッ', 'バァン'];

export class FxOverlay {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.lines = [];
    this.streaks = [];
    this.impacts = [];
    this.popups = [];
    this.flash = 0;
    this.flashRGB = '255,255,255';
    this.quality = 2;
    this.carry = 0;
    this.carry2 = 0;
    this.t = 0;
    this.resize();
  }

  resize() {
    this.w = this.c.width = window.innerWidth;
    this.h = this.c.height = window.innerHeight;
  }

  addImpact(x, y, power, maxSpeed, tint = null) {
    this.impacts.push({ tint,
      x, y, power, age: 0, rot: Math.random() * Math.PI * 2,
      word: SFX_WORDS[Math.floor(Math.random() * SFX_WORDS.length)],
      wordRot: (Math.random() - 0.5) * 0.5, maxSpeed,
    });
    this.flash = Math.max(this.flash, 0.3 + 0.5 * power);
    this.flashRGB = '255,255,255';
  }

  /** 화면 위치에 짧은 텍스트 팝업 (예: 피함!) */
  addPopup(x, y, text, kind = 'dodge') {
    this.popups.push({ x, y, text, kind, age: 0, rot: (Math.random() - 0.5) * 0.4 });
  }

  /** 플레이어 피격: 붉은 플래시 */
  /** 집중선 한 방 (대시/돌진) */
  addSpeedBurst(amt = 0.5) {
    const R = Math.hypot(this.w, this.h) * 0.5, n = Math.round(40 + 80 * amt);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      this.lines.push({ ang, r0: R * (0.3 + Math.random() * 0.4), len: R * (0.15 + Math.random() * 0.5), wd: 1 + Math.random() * 3, life: 0.08 + Math.random() * 0.12, age: 0 });
    }
  }

  hurtFlash(power) {
    this.flash = Math.max(this.flash, 0.18 + 0.35 * power);
    this.flashRGB = '255,40,30';
  }

  /**
   * s: { intensity, maxSpeed, focusX, focusY, velX, velY (스크린 속도, px/s), hitStop, crossPulse, dempseyActive }
   */
  update(dt, s) {
    this.t += dt;
    const ctx = this.ctx, w = this.w, h = this.h;
    const cx = s.focusX ?? w / 2, cy = s.focusY ?? h / 2;
    const R = Math.hypot(w, h) * 0.5;
    const I = s.intensity;

    ctx.clearRect(0, 0, w, h);

    // ---- 집중선 스폰 ----
    const rate = s.dempseyActive ? (Math.pow(I, 1.2) * 520 + 40) * (this.quality < 2 ? 0.5 : 1) : 0;
    this.carry += rate * dt;
    while (this.carry >= 1) {
      this.carry -= 1;
      const ang = Math.random() * Math.PI * 2;
      this.lines.push({
        ang, r0: R * (0.28 + Math.random() * 0.45 - 0.12 * I),
        len: R * (0.12 + Math.random() * (0.35 + 0.5 * I)),
        wd: 1 + Math.random() * (1.5 + 3 * I), life: 0.05 + Math.random() * 0.09, age: 0,
      });
    }
    // ---- 방향성 스트릭 (스웨이 방향과 동기) ----
    const speed = Math.hypot(s.velX, s.velY);
    if (speed > 250 && s.dempseyActive) {
      const rate2 = Math.min(1, (speed - 250) / 1200) * (250 + 500 * I);
      this.carry2 += rate2 * dt;
      const dx = s.velX / speed, dy = s.velY / speed;
      while (this.carry2 >= 1) {
        this.carry2 -= 1;
        const px = Math.random() * w, py = Math.random() * h;
        this.streaks.push({ x: px, y: py, dx, dy, len: 80 + Math.random() * (200 + 500 * I), wd: 1 + Math.random() * 2.5, life: 0.06 + Math.random() * 0.08, age: 0 });
      }
    }

    if (this.lines.length > 220) this.lines.splice(0, this.lines.length - 220);
    if (this.streaks.length > 160) this.streaks.splice(0, this.streaks.length - 160);
    // ---- 그리기: 집중선 ----
    ctx.lineCap = 'round';
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const L = this.lines[i];
      L.age += dt;
      if (L.age > L.life) { this.lines.splice(i, 1); continue; }
      const a = (1 - L.age / L.life) * (0.45 + 0.5 * I);
      const c = Math.cos(L.ang), sn = Math.sin(L.ang);
      ctx.strokeStyle = s.maxSpeed ? `rgba(255,235,200,${a})` : `rgba(255,255,255,${a})`;
      ctx.lineWidth = L.wd;
      ctx.beginPath();
      ctx.moveTo(cx + c * L.r0, cy + sn * L.r0);
      ctx.lineTo(cx + c * (L.r0 + L.len), cy + sn * (L.r0 + L.len));
      ctx.stroke();
    }
    // ---- 스트릭 ----
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const S = this.streaks[i];
      S.age += dt;
      if (S.age > S.life) { this.streaks.splice(i, 1); continue; }
      const a = (1 - S.age / S.life) * 0.45;
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = S.wd;
      ctx.beginPath();
      ctx.moveTo(S.x, S.y);
      ctx.lineTo(S.x - S.dx * S.len, S.y - S.dy * S.len);
      ctx.stroke();
    }

    // ---- MAX SPEED 비네트 (붉은 열기 + 맥동) ----
    if (s.maxSpeed || I > 0.75) {
      const k = s.maxSpeed ? 1 : (I - 0.75) * 4;
      const pulse = 0.25 + 0.15 * Math.sin(this.t * 22);
      const g = ctx.createRadialGradient(cx, cy, R * 0.35, cx, cy, R * 1.05);
      g.addColorStop(0, 'rgba(255,60,20,0)');
      g.addColorStop(1, `rgba(255,70,20,${pulse * k})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // ---- 히트스톱 임팩트 프레임 (만화식 흑백 집중선) ----
    if (s.hitStop > 0) {
      ctx.save();
      const n = 72;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + Math.sin(i * 7.3) * 0.02;
        const wdt = 0.006 + (Math.sin(i * 3.1) * 0.5 + 0.5) * 0.02;
        const r0 = R * (0.32 + (Math.sin(i * 5.7) * 0.5 + 0.5) * 0.25);
        ctx.fillStyle = i % 2 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        ctx.lineTo(cx + Math.cos(ang - wdt) * R * 1.6, cy + Math.sin(ang - wdt) * R * 1.6);
        ctx.lineTo(cx + Math.cos(ang + wdt) * R * 1.6, cy + Math.sin(ang + wdt) * R * 1.6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // ---- 임팩트 링 / 버스트 / 의성어 ----
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const im = this.impacts[i];
      im.age += dt;
      const T = 0.42;
      if (im.age > T) { this.impacts.splice(i, 1); continue; }
      const k = im.age / T;
      const e = 1 - Math.pow(1 - k, 3);
      const P = im.power;
      // 링
      const rad = Math.max(1, 30 + (220 + 200 * P) * e);
      ctx.lineWidth = Math.max(0.5, (18 + 10 * P) * (1 - k));
      const c1 = im.tint === 'blue' ? '140,200,255' : '255,255,255', c2 = im.tint === 'blue' ? '80,150,255' : '255,170,60';
      ctx.strokeStyle = `rgba(${c1},${(1 - k) * 0.95})`;
      ctx.beginPath(); ctx.arc(im.x, im.y, rad, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = Math.max(0.5, 6 * (1 - k));
      ctx.strokeStyle = `rgba(${c2},${(1 - k) * 0.9})`;
      ctx.beginPath(); ctx.arc(im.x, im.y, rad * 0.72, 0, Math.PI * 2); ctx.stroke();
      // 버스트 스파이크
      const spikes = 14;
      for (let j = 0; j < spikes; j++) {
        const ang = im.rot + (j / spikes) * Math.PI * 2;
        const L = (130 + 260 * P) * e * (0.6 + 0.4 * Math.abs(Math.sin(j * 2.7)));
        const wdt = (14 + 10 * P) * (1 - k);
        ctx.fillStyle = j % 3 === 0 ? `rgba(${c2},${(1 - k)})` : `rgba(${c1},${(1 - k)})`;
        ctx.beginPath();
        ctx.moveTo(im.x + Math.cos(ang) * 20, im.y + Math.sin(ang) * 20);
        ctx.lineTo(im.x + Math.cos(ang + 0.06) * (20 + wdt), im.y + Math.sin(ang + 0.06) * (20 + wdt));
        ctx.lineTo(im.x + Math.cos(ang) * (20 + L), im.y + Math.sin(ang) * (20 + L));
        ctx.lineTo(im.x + Math.cos(ang - 0.06) * (20 + wdt), im.y + Math.sin(ang - 0.06) * (20 + wdt));
        ctx.closePath(); ctx.fill();
      }
      // 의성어
      if (im.age < 0.4) {
        const pop = k < 0.2 ? 1.6 - 3 * k : 1;
        const size = (60 + 60 * P) * pop;
        ctx.save();
        ctx.translate(im.x + 60, im.y - 50);
        ctx.rotate(im.wordRot);
        ctx.font = `900 ${size}px "Noto Sans JP", "Hiragino Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 12;
        ctx.strokeStyle = `rgba(0,0,0,${1 - k * 0.8})`;
        ctx.strokeText(im.word, 0, 0);
        ctx.fillStyle = im.maxSpeed ? `rgba(255,220,80,${1 - k * 0.8})` : `rgba(255,255,255,${1 - k * 0.8})`;
        ctx.fillText(im.word, 0, 0);
        ctx.restore();
      }
    }

    // ---- 텍스트 팝업 ----
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pp = this.popups[i];
      pp.age += dt;
      const T = 0.75;
      if (pp.age > T) { this.popups.splice(i, 1); continue; }
      const k = pp.age / T;
      const pop = k < 0.15 ? 0.6 + 2.8 * k : 1.0 + 0.1 * Math.sin(k * 20);
      const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.save();
      ctx.translate(pp.x, pp.y - 60 - k * 50);
      ctx.rotate(pp.rot);
      ctx.scale(pop, pop);
      ctx.font = `900 46px "Noto Sans JP", "Apple SD Gothic Neo", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 10;
      ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
      ctx.strokeText(pp.text, 0, 0);
      ctx.fillStyle = pp.kind === 'dodge' ? `rgba(120,230,255,${alpha})` : pp.kind === 'groggy' ? `rgba(255,90,60,${alpha})` : `rgba(255,255,255,${alpha})`;
      ctx.fillText(pp.text, 0, 0);
      // 스치는 바람 선
      ctx.strokeStyle = `rgba(160,240,255,${alpha * 0.8})`;
      ctx.lineWidth = 3;
      for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.moveTo(-70 - j * 8, 10 + j * 9); ctx.lineTo(-30 - j * 8, 10 + j * 9); ctx.stroke(); }
      ctx.restore();
    }

    // ---- 화이트 플래시 ----
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.flashRGB},${Math.min(1, this.flash)})`;
      ctx.fillRect(0, 0, w, h);
      this.flash *= Math.exp(-dt * 16);
    }
  }
}
