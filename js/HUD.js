// HUD.js — 4인 체력바 / 로컬 Dempsey 게이지 / 콤보 / 승패 오버레이
import { SPECIALS } from './Specials.js';

export class HUD {
  constructor() {
    this._specials = { SPECIALS };
    this.top = document.getElementById('hud-fighters');
    this.gauge = document.getElementById('gauge-fill');
    this.gaugeWrap = document.getElementById('gauge-wrap');
    this.hits = document.getElementById('hits');
    this.skillU = document.getElementById('skill-u');
    this.skillI = document.getElementById('skill-i');
    this.ko = document.getElementById('ko-overlay');
    this.cards = [];
  }
  build(fighters, localSlot) {
    this.top.innerHTML = '';
    this.cards = fighters.map((f) => {
      const el = document.createElement('div');
      el.className = 'fcard' + (f.slot === localSlot ? ' me' : '');
      el.innerHTML = `<div class="name"><span class="tag">${f.nick || (f.isAI ? 'CPU' : 'P' + (f.netSlot + 1))}${f.slot === localSlot ? ' (YOU)' : ''}</span>${f.name}<span class="charge"></span><span class="hpnum"></span></div><div class="bar hp"><div class="fill"></div></div><div class="bar mini"><div class="fill"></div></div>`;
      this.top.appendChild(el);
      return { el, fill: el.querySelector('.hp .fill'), mini: el.querySelector('.mini'), miniFill: el.querySelector('.mini .fill'), charge: el.querySelector('.charge'), hpnum: el.querySelector('.hpnum') };
    });
  }
  update(dt, fighters, local) {
    fighters.forEach((f, i) => {
      const c = this.cards[i]; if (!c) return;
      const r = f.hp / f.maxHp;
      c.fill.style.width = (r * 100).toFixed(1) + '%';
      c.fill.classList.toggle('low', r < 0.3);
      c.hpnum.textContent = Math.ceil(f.hp) + '/' + f.maxHp;
      c.el.classList.toggle('ko', f.ko);
      c.el.classList.toggle('target', local && local.target === f);
      const d = f.dempsey;
      c.miniFill.style.width = d.gauge.toFixed(1) + '%';
      c.mini.classList.toggle('max', d.maxSpeed);
      c.charge.textContent = d.maxSpeed ? (d.charge > 0 ? `MAX ×${d.charge}` : 'MAX') : '';
    });
    if (!local) return;
    const d = local.dempsey;
    const lbl = document.getElementById('gauge-name');
    if (lbl) lbl.textContent = ({ dempsey: 'DEMPSEY', flicker: 'FLICKER', counter: 'COUNTER', smash: 'SMASH' })[d.style] || 'STANCE';
    this.gauge.style.width = d.gauge.toFixed(1) + '%';
    this.gaugeWrap.classList.toggle('max', d.maxSpeed);
    const gm = document.getElementById('gauge-max');
    const gb = document.getElementById('guard-badge'); if (gb) gb.classList.toggle('hidden', !local.guard);
    gm.textContent = (d.active && d.style === 'dempsey') ? 'DEMPSEY ROLL!!' : d.maxSpeed ? (d.charge > 0 ? `MAX ×${d.charge}  L=必殺` : 'MAX!!  L=必殺') : `${Math.floor(d.gauge)}%  때릴수록 찬다`;
    gm.style.opacity = d.maxSpeed || d.active ? 1 : 0.6;
    // 고유기 쿨다운
    const kit = local.kit;
    if (kit && this.skillU) {
      const { SPECIALS } = this._specials || {};
      const nm = (k) => (SPECIALS && SPECIALS[k]) ? SPECIALS[k].ko : k;
      this.skillU.innerHTML = `<b>U</b> ${nm(kit.U)}` + (local.cd.U > 0 ? ` <i>${local.cd.U.toFixed(1)}</i>` : '');
      this.skillI.innerHTML = `<b>I</b> ${nm(kit.I)}` + (local.cd.I > 0 ? ` <i>${local.cd.I.toFixed(1)}</i>` : '');
      this.skillU.classList.toggle('cd', local.cd.U > 0); this.skillI.classList.toggle('cd', local.cd.I > 0);
    }
    if (local.combo >= 2) {
      this.hits.textContent = `${local.combo} HITS!`;
      this.hits.style.transform = `scale(${1 + Math.min(0.5, local.comboTimer * 0.35)})`;
    } else this.hits.textContent = '';
  }
  shake(slot) {
    const c = this.cards[slot]; if (!c) return;
    c.el.classList.remove('shake'); void c.el.offsetWidth; c.el.classList.add('shake');
  }
  showKO(show, text = 'K.O.', sub = 'R 키로 재시작') {
    this.ko.classList.toggle('hidden', !show);
    this.ko.querySelector('.ko-text').textContent = text;
    this.ko.querySelector('.ko-sub').textContent = sub;
  }
}
