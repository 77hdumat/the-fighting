// FxOverlay.js — WebGL 위에 얹는 2D 캔버스: 집중선(speed line), 방향성 스트릭, 임팩트 링/버스트,
// 화이트 플래시, 히트스톱 만화 임팩트 프레임, 의성어 텍스트, MAX SPEED 비네트
const SFX_WORDS = ['ドゴォ', 'バキィ', 'ゴッ', 'ドンッ', 'ズガッ', 'バァン'];

// 임팩트 팔레트 (만화 폭발). ring: 바깥/안쪽 링, spikes: 스파이크 교대색, word: 의성어 채움, flash: 화면 플래시
// 'rainbow' 는 스파이크마다 색상환을 돌린다 (카운터·필살).
const PALETTES = {
  hit:     { ring: ['255,255,255', '255,150,30'], spikes: ['255,232,60', '255,140,30', '255,255,255'], word: '255,228,60', flash: '255,240,190' },
  heavy:   { ring: ['255,240,120', '255,90,30'],  spikes: ['255,210,40', '255,70,40', '255,255,255'],  word: '255,210,40', flash: '255,225,150' },
  counter: { ring: ['255,255,255', '255,50,120'], spikes: 'rainbow', word: '255,80,150', flash: '255,190,220' },
  finisher:{ ring: ['255,255,255', '255,40,80'],  spikes: 'rainbow', word: '255,240,90', flash: '255,255,255' },
  blue:    { ring: ['140,200,255', '80,150,255'], spikes: ['120,200,255', '80,140,255', '255,255,255'], word: '150,210,255', flash: '150,200,255' },
  pink:    { ring: ['255,200,240', '255,120,200'],spikes: ['255,120,200', '255,200,240', '255,255,255'], word: '255,140,210', flash: '255,210,240' },
};

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
    this.impactImage = new Image();
    this.impactImage.src = 'assets/effects/boxing-impact-v2.png';
    this.resize();
  }

  resize() {
    this.w = this.c.width = window.innerWidth;
    this.h = this.c.height = window.innerHeight;
  }

  /**
   * @param tint 팔레트 이름 ('hit'|'heavy'|'counter'|'finisher'|'blue'|'pink'). 생략 시 power 로 hit/heavy 자동.
   *             (옛 호출 호환: [r,g,b] 배열은 pink 로)
   */
  addImpact(x, y, power, maxSpeed, tint = null) {
    const name = Array.isArray(tint) ? 'pink' : (tint && PALETTES[tint] ? tint : (power >= 0.9 ? 'heavy' : 'hit'));
    const pal = PALETTES[name];
    // 만화식 폭발 실루엣: 꼭짓점마다 반지름이 들쭉날쭉한 별 모양
    const star = []; for (let i = 0; i < 14; i++) star.push(0.55 + Math.random() * 0.45);
    this.impacts.push({ pal, star, direction:this.impactDirection??0,
      x, y, power, age: 0, rot: Math.random() * Math.PI * 2,
      word: SFX_WORDS[Math.floor(Math.random() * SFX_WORDS.length)],
      wordRot: (Math.random() - 0.5) * 0.5, maxSpeed,
    });
    if (this.impacts.length > 6) this.impacts.shift();
    this.flash = Math.max(this.flash, .3 + .5 * Math.min(1, power));
    this.flashRGB = pal.flash;
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

    // 플래시는 의성어와 컬러 폭발 뒤에 깔아 잉크와 색이 씻겨 나가지 않게 한다.
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.flashRGB},${Math.min(.5, this.flash)})`;
      ctx.fillRect(0, 0, w, h);
      this.flash *= Math.exp(-dt * 16);
    }

    // ---- 만화 폭발 / 확장 링 / 일본어 의성어 ----
    // 화면 크기에 맞춰 연출을 줄이며, 접점의 흰 섬광은 3D 깊이 검사를 유지한다.
    const impactScale = Math.min(1, Math.min(w, h) / 800);
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const im = this.impacts[i]; im.age += dt;
      const duration = .42;
      if (im.age >= duration) { this.impacts.splice(i, 1); continue; }
      const k = im.age / duration, e = 1 - Math.pow(1-k, 3), P = im.power, pal = im.pal;
      ctx.save();ctx.translate(im.x, im.y);ctx.scale(impactScale, impactScale);
      if (k < .55) {
        const kk = k / .55, ee = 1 - Math.pow(1-kk, 2.2);
        const core = (36 + 52*P) * (.55 + .75*ee);
        ctx.globalAlpha = 1-kk;ctx.beginPath();
        for (let j=0;j<im.star.length;j++) {
          const a = im.rot + j/im.star.length*Math.PI*2;
          const r = core * (j%2 ? im.star[j]*.65 : 1);
          if(j===0)ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);else ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);
        }
        ctx.closePath();ctx.lineJoin='miter';ctx.lineWidth=6;ctx.strokeStyle='#14101c';
        ctx.fillStyle=`rgb(${pal.spikes==='rainbow'?'255,240,90':pal.spikes[0]})`;ctx.stroke();ctx.fill();
        if(this.impactImage.complete&&this.impactImage.naturalWidth)ctx.drawImage(this.impactImage,-core,-core*.5,core*2,core);
        ctx.globalAlpha=1;
      }
      const rad = 30 + (220 + 200*P)*e;
      for(let j=0;j<2;j++) {
        ctx.lineWidth=Math.max(.5,(j?6:18+10*P)*(1-k));ctx.strokeStyle=`rgba(${pal.ring[j]},${(1-k)*.9})`;
        ctx.beginPath();ctx.arc(0,0,rad*(j?.72:1),0,Math.PI*2);ctx.stroke();
      }
      // Broken swirling pressure rings, plus curved directional air blades.
      ctx.save();ctx.rotate(im.direction);
      for(let j=0;j<3;j++){
        const a=im.rot+j*Math.PI*2/3+k*.8;
        ctx.lineWidth=Math.max(.5,(9-j*2)*(1-k));ctx.strokeStyle=`rgba(200,237,255,${.8*(1-k)})`;
        ctx.beginPath();ctx.arc(0,0,rad*(.82+j*.16),a,a+1.35);ctx.stroke();
      }
      if(k<.7){
        ctx.globalAlpha=Math.pow(1-k/.7,1.3);
        const L=(120+140*P)*(.5+e),H=(40+35*P)*(1-k);
        for(const sign of [-1,1]){
          ctx.fillStyle='rgba(222,247,255,.85)';ctx.beginPath();ctx.moveTo(-L,-H*sign);
          ctx.quadraticCurveTo(-L*.25,-H*2.1*sign,L*.32,0);
          ctx.quadraticCurveTo(-L*.30,-H*1.2*sign,-L,-H*sign);ctx.fill();
          for(let j=0;j<2;j++){ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=2-j*.7;ctx.beginPath();ctx.moveTo(-L*(1+j*.08),-H*(1.35+j*.35)*sign);ctx.quadraticCurveTo(-L*.3,-H*(2.4+j*.35)*sign,L*.24,0);ctx.stroke();}
        }
      }
      ctx.restore();
      ctx.globalAlpha=1-k;
      for(let j=0;j<14;j++) {
        const a=im.rot+j/14*Math.PI*2, L=(130+260*P)*e*(.6+.4*Math.abs(Math.sin(j*2.7))), wd=(24+14*P)*(1-k);
        ctx.fillStyle=pal.spikes==='rainbow'?`hsl(${Math.round(j/14*360+k*120)},100%,62%)`:`rgb(${pal.spikes[j%pal.spikes.length]})`;
        ctx.strokeStyle='rgba(0,0,0,.85)';ctx.lineWidth=3;ctx.beginPath();
        ctx.moveTo(Math.cos(a)*20,Math.sin(a)*20);
        ctx.lineTo(Math.cos(a+.06)*(20+wd),Math.sin(a+.06)*(20+wd));
        ctx.lineTo(Math.cos(a)*(20+L),Math.sin(a)*(20+L));
        ctx.lineTo(Math.cos(a-.06)*(20+wd),Math.sin(a-.06)*(20+wd));
        ctx.closePath();ctx.stroke();ctx.fill();
      }
      for(let j=0;j<12;j++){
        const a=im.rot+j/12*Math.PI*2,r=rad*(.6+(j%3)*.12),length=(24+50*P)*(1-k);
        ctx.strokeStyle=j%2?'#fff':`rgb(${pal.ring[1]})`;ctx.lineWidth=(j%3?2:4)*(1-k);ctx.beginPath();
        ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);ctx.lineTo(Math.cos(a)*(r+length),Math.sin(a)*(r+length));ctx.stroke();
      }
      ctx.restore();
      if(im.age<.4) {
        const pop=k<.2?1.6-3*k:1, size=(60+60*P)*pop*impactScale;
        ctx.save();ctx.font=`900 ${size}px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif`;
        const half=Math.min(w/2,ctx.measureText(im.word).width*.55+12);
        ctx.translate(Math.max(half,Math.min(w-half,im.x+60*impactScale)),Math.max(size,Math.min(h-size*.3,im.y-50*impactScale)));
        ctx.rotate(im.wordRot);ctx.textAlign='center';ctx.lineJoin='round';ctx.lineWidth=12*impactScale;
        ctx.strokeStyle=`rgba(0,0,0,${1-k*.8})`;ctx.strokeText(im.word,0,0);
        ctx.fillStyle=`rgba(${pal.word},${1-k*.8})`;ctx.fillText(im.word,0,0);ctx.restore();
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

  }
}
