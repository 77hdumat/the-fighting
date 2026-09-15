// main.js — Game: 4인 난투. 모드: solo(로컬+CPU3) / host(방장 권위 시뮬 + 브로드캐스트) / client(입력 전송 + 스냅샷 보간 렌더)
import * as THREE from 'three';
import { buildRing } from './Ring.js';
import { Fighter } from './Fighter.js';
import { AIBrain } from './AIBrain.js';
import { InputState } from './InputState.js';
import { AfterImageEffect } from './AfterImageEffect.js';
import { CameraController } from './CameraController.js';
import { AudioManager } from './AudioManager.js';
import { SubtitleManager } from './SubtitleManager.js';
import { FxOverlay } from './FxOverlay.js';
import { PostFX } from './PostFX.js';
import { Input } from './Input.js';
import { Ribbon } from './Trails.js';
import { HUD } from './HUD.js';
import { Net } from './Net.js';
import { VoiceManager } from './VoiceManager.js';
import { HitSparks } from './HitSparks.js';
import { CoachBubble, CoachBrain } from './Coach.js';
import { Coaches } from './Coaches.js';
import { Intro } from './Intro.js';
import { CHARACTERS, CHARACTER_ORDER, HIDDEN_ORDER } from './Rig.js';
import { KITS, SPECIALS } from './Specials.js';
import { TouchControls, isTouchDevice } from './Touch.js';
import { Music } from './Music.js';

const _v = new THREE.Vector3();
const _prevHead = new THREE.Vector3();
const _camF = new THREE.Vector3();
const _camR = new THREE.Vector3();
const _sep = new THREE.Vector3();
const SPAWNS = [[0, 1.6], [0, -1.6], [1.6, 0], [-1.6, 0]];
const AUDIO_FWD = ['whoosh', 'swoosh', 'impact', 'bassHit', 'riser', 'maxSpeedHit', 'stagger', 'ko', 'block', 'chargeUp', 'finisherWind', 'finisherHit', 'counter', 'cheer', 'engine', 'clang', 'nyang', 'shutter'];
const SNAP_HZ = 20;

class Game {
  constructor() {
    const canvas = document.getElementById('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);

    this.input = new Input();
    this.touch = new TouchControls(this.input);
    this.isTouch = isTouchDevice();
    if (this.isTouch) document.body.classList.add('touch');
    window.addEventListener('contextmenu', (e) => { if (!(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'))) e.preventDefault(); });
    this.audio = new AudioManager();
    this.music = new Music(this.audio);
    this.subs = new SubtitleManager(document.getElementById('subtitle'));
    this.hud = new HUD();
    this.fx = new FxOverlay(document.getElementById('fx'));
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.camCtl = new CameraController(this.camera);
    this.ring = buildRing(this.scene);
    this.coaches = new Coaches(this.scene);
    this.intro = new Intro(this);
    this.phase = 'fight'; this.countT = 0; this.countStep = -1;
    this.net = new Net();
    this.voice = new VoiceManager(this.audio);
    this.subs.voice = this.voice;

    this.trailL = new Ribbon(this.scene, { maxPoints: 18, width: 0.2, color: 0xffb060, coreColor: 0xffffff });
    this.trailR = new Ribbon(this.scene, { maxPoints: 18, width: 0.2, color: 0xffb060, coreColor: 0xffffff });
    this.headTrail = new Ribbon(this.scene, { maxPoints: 40, width: 0.025, color: 0x2090ff, coreColor: 0xbfe8ff, opacity: 0.55 });
    this.ghostFx = {};   // defKey → AfterImageEffect (지연 생성)
    this.sparks = new HitSparks(this.scene);
    // 거리감 보조: 내 발밑에 리치 반경 링 (상대가 사거리 안이면 붉게)
    this.reachRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    this.reachRing.rotation.x = -Math.PI / 2; this.reachRing.position.y = 0.015; this.reachRing.visible = false;
    this.scene.add(this.reachRing);
    this.reachLine = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.04), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    this.reachLine.rotation.x = -Math.PI / 2; this.reachLine.position.y = 0.012; this.reachLine.visible = false;
    this.scene.add(this.reachLine);
    this.coach = new CoachBubble(this.voice);
    this.coachBrains = {};

    this.mode = null;            // 'solo' | 'host' | 'client'
    this.fighters = [];
    this.localSlot = 0;
    this.localInput = new InputState();
    this.netInputs = [null, new InputState(), new InputState(), new InputState()];
    this.snaps = [];             // client: 최근 스냅샷 2개
    this.pendingEvents = [];     // host: 다음 스냅샷에 실어 보낼 이벤트
    this.snapAccum = 0;
    this.simTime = 0; this.realTime = 0; this.last = performance.now();
    this.hitStop = 0; this.slowMo = 0; this.slowScale = 0.28;
    this.fStop = [0, 0, 0, 0]; this.fSlow = [[0, 1], [0, 1], [0, 1], [0, 1]]; // 파이터별 히트스톱/슬로모 (t, scale)
    this.excitement = 0; this.finisherWindT = 0;
    this.started = false; this.over = false;
    this.headScreen = new THREE.Vector2(0.5, 0.5);
    this.headVel = new THREE.Vector2();
    this.move = new THREE.Vector3();
    this.droneOn = false;
    // 적응형 품질: 평균 프레임시간이 나쁘면 자동으로 단계 하향 (2 풀 → 1 → 0). Q 키로 수동 순환
    this.quality = 2; this.frameAvg = 16; this.qualityCool = 0; this.hudAccum = 0;

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('error', (e) => this.showError(e.message || String(e.error)));
    window.addEventListener('unhandledrejection', (e) => this.showError(String(e.reason)));
    window.addEventListener('pointerdown', () => { this.audio.init(); this.music.resumePending(); this.music.play(this.started ? 'battle' : 'menu'); }, { once: true });
    // 포커스 진단: 마지막 키 입력 시각/코드 기록, 캔버스 클릭 시 입력창 포커스 해제
    this.lastKeyT = -99; this.lastKey = '';
    window.addEventListener('keydown', (e) => { this.lastKeyT = this.realTime; this.lastKey = e.code; }, true);
    canvas.addEventListener('pointerdown', () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); canvas.focus(); });
    this.setupLobby();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ================= 로비 =================
  setupLobby() {
    const $ = (id) => document.getElementById(id);
    $('btn-solo').addEventListener('click', () => {
      this.audio.init();
      this.startMatch('solo', this.soloCfg());
    });
    $('btn-host').addEventListener('click', () => { this.audio.init(); this.hostRoom(); });
    $('btn-join').addEventListener('click', () => { this.audio.init(); const c = $('join-code').value; if (c.length === 5) this.joinRoom(c); });
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); e.stopPropagation(); });
    $('btn-start').addEventListener('click', () => this.hostStart());
    $('btn-leave').addEventListener('click', () => this.confirmLeave());
    // 전체화면: 사용자 제스처 안에서만 가능. iOS Safari 는 미지원 → '홈 화면에 추가' 안내
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.goFullscreen = () => {
      const el = document.documentElement;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen;
      if (fn && !document.fullscreenElement) { try { const p = fn.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); } catch (e) {} try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }
      else if (document.fullscreenElement) { document.exitFullscreen && document.exitFullscreen(); }
      else if (isIOS) this.subs.show('iOS: 공유 → 홈 화면에 추가 → 앱처럼 전체화면', { duration: 3, voice: false });
    };
    $('btn-fs').addEventListener('click', () => this.goFullscreen());
    $('btn-fs-menu').addEventListener('click', () => this.goFullscreen());
    if (isIOS && !navigator.standalone) $('btn-fs-menu').textContent = '전체화면: 공유 → 홈 화면에 추가';
    // 터치 기기는 게임 시작 제스처에서 자동 전체화면
    for (const id of ['btn-solo', 'btn-start']) $(id).addEventListener('click', () => { if (this.isTouch && !isIOS) this.goFullscreen(); });
    $('btn-next-lobby').addEventListener('click', () => this.requestLobby());
    $('btn-next-leave').addEventListener('click', () => this.confirmLeave());
    $('btn-menu').addEventListener('click', () => this.togglePause());
    $('btn-pm-resume').addEventListener('click', () => this.togglePause(false));
    $('btn-pm-lobby').addEventListener('click', () => { this.togglePause(false); this.requestLobby(); });
    $('btn-pm-leave').addEventListener('click', () => { this.togglePause(false); this.confirmLeave(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.started && !(e.target && e.target.tagName === 'INPUT')) this.togglePause(); });
    // 방코드 클릭 → 클립보드 복사 (URL 포함 텍스트도 함께)
    const codeEl = $('room-code');
    codeEl.title = '클릭하면 복사';
    const copyCode = async () => {
      const code = codeEl.textContent.trim();
      if (!code || code === '-----') return;
      const text = `${location.origin}${location.pathname}  방코드: ${code}`;
      try { await navigator.clipboard.writeText(text); }
      catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      codeEl.classList.add('copied');
      this.lobbyMsg(`복사됨: ${code} (URL 포함)`);
      setTimeout(() => codeEl.classList.remove('copied'), 900);
    };
    codeEl.addEventListener('click', copyCode);
    $('netinfo').addEventListener('click', () => { if (this.net.code) { codeEl.textContent = this.net.code; copyCode(); } });
    // ---- 캐릭터 선택 ----
    try { this.myChar = localStorage.getItem('dr-char') || 'ippo'; } catch (e) { this.myChar = 'ippo'; }
    if (!CHARACTERS[this.myChar]) this.myChar = 'ippo';
    const DESC = {
      ippo: { style: '인파이터', st: '<b>SPACE</b> 뎀프시롤 · <b>U</b> 가젤 펀치(띄움) · <b>I</b> 리버 블로(주저앉힘) · <b>L</b> 필살 훅' , pw: 3, sp: 3, hp: 3 },
      mashiba: { style: '히트맨 · 최장 리치', st: '<b>SPACE</b> 플리커 러시 · <b>U</b> 플리커 3연(무예비) · <b>I</b> 초핑 라이트 · <b>L</b> 초핑 라이트 강', pw: 3, sp: 4, hp: 3 },
      miyata: { style: '아웃복서 · 카운터', st: '<b>SPACE</b> 카운터 스탠스(피격 시 자동 회피→졸트) · <b>U</b> 졸트 · <b>I</b> 백스텝 잽 · <b>L</b> 졸트 블로', pw: 2, sp: 5, hp: 2 },
      sendo: { style: '파워 슬러거 · 느리지만 한 방', st: '<b>U</b> 스매시(띄움) · <b>I</b> 러시 3연 · <b>L</b> 스매시 강', pw: 5, sp: 1, hp: 4 },
      chaechae: { style: '히든 · 문화생활 인플루언서', st: '<b>기본</b> 냥냥펀치(초고속·경량) · <b>U</b> 냥냥 4연타 · <b>I</b> 고양이 할퀴기 · <b>L</b> <b>릴스</b>(상대를 붙잡고 같이 춤 → 다운)<br><i>기 게이지 15% 빨리 참</i>', pw: 1, sp: 5, hp: 2 },
      jjeonghyo: { style: '히든 · 3대 500', st: '<b>기본</b> 덤벨 펀치(무겁고 느림) · <b>U</b> 덤벨 훅 · <b>I</b> 데드리프트 업(띄움) · <b>L</b> <b>바벨 내려찍기</b><br><i>기 게이지 20% 느림 · 체력 최고</i>', pw: 5, sp: 2, hp: 5 },
      ppyeo: { style: '히든 · 오토바이 라이더', st: '<b>기본</b> 뼈펀치(리치 최장) · <b>U</b> 뼈 찌르기 · <b>I</b> 회전 팔꿈치 · <b>L</b> <b>오토바이 돌진</b>(소음공해·날려버림)<br><i>몸이 얇아 맷집 약함</i>', pw: 3, sp: 4, hp: 2 },
    };
    this.charDesc = DESC;
    this.buildCharSel($('charsel'));
    this.buildCharSel($('charsel2'));
    $('btn-next').addEventListener('click', () => this.nextMatch());
    try { $('nick').value = localStorage.getItem('dr-nick') || ''; } catch (e) {}
    $('nick').addEventListener('input', () => { try { localStorage.setItem('dr-nick', $('nick').value); } catch (e) {} });
    $('nick').addEventListener('keydown', (e) => e.stopPropagation());
    try { $('intro').value = localStorage.getItem('dr-intro') || ''; } catch (e) {}
    $('intro').addEventListener('input', () => { try { localStorage.setItem('dr-intro', $('intro').value); } catch (e) {} });
    $('intro').addEventListener('keydown', (e) => e.stopPropagation());
    // 인트로 스킵: 클릭 / Space / Enter
    const skip = () => { if (this.phase === 'intro') { if (this.mode === 'client') this.net.send({ t: 'skip' }); else this.voteSkip(this.localFighter ? this.localFighter.netSlot : 0); } };
    window.addEventListener('pointerdown', (e) => { if (this.started && !(e.target && e.target.tagName === 'INPUT')) skip(); });
    window.addEventListener('keydown', (e) => { if ((e.code === 'Space' || e.code === 'Enter') && this.started && !(e.target && e.target.tagName === 'INPUT')) skip(); });
    window.addEventListener('keydown', (e) => {
      const typing = e.target && e.target.tagName === 'INPUT';
      // Enter 는 채팅 전용 (게임 시작은 버튼으로만)
      if (e.code === 'Enter' && !typing && this.net.role !== 'none') { $('chat-input').focus(); e.preventDefault(); }
    });
    // ---- 채팅 ----
    const ci = $('chat-input');
    ci.addEventListener('keydown', (e) => {
      e.stopPropagation();
      // 한글 IME 조합 중 Enter 는 조합 확정용 → 무시 (마지막 글자가 다시 입력되는 문제 방지)
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { ci.value = ''; ci.blur(); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = ci.value.trim();
        if (text) this.sendChat(text);
        ci.value = '';
        setTimeout(() => { ci.value = ''; }, 0);   // 입력창은 열어둔다 (Esc 로 닫기)
        this.chatIdle = 0;
      }
    });
    ci.addEventListener('focus', () => { this.input.down.clear(); document.getElementById('chat').classList.add('typing'); this.chatIdle = 0; });
    ci.addEventListener('blur', () => document.getElementById('chat').classList.remove('typing'));
    ci.addEventListener('input', () => { this.chatIdle = 0; });
    // 입력창이 비어있는 채로 6초 방치되면 자동으로 닫는다 (실수로 열어둔 채 게임 키가 먹통 되는 것 방지)
    setInterval(() => { if (document.activeElement === ci) { this.chatIdle = (this.chatIdle || 0) + 0.5; if (this.chatIdle >= 15 && !ci.value) ci.blur(); } }, 500);
  }

  get myIntro() { return ((document.getElementById('intro').value || '').trim().slice(0, 40)); }
  get myNick() {
    const v = (document.getElementById('nick').value || '').trim().slice(0, 12);
    return v || (this.net.role === 'client' ? 'P' + (this.net.mySlot + 1) : 'HOST');
  }
  nickOf(netSlot) { return (this.names && this.names[netSlot]) || (netSlot === 0 ? 'HOST' : 'P' + (netSlot + 1)); }
  get hiddenShown() { try { return localStorage.getItem('dr-hidden') === 'on'; } catch (e) { return false; } }
  set hiddenShown(v) { try { localStorage.setItem('dr-hidden', v ? 'on' : 'off'); } catch (e) {} }

  buildCharSel(container) {
    const DESC = this.charDesc;
    container.innerHTML = '';
    const keys = CHARACTER_ORDER.concat(this.hiddenShown ? HIDDEN_ORDER : []);
    for (const key of keys) {
      const c = CHARACTERS[key], dsc = DESC[key];
      const card = document.createElement('div');
      card.className = 'card' + (key === this.myChar ? ' sel' : '') + (c.hidden ? ' hidden-char' : '');
      card.dataset.key = key;
      const bar = (v) => `<i style="width:${v * 20}%"></i>`;
      card.innerHTML = `<div class="nm">${c.name}</div><div class="st">${dsc.style}<br>${dsc.st}</div><div class="bars"><span>HP</span>${bar(dsc.hp)}<span>PWR</span>${bar(dsc.pw)}<span>SPD</span>${bar(dsc.sp)}</div>`;
      card.addEventListener('click', () => this.pickChar(key));
      container.appendChild(card);
    }
    // 기존 캐릭터 오른쪽 끝: 히든 버튼
    const btn = document.createElement('div');
    btn.className = 'card hidden-btn' + (this.hiddenShown ? ' open' : '');
    btn.innerHTML = this.hiddenShown
      ? '<div class="q">×</div><div class="lbl">히든 닫기</div>'
      : '<div class="q">?</div><div class="lbl">히든</div>';
    btn.addEventListener('click', () => {
      this.hiddenShown = !this.hiddenShown;
      if (!this.hiddenShown && CHARACTERS[this.myChar] && CHARACTERS[this.myChar].hidden) this.pickChar('ippo');
      this.buildCharSel(document.getElementById('charsel'));
      this.buildCharSel(document.getElementById('charsel2'));
      if (this.hiddenShown) { try { this.audio.init(); this.audio.chargeUp(3); } catch (e) {} }
    });
    container.appendChild(btn);
  }

  /** 경기 종료 후 캐릭터 재선택 패널 */
  showNextPanel() {
    const el = document.getElementById('next-overlay');
    el.classList.remove('hidden');
    const btn = document.getElementById('btn-next');
    const msg = document.getElementById('next-msg');
    if (this.mode === 'client') { btn.disabled = true; msg.textContent = '캐릭터를 고르면 방장에게 전달됩니다. 방장이 시작하면 자동 진행'; }
    else { btn.disabled = false; msg.textContent = this.mode === 'host' ? '참가자들이 고른 캐릭터로 시작합니다' : (this.soloResult || this.soloLabel()); }
    document.querySelectorAll('.charsel .card').forEach((c) => c.classList.toggle('sel', c.dataset.key === this.myChar));
    const lb = document.getElementById('btn-next-lobby'), lv = document.getElementById('btn-next-leave');
    lb.textContent = this.mode === 'solo' ? '메뉴로' : '대기실로';
    lb.classList.toggle('hidden', this.mode === 'client');
    lv.textContent = '나가기';
  }

  /** 다음 경기 (호스트/솔로): 현재 선택된 캐릭터들로 재구성 */
  nextMatch() {
    if (this.mode === 'client') return;
    let cfg;
    if (this.mode === 'solo') {
      cfg = this.soloCfg();
    } else {
      this.chars[0] = this.myChar;
      cfg = [];
      this.intros[0] = this.myIntro;
      this.roster.forEach((r, i) => { if (r.type !== 'empty') cfg.push({ type: r.type, netSlot: i, name: this.names[i], char: this.chars[i] || this.charOf(i), intro: (this.intros && this.intros[i]) || '' }); });
      if (cfg.length < 2) { document.getElementById('next-msg').textContent = '2명 이상 필요'; return; }
      this.net.broadcast({ t: 'restart', cfg });
    }
    this.cfg = cfg;
    document.getElementById('next-overlay').classList.add('hidden');
    this.resetMatch();
  }

  // ================= 연습 모드 (1:1 래더) =================
  get soloLevel() { let v = 1; try { v = parseInt(localStorage.getItem('dr-level') || '1', 10) || 1; } catch (e) {} return Math.max(1, v); }
  set soloLevel(v) { try { localStorage.setItem('dr-level', String(v)); } catch (e) {} }
  /** 레벨당 난이도 1.4배 (기하급수). 반응·읽기·공격 빈도·고유기 빈도·위력·HP 모두 오른다 */
  soloDiff(level = this.soloLevel) { return Math.pow(1.4, level - 1); }
  soloCfg() {
    const others = CHARACTER_ORDER.filter((k) => k !== this.myChar);
    const opp = others[(this.soloLevel - 1) % others.length];
    return [{ type: 'local', char: this.myChar, intro: this.myIntro }, { type: 'ai', char: opp, level: this.soloLevel }];
  }
  soloLabel() { const lv = this.soloLevel; return `연습 LV ${lv} · 난이도 ×${this.soloDiff(lv).toFixed(1)}`; }

  // ================= 방 나가기 / 대기실 =================
  togglePause(force) {
    const el = document.getElementById('pause-menu');
    const show = force === undefined ? el.classList.contains('hidden') : force;
    if (show && !this.started) return;
    el.classList.toggle('hidden', !show);
    const lb = document.getElementById('btn-pm-lobby'), lv = document.getElementById('btn-pm-leave');
    lb.textContent = this.mode === 'solo' ? '메뉴로' : '대기실로';
    lb.classList.toggle('hidden', this.mode === 'client');   // 클라는 방장 결정에 따름
    lv.textContent = '나가기';
    this.input.down.clear();
  }

  /** 경기 화면 정리 (파이터 제거, 오버레이 숨김). 연결은 유지 */
  teardownMatch() {
    for (const f of this.fighters) this.scene.remove(f.rig.root);
    this.fighters = [];
    for (const k in this.ghostFx) { for (const g of this.ghostFx[k].ghosts) this.scene.remove(g.root); }
    this.ghostFx = {};
    this.started = false; this.over = false; this.phase = 'lobby';
    this.hitStop = 0; this.slowMo = 0; this.snaps = []; this.coachBrains = {};
    try { this.audio.stopDrone(); } catch (e) {}
    for (const id of ['next-overlay', 'pause-menu', 'skip-hint', 'countdown', 'intro-name', 'coach', 'guard-badge']) document.getElementById(id).classList.add('hidden');
    this.hud.showKO(false);
    this.touch.setVisible(false);
    document.getElementById('netinfo').textContent = '';
  }

  /** 대기실로: 솔로 = 메뉴, 호스트 = 전원 대기실, 클라 = 방장에게 요청 */
  requestLobby() {
    if (this.mode === 'solo') { this.teardownMatch(); this.showMenu(); return; }
    if (this.mode === 'host') { this.net.started = false; this.net.broadcast({ t: 'tolobby' }); this.returnToLobby(); }
    else this.net.send({ t: 'wantlobby' });
  }

  returnToLobby() {
    this.teardownMatch();
    this.music.pendingTrack = 'menu'; this.music.play('menu');
    document.getElementById('start-overlay').classList.remove('hidden');
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
    this.showChat(true);
    if (this.mode === 'host' || this.net.role === 'host') { this.renderRoster(this.roster); this.broadcastLobby(); this.lobbyMsg('대기실. 참가자가 모이면 시작 버튼'); }
    else this.lobbyMsg('대기실. 방장이 시작할 때까지 대기…');
  }

  showMenu() {
    this.music.pendingTrack = 'menu'; this.music.play('menu');
    document.getElementById('start-overlay').classList.remove('hidden');
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
    document.getElementById('room-code').textContent = '-----';
    document.getElementById('roster').innerHTML = '';
    this.showChat(false);
    const log = document.getElementById('chat-log'); if (log) log.innerHTML = '';
  }

  confirmLeave() {
    const q = this.mode === 'solo' && this.net.role === 'none' ? '그만두고 메뉴로 갈까요?' : this.net.role === 'host' ? '방을 닫을까요? (방장은 다음 사람에게 넘어갑니다)' : '방을 나갈까요?';
    if (window.confirm(q)) this.leaveRoom();
  }

  /** 방 나가기: 연결 끊고 메뉴로. 호스트면 방이 닫히고 클라들도 메뉴로 튕김 */
  leaveRoom(reason) {
    if (this.started) this.teardownMatch();
    try { this.net.close(); } catch (e) {}
    this.net = new Net();
    this.roster = null; this.names = [this.myNick]; this.chars = [this.myChar]; this.intros = [this.myIntro];
    this.mode = 'solo'; this.kicked = false; this.migrating = false;
    this.showMenu();
    if (reason) this.lobbyMsg(reason);
    const hint = document.querySelector('#menu .hint'); if (hint && reason) { hint.textContent = reason; setTimeout(() => { hint.textContent = 'J/K 펀치 · U 반격기 · I 고유기 · L 필살 · SHIFT 가드'; }, 4000); }
  }

  /** 방장이 나감 → 남은 사람 중 가장 앞 슬롯이 새 방장 (같은 방코드로 재개설), 나머지는 재접속 */
  migrateHost() {
    if (this.migrateLock && performance.now() - this.migrateLock < 4000) return;   // 중복 호출 방지
    this.migrateLock = performance.now();
    const code = this.net.code; const me = this.lastSlot ?? this.net.mySlot;
    if (this.started) this.teardownMatch();
    const remotes = (this.rosterRaw || []).map((r, i) => (r && r.type !== 'empty' && i !== 0 ? i : -1)).filter((i) => i >= 0);
    if (!remotes.includes(me)) remotes.push(me);
    const successor = Math.min(...remotes);
    this.net.close(); this.net = new Net();
    if (successor === me) {
      this.mode = 'host';
      this.lobbyMsg('방장이 나갔습니다. 내가 새 방장이 됩니다…');
      this.hostRoom(code);
      setTimeout(() => this.addChat(0, '방장 승계: 내가 새 방장', true), 1200);
    } else {
      this.migrating = true; this.migrateTries = 0; this.migrateTimer = null;
      this.mode = 'client';
      this.lobbyMsg('방장이 나갔습니다. 새 방장에게 재접속 중…');
      this.showLobby(code);
      setTimeout(() => this.joinRoom(code), 2200);
    }
  }

  /** 호스트: 강퇴 (대기실·경기 중 모두 가능) */
  kickPlayer(slot) {
    if (this.net.role !== 'host' || slot === 0) return;
    const name = this.chatName(slot);
    this.net.kick(slot);
    this.addChat(0, `${name} 강퇴됨`, true); this.net.broadcast({ t: 'chat', sys: true, text: `${name} 강퇴됨` });
  }

  chatName(netSlot) { return this.nickOf(netSlot); }
  charOf(netSlot) { return (this.chars && this.chars[netSlot]) || CHARACTER_ORDER[netSlot % 4]; }

  pickChar(key) {
    this.myChar = key;
    try { localStorage.setItem('dr-char', key); } catch (e) {}
    document.querySelectorAll('.charsel .card').forEach((el) => el.classList.toggle('sel', el.dataset.key === key));
    if (this.net.role === 'host') { this.chars[0] = key; if (this.roster) { this.roster[0].char = key; this.renderRoster(this.roster); this.broadcastLobby(); } }
    else if (this.net.role === 'client') this.net.send({ t: 'pick', char: key });
  }

  addChat(from, text, sys = false) {
    const log = document.getElementById('chat-log');
    const el = document.createElement('div');
    el.className = 'msg' + (sys ? ' sys' : '') + (from === this.net.mySlot && !sys ? ' me' : '');
    if (!sys) { const b = document.createElement('b'); b.textContent = this.chatName(from); el.appendChild(b); }
    el.appendChild(document.createTextNode(text));
    log.appendChild(el);
    while (log.children.length > 10) log.removeChild(log.firstChild);
  }

  sendChat(text) {
    if (this.net.role === 'host') { this.addChat(0, text); this.net.broadcast({ t: 'chat', from: 0, text }); }
    else if (this.net.role === 'client') this.net.send({ t: 'chat', text });
  }

  showChat(show) {
    const c = document.getElementById('chat');
    c.classList.toggle('hidden', !show);
    c.classList.toggle('lobby', !this.started);
  }

  lobbyMsg(t) { document.getElementById('lobby-msg').textContent = t; }

  showLobby(code) {
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
    document.getElementById('room-code').textContent = code;
  }

  renderRoster(list) {
    const ul = document.getElementById('roster');
    ul.innerHTML = '';
    list.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = r.type === 'empty' ? 'empty' : '';
      const who = r.type === 'empty' ? '빈 자리' : (r.name || this.nickOf(i)) + (r.type === 'local' ? ' (YOU)' : '');
      const ch = r.type === 'empty' ? '—' : CHARACTERS[r.char || this.charOf(i)].name;
      li.textContent = `${ch} · ${who}`;
      if (this.net.role === 'host' && r.type === 'remote') {
        const kb = document.createElement('button'); kb.className = 'kick'; kb.textContent = '강퇴'; kb.title = '강퇴';
        kb.addEventListener('click', (e) => { e.stopPropagation(); this.kickPlayer(i); });
        li.appendChild(kb);
      }
      ul.appendChild(li);
    });
  }

  hostRoom(code = null) {
    const net = this.net;
    this.names = [this.myNick]; this.chars = [this.myChar]; this.intros = [this.myIntro];
    this.roster = [{ type: 'local', name: this.myNick, char: this.myChar }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' }];
    net.onOpen = (code) => { this.showLobby(code); this.renderRoster(this.roster); document.getElementById('btn-start').classList.remove('hidden'); this.lobbyMsg('친구에게 코드를 알려주세요. 참가한 사람끼리만 싸웁니다 (2~4명). 시작 버튼으로 시작'); this.broadcastLobby(); };
    net.onError = (e) => this.lobbyMsg('연결 오류: ' + (e.type || e));
    net.onJoin = (slot) => { this.names[slot] = 'P' + (slot + 1); this.roster[slot] = { type: 'remote', name: this.names[slot] }; this.renderRoster(this.roster); this.broadcastLobby(); if (this.started) this.net.conns[slot - 1].send({ t: 'full' }); };
    net.onLeave = (slot) => {
      this.roster[slot] = { type: 'empty' }; this.renderRoster(this.roster); this.broadcastLobby();
      this.addChat(0, `${this.chatName(slot)} 퇴장`, true); this.net.broadcast({ t: 'chat', sys: true, text: `${this.chatName(slot)} 퇴장` });
      // 게임 중 이탈 → 그 선수는 다운 처리
      if (this.started) { const f = this.fighters.find((x) => x.netSlot === slot); if (f && !f.ko) f._die(); }
    };
    net.onMessage = (m, slot) => {
      if (m.t === 'in' && this.netInputs[slot]) this.netInputs[slot].set(m.d[0], m.d[1], m.d[2]);
      else if (m.t === 'chat' && typeof m.text === 'string') { const text = m.text.slice(0, 120); this.addChat(slot, text); this.net.broadcast({ t: 'chat', from: slot, text }); }
      else if (m.t === 'skip') { this.voteSkip(slot); }
      else if (m.t === 'wantlobby') { this.addChat(0, `${this.chatName(slot)} 님이 대기실로 가자고 합니다 (경기 종료 후 '대기실로' 버튼)`, true); }
      else if (m.t === 'pick') {
        if (CHARACTERS[m.char]) { this.chars[slot] = m.char; if (this.roster[slot]) this.roster[slot].char = m.char; this.renderRoster(this.roster); this.broadcastLobby(); }
      }
      else if (m.t === 'hello') {
        const name = String(m.name || '').trim().slice(0, 12) || 'P' + (slot + 1);
        this.names[slot] = name; if (this.roster[slot]) this.roster[slot].name = name;
        if (CHARACTERS[m.char]) { this.chars[slot] = m.char; this.roster[slot].char = m.char; }
        this.intros[slot] = String(m.intro || '').slice(0, 40);
        this.renderRoster(this.roster); this.broadcastLobby();
        this.addChat(0, `${name} 입장`, true); this.net.broadcast({ t: 'chat', sys: true, text: `${name} 입장` });
        if (this.started) { const f = this.fighters.find((x) => x.netSlot === slot); if (f) { f.nick = name; this.hud.build(this.fighters, this.localSlot); } }
      }
    };
    this.showChat(true);
    this.lobbyMsg('방 생성 중…');
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
    net.host(3, code);
  }

  broadcastLobby() { this.net.broadcast({ t: 'lobby', roster: this.roster, names: this.names, chars: this.chars }); }

  hostStart() {
    if (this.started) return;
    // 참가한 사람만 (빈 자리는 CPU 로 채우지 않음). netSlot = 접속 슬롯, 배열 인덱스 = 파이터 번호
    const cfg = [];
    this.roster.forEach((r, i) => { if (r.type !== 'empty') cfg.push({ type: r.type, netSlot: i, name: this.names[i], char: this.chars[i] || this.charOf(i), intro: (this.intros && this.intros[i]) || '' }); });
    if (cfg.length < 2) { this.lobbyMsg('2명 이상 참가해야 시작할 수 있습니다'); return; }
    this.net.started = true;
    this.net.broadcast({ t: 'start', cfg });
    this.startMatch('host', cfg);
  }

  joinRoom(code) {
    const net = this.net;
    net.onOpen = () => { this.showLobby(code); this.showChat(true); this.lobbyMsg('접속 완료. 방장이 시작할 때까지 대기…'); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };
    net.onError = (e) => {
      if (e.type === 'closed' && !this.migrating) { if (!this.kicked) this.migrateHost(); return; }
      if ((e.type === 'peer-unavailable' || e.type === 'closed') && this.migrating) {
        // 승계 중: 새 방장이 아직 방을 못 열었을 수 있음 → 재시도
        if (this.migrateTimer) return;   // 같은 시도에서 closed + unavailable 둘 다 올 수 있음 → 한 번만
        if (this.migrateTries < 8) { this.migrateTries++; this.lobbyMsg(`새 방장에게 재접속 중… (${this.migrateTries})`); const c = this.net.code; this.net.close(); this.net = new Net(); this.migrateTimer = setTimeout(() => { this.migrateTimer = null; this.joinRoom(c); }, 1500); }
        else { this.migrating = false; this.leaveRoom('방이 사라졌습니다'); }
        return;
      }
      this.lobbyMsg(e.type === 'peer-unavailable' ? '그 코드의 방이 없습니다' : '연결 오류: ' + (e.type || e));
    };
    net.onMessage = (m) => {
      if (m.t === 'welcome') { this.migrating = false; this.migrateTries = 0; this.lastSlot = m.slot; this.names = []; this.chars = []; net.send({ t: 'hello', name: this.myNick, char: this.myChar, intro: this.myIntro }); }
      else if (m.t === 'lobby') { this.rosterRaw = m.roster; this.names = m.names || []; this.chars = m.chars || []; this.renderRoster(m.roster.map((r, i) => (i === net.mySlot ? { type: 'local', name: r.name } : i === 0 ? { type: 'remote', name: r.name } : r))); }
      else if (m.t === 'full') this.lobbyMsg('방이 가득 찼거나 이미 시작됨');
      else if (m.t === 'start') { this.names = []; m.cfg.forEach((c) => { this.names[c.netSlot] = c.name; }); this.localSlot = Math.max(0, m.cfg.findIndex((c) => c.netSlot === net.mySlot)); this.startMatch('client', m.cfg); }
      else if (m.t === 'snap') { if (this.phase === 'fight') this.onSnapshot(m); }
      else if (m.t === 'skipv') { this.showSkipHint(m.n, m.total); }
      else if (m.t === 'phase') { if (m.p === 'countdown') this.endIntro(); else if (m.p === 'fight') { this.phase = 'fight'; document.getElementById('countdown').classList.add('hidden'); } }
      else if (m.t === 'chat') this.addChat(m.from, String(m.text).slice(0, 120), !!m.sys);
      else if (m.t === 'over') this.showWinner(m.winner);
      else if (m.t === 'tolobby') { this.mode = 'client'; this.returnToLobby(); }
      else if (m.t === 'kicked') { this.kicked = true; this.leaveRoom('방장이 강퇴했습니다'); }
      else if (m.t === 'restart') { if (m.cfg) { this.cfg = m.cfg; this.localSlot = Math.max(0, m.cfg.findIndex((c) => c.netSlot === net.mySlot)); } document.getElementById('next-overlay').classList.add('hidden'); this.resetMatch(); }
    };
    this.lobbyMsg('접속 중…');
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
    document.getElementById('room-code').textContent = code.toUpperCase();
    net.join(code);
  }

  // ================= 매치 =================
  makeProxies(slot) {
    const isLocal = () => slot === this.localSlot;
    const relevant = () => isLocal() || (this.localFighter && this.localFighter.target && this.localFighter.target.slot === slot);
    const audio = Object.create(this.audio);
    for (const n of AUDIO_FWD) {
      audio[n] = (...a) => {
        // 타인의 whoosh 는 거리감을 위해 생략 빈도↑ (소리 폭주 방지)
        if (n === 'whoosh' && !relevant()) return;
        this.audio[n](...a);
        if (n === 'swoosh' && relevant()) this.voice.grunt(slot, this.fighters[slot] ? this.fighters[slot].defKey : 'ippo', a[1] || 0.5);
        if (this.mode === 'host') this.pendingEvents.push({ t: 'a', n, a, s: slot });
      };
    }
    audio.startDrone = () => {}; audio.stopDrone = () => {}; audio.setDrone = () => {};
    const subs = {
      show: (text, o = {}) => {
        if (relevant()) this.subs.show(text, Object.assign({}, o, { speaker: isLocal() ? 'player' : 'opp', charKey: this.fighters[slot] ? this.fighters[slot].defKey : 'ippo' }));
        if (this.mode === 'host') this.pendingEvents.push({ t: 's', s: slot, text, o });
      },
    };
    return { audio, subs };
  }

  startMatch(mode, cfg) {
    this.mode = mode;
    this.cfg = cfg;
    if (mode !== 'client') this.localSlot = 0;
    this.buildFighters(cfg);
    this.started = true; this.over = false;
    if (this.isTouch) this.touch.setVisible(true);
    document.getElementById('start-overlay').classList.add('hidden');
    // 입력칸(코드/닉네임)에 남은 포커스 해제 — 안 하면 키 입력이 게임에 안 들어간다
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    try { document.getElementById('gl').focus(); window.focus(); } catch (e) {}
    this.input.down.clear();
    document.getElementById('netinfo').textContent = mode === 'solo' ? this.soloLabel() : `ROOM ${this.net.code} · ${mode.toUpperCase()} · Enter = 채팅`;
    if (mode !== 'solo') { this.showChat(true); this.addChat(0, '시합 개시. Enter 로 채팅', true); }
    this.music.pendingTrack = 'battle'; this.music.play('battle');
    this.beginIntro();
  }

  buildFighters(cfg) {
    for (const f of this.fighters) this.scene.remove(f.rig.root);
    this.fighters = cfg.map((c, i) => {
      const px = this.makeProxies(i);
      const f = new Fighter(this.scene, i, CHARACTERS[c.char] ? c.char : CHARACTER_ORDER[(c.netSlot ?? i) % 4], px.audio, px.subs);
      f.netSlot = c.netSlot ?? i;
      f.nick = c.name || (c.type === 'ai' ? 'CPU' : this.nickOf(f.netSlot));
      f.intro = c.intro || '';
      f.pos.set(SPAWNS[i][0], 0, SPAWNS[i][1]);
      f.forward.set(-SPAWNS[i][0], 0, -SPAWNS[i][1]).normalize();
      f.yaw = Math.atan2(f.forward.x, f.forward.z);
      if (c.type === 'ai') {
        if (this.mode !== 'client') {
          const lv = c.level || 1;
          new AIBrain(f, this.mode === 'solo' ? this.soloDiff(lv) : 1);
          if (this.mode === 'solo' && lv > 1) { f.maxHp = Math.round(f.def.hp * Math.pow(1.12, lv - 1)); f.hp = f.maxHp; f.nick = `CPU LV${lv}`; }
        } else f.isAI = true;
      }
      f._applyNow(f.pose);
      return f;
    });
    // 잔상 이펙트: 파이터(슬롯)마다 하나 (같은 캐릭터 중복 선택 가능하므로 캐릭터 키가 아니라 슬롯 기준)
    for (const k in this.ghostFx) { for (const g of this.ghostFx[k].ghosts) this.scene.remove(g.root); }
    this.ghostFx = {};
    for (const f of this.fighters) this.ghostFx[f.slot] = new AfterImageEffect(this.scene, f.def, f.slot === this.localSlot ? 7 : 5);
    this.hud.build(this.fighters, this.localSlot);
    this.hud.showKO(false);
    this.coachBrains = {};
    for (const f of this.fighters) if (!f.isAI) this.coachBrains[f.slot] = new CoachBrain();
    document.getElementById('coach').classList.add('hidden');
    this.hitStop = 0; this.slowMo = 0; this.snaps = [];
    this.camCtl.initialized = false;
  }

  resetMatch() { this.buildFighters(this.cfg); this.over = false; this.music.setDuck(1); this.music.play('battle'); if (this.mode === 'solo') document.getElementById('netinfo').textContent = this.soloLabel(); document.getElementById('next-overlay').classList.add('hidden'); this.hud.showKO(false); this.beginIntro(); }

  // ================= 인트로 스킵 (전원 동의) =================
  /** 사람 참가자 전원이 스킵을 눌러야 인트로가 끝난다 */
  voteSkip(netSlot) {
    if (this.phase !== 'intro' || this.mode === 'client') return;
    if (!this.skipVotes) this.skipVotes = new Set();
    this.skipVotes.add(netSlot);
    const humans = this.fighters.filter((f) => !f.isAI).map((f) => f.netSlot);
    const n = humans.filter((sl) => this.skipVotes.has(sl)).length;
    const total = Math.max(1, humans.length);
    this.showSkipHint(n, total);
    if (this.mode === 'host') this.net.broadcast({ t: 'skipv', n, total });
    if (n >= total) this.endIntro();
  }

  showSkipHint(n, total) {
    const el = document.getElementById('skip-hint');
    if (!el || el.classList.contains('hidden')) return;
    el.textContent = total > 1
      ? `스킵 ${n}/${total} — 전원이 눌러야 넘어갑니다 (SPACE / 클릭)`
      : 'SPACE / 클릭 = 스킵';
    el.classList.toggle('voted', n > 0);
  }

  // ================= 인트로 / 카운트다운 =================
  beginIntro() {
    this.phase = 'intro';
    this.skipVotes = new Set();
    this.intro.start();
    document.getElementById('skip-hint').classList.remove('hidden');
    const humans = this.fighters.filter((f) => !f.isAI).length;
    this.showSkipHint(0, Math.max(1, humans));
    document.getElementById('countdown').classList.add('hidden');
  }
  introName(f) {
    const el = document.getElementById('intro-name');
    el.querySelector('.nm').textContent = f.nick || f.name;
    el.querySelector('.ch').textContent = f.name + (f.isAI ? ' · CPU' : '');
    el.classList.remove('hidden'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(this._introNameT); this._introNameT = setTimeout(() => el.classList.add('hidden'), 3000);
  }
  endIntro() {
    if (this.phase !== 'intro') return;
    this.intro.finish();
    document.getElementById('intro-name').classList.add('hidden');
    document.getElementById('skip-hint').classList.add('hidden');
    this.subs.clear();
    this.phase = 'countdown'; this.countT = 0; this.countStep = -1;
    this.camCtl.initialized = false;
    if (this.mode === 'host') this.net.broadcast({ t: 'phase', p: 'countdown' });
  }
  updateCountdown(rawDt) {
    this.countT += rawDt;
    const step = Math.floor(this.countT);          // 0,1,2 → "3","2","1", 3 → FIGHT
    const el = document.getElementById('countdown');
    if (step !== this.countStep && step <= 3) {
      this.countStep = step;
      el.classList.remove('hidden', 'pop', 'fight'); void el.offsetWidth;
      if (step < 3) { el.textContent = String(3 - step); el.classList.add('pop'); this.audio.beep(false); }
      else { el.textContent = 'FIGHT!'; el.classList.add('pop', 'fight'); this.audio.bell(2); this.audio.beep(true); this.subs.show('ファイッ！', { duration: 1.1, mid: true }); }
    }
    if (this.countT >= 3.9) { el.classList.add('hidden'); this.phase = 'fight'; if (this.mode === 'host') this.net.broadcast({ t: 'phase', p: 'fight' }); }
  }

  get localFighter() { return this.fighters[this.localSlot]; }

  /** 카메라/FX 기준 시점: 로컬이 살아있으면 로컬, 아니면 첫 생존자 (관전) */
  viewPair() {
    const fs = this.fighters;
    let v = this.localFighter;
    if (!v || v.ko) v = fs.find((f) => !f.ko) || fs[0];
    let o = v.target || fs.find((f) => f !== v && !f.ko) || fs.find((f) => f !== v);
    if (this.mode === 'client' && v.targetSlot >= 0) o = fs[v.targetSlot] || o;
    return [v, o];
  }

  setQuality(q) {
    this.quality = q;
    this.post.quality = q; this.fx.quality = q;
    this.renderer.setPixelRatio(q === 2 ? Math.min(window.devicePixelRatio, 1.25) : q === 1 ? 1 : Math.min(1, window.devicePixelRatio * 0.75));
    this.renderer.shadowMap.enabled = q === 2;
    for (const k in this.ghostFx) this.ghostFx[k].max = q === 2 ? this.ghostFx[k].ghosts.length : Math.max(3, Math.floor(this.ghostFx[k].ghosts.length / 2));
    this.onResize();
    const el = document.getElementById('netinfo');
    if (el) el.dataset.q = q;
    this.subs.show(`QUALITY: ${['LOW', 'MID', 'HIGH'][q]}`, { duration: 0.8, voice: false });
  }

  showError(msg) {
    let el = document.getElementById('err');
    if (!el) {
      el = document.createElement('pre'); el.id = 'err';
      el.style.cssText = 'position:fixed;left:12px;top:70px;z-index:99;max-width:70vw;white-space:pre-wrap;color:#ff6b6b;background:rgba(0,0,0,.8);padding:10px 14px;font:13px/1.5 monospace;border-left:3px solid #ff3b3b;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent += msg + '\n';
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h); this.post.setSize(w, h); this.fx.resize();
  }

  project(worldPos, out) {
    _v.copy(worldPos).project(this.camera);
    out.set(_v.x * 0.5 + 0.5, 1 - (_v.y * 0.5 + 0.5));
    return out;
  }

  // ================= 히트 연출 (호스트/클라 공통) =================
  /** 히트스톱/슬로모: 관련자(때린 사람·맞은 사람)만 시간이 느려진다. 연출용 전역 값은 내가 관련된 경우만 */
  stopPair(ev, stopSec, slowSec = 0, slowScale = 1) {
    const involved = ev.a === this.localSlot || ev.b === this.localSlot;
    if (this.mode !== 'client') {
      this.applyStop(ev.a, stopSec); this.applyStop(ev.b, stopSec);
      if (slowSec > 0) { this.applySlow(ev.a, slowSec, slowScale); this.applySlow(ev.b, slowSec, slowScale); }
    }
    if (involved) { this.hitStop = Math.max(this.hitStop, stopSec); if (slowSec > 0) { this.slowMo = Math.max(this.slowMo, slowSec); this.slowScale = slowScale; } }
  }

  hitFx(ev) {
    const local = this.localSlot;
    const attacker = this.fighters[ev.a], target = this.fighters[ev.b];
    const res = ev.res;
    const pos = new THREE.Vector3(ev.pos[0], ev.pos[1], ev.pos[2]);
    const dir = new THREE.Vector3(ev.dir[0], 0, ev.dir[1]);
    const uv = this.project(pos, new THREE.Vector2());
    const px = uv.x * this.fx.w, py = uv.y * this.fx.h;
    const mine = ev.a === local, hurt = ev.b === local;
    const involved = mine || hurt;
    const P = ev.power;
    const body = ev.zone === 'body';
    if (attacker) attacker.squash[ev.side] = 1;
    if (res.ignore) return;
    if (res.dance) {
      // ---- 릴스: 셔터 + 하트 + 자막 ----
      this.audio.shutter(); this.audio.cheer(0.8);
      this.fx.addPopup(px, py, '릴스 촬영!', 'groggy');
      this.fx.addImpact(px, py, 0.9, true, [255, 120, 200]);
      this.sparks.burst(pos, dir, 22, new THREE.Color(1, 0.5, 0.8), 1.2, 0.8);
      this.camCtl.onHit(dir, 0.5);
      if (mine) this.subs.show('찍는다~ 하나 둘!', { duration: 1.6, mid: true });
      else if (hurt) this.subs.show('뭐, 뭐야 이거…!', { duration: 1.6, mid: true, speaker: 'opp' });
      setTimeout(() => { this.audio.shutter(); }, 700);
      setTimeout(() => { this.audio.shutter(); }, 1500);
      this.stopPair(ev, 0.12, 0.5, 0.35);
      return;
    }
    if (ev.kind === 'bike' && !res.blocked) {
      this.audio.engine(1.2);
      this.fx.addPopup(px, py, '부아아앙!!', 'groggy');
      this.fx.addSpeedBurst(1);
      this.camCtl.onHit(dir, 1.2);
    } else if (ev.kind === 'barbell' && !res.blocked) {
      this.audio.clang(1.2);
      this.fx.addPopup(px, py, '3대 500!', 'groggy');
      this.camCtl.onHit(dir, 0.9);
    }
    if (res.evaded) {
      // ---- 회피: 상대 주먹이 허공을 가른다. 뎀프시롤 회피는 「피함!」 팝업 ----
      this.audio.whoosh(1, 1.6, 0.8, true);
      this.sparks.burst(pos, dir, 6, new THREE.Color(0.7, 0.9, 1), 0.6, 0.3);
      if (target) target.blockGhost = 0.35;
      if (res.roll) {
        this.fx.addPopup(px, py, '피함!', 'dodge');
        if (hurt) this.subs.show('かわしたッ！', { duration: 0.8, voice: false });
        else if (mine) this.subs.show('当たらねぇ…！？', { duration: 0.8, speaker: 'opp', voice: false });
      } else if (hurt) this.subs.show('見切ったッ！', { duration: 0.9, mid: true });
      else if (mine) this.subs.show('見切られた…！？', { duration: 0.9, mid: true, speaker: 'opp' });
      this.stopPair(ev, 0.05);
      return;
    }
    if (res.downed) {
      // ---- 쓰러지는 상대에게 추가타: 몸이 날아가고, 코치가 말린다 ----
      this.audio.impact(0.6 + 0.4 * P); if (P > 0.8) this.audio.bassHit();
      this.sparks.burst(pos, dir, 18 + Math.round(20 * P), new THREE.Color(1, 0.9, 0.7), 1.4, 0.5);
      this.fx.addImpact(px, py, 0.6 * P, false);
      if (target) target.flash = 1;
      this.stopPair(ev, 0.04); if (mine) { this.camCtl.onHit(dir, 0.6 + 0.4 * P); const cb = this.coachBrains[ev.a]; if (cb) cb.onDownedHit(); }
      return;
    }
    if (hurt) { this.hud.shake(ev.b); const cb = this.coachBrains[ev.b]; if (cb && !res.blocked) cb.onHurt(ev.zone); }
    if (mine) this.hud.shake(ev.b);

    if (res.perfect) {
      // ---- 저스트 가드: 푸른 섬광 + 상대 경직 ----
      this.audio.block(); this.audio.riser(0.25, 0.3);
      this.fx.addImpact(px, py, 0.6, false);
      this.sparks.burst(pos, dir.clone().negate(), 26, new THREE.Color(0.5, 0.8, 1), 1.3, 0.5);
      this.stopPair(ev, 0.07);
      if (hurt) { this.camCtl.fovPunch = -6; this.subs.show('ジャストガード！！', { duration: 1.0, mid: true }); }
      else if (mine) this.subs.show('ジャストガード…！？', { duration: 1.0, mid: true, speaker: 'opp' });
      return;
    }
    if (res.blocked && res.heavy) {
      // ---- 강타를 가드로 받아냄: 방어자 중심 폭풍 — 푸른 충격파, 스파크 폭발, 카메라 진동, 잔상 ----
      this.audio.guardHeavy(P);
      this.fx.addImpact(px, py, 0.9 + 0.3 * P, false, 'blue');
      this.fx.flash = Math.max(this.fx.flash, 0.15); this.fx.flashRGB = '150,200,255';
      this.sparks.burst(pos, dir.clone().negate(), 34 + Math.round(20 * P), new THREE.Color(0.55, 0.8, 1), 1.5, 0.55);
      this.sparks.burst(pos, dir, 12, new THREE.Color(1, 1, 1), 0.8, 0.4);
      this.stopPair(ev, 0.06);
      this.post.onHit(0.7, uv.x, uv.y);
      this.camCtl.shakeAmp = Math.max(this.camCtl.shakeAmp, 0.09 + 0.1 * P);
      this.camCtl.kickVel.addScaledVector(dir, hurt ? 2.5 : 1.2);
      if (target) { target.blockGhost = 0.45; target.flash = 0.4; }
      if (hurt) { this.hud.shake(ev.b); if (Math.random() < 0.4) this.subs.show(Math.random() < 0.5 ? '受け止めたっ…！' : 'まだ耐えられる…！', { duration: 0.9, mid: true }); }
      else if (mine && Math.random() < 0.3) this.subs.show('固ぇ…！', { duration: 0.8, speaker: 'opp' });
      if (res.guardBreak) {
        this.subs.show('ガードが…！！', { duration: 1.2, mid: true, speaker: hurt ? 'player' : 'opp' });
        this.audio.impact(1); this.audio.bassHit(); this.camCtl.onHit(dir, 1);
      }
      return;
    }
    if (res.blocked && res.ko) {
      // 칩 데미지로 KO — 일반 KO 연출로 넘긴다
      this.stopPair(ev, 0.14, 1.6, 0.25);
      this.audio.impact(1);
      if (involved) this.subs.show('ダウン！！', { duration: 2.4, strong: true, speaker: hurt ? 'opp' : 'player' });
      return;
    }
    if (res.blocked) {
      this.audio.block();
      this.fx.addImpact(px, py, 0.25, false);
      this.sparks.burst(pos, dir, 8, new THREE.Color(0.8, 0.85, 1), 0.7, 0.35);
      this.stopPair(ev, 0.025); if (involved) this.camCtl.shakeAmp = Math.max(this.camCtl.shakeAmp, 0.02);
      if (res.guardBreak && involved) { this.subs.show('ガードが…！！', { duration: 1.2, mid: true, speaker: hurt ? 'player' : 'opp' }); this.audio.impact(0.8); this.camCtl.onHit(dir, 0.9); }
      else if (mine && Math.random() < 0.3) this.subs.show(Math.random() < 0.5 ? '読めてる…' : 'そんなもんか？', { duration: 0.9, speaker: 'opp' });
      return;
    }
    if (res.armored) {
      this.audio.impact(0.4);
      this.fx.addImpact(px, py, 0.3, false);
      this.sparks.burst(pos, dir, 10, new THREE.Color(1, 0.6, 0.3), 0.8, 0.4);
      if (mine) this.subs.show('効かねぇ…！！', { duration: 0.9, mid: true, speaker: 'opp' });
      if (hurt) this.subs.show('止まらねぇっ！！', { duration: 0.9, mid: true });
      return;
    }
    this.excitement = Math.min(1, this.excitement + 0.25 + 0.3 * P);
    this.ring.cheer(); this.audio.cheer(P);
    if (involved && target) this.voice.hurt(ev.b, target.defKey, P);
    if (target) target.flash = 1;
    if (ev.launch) { this.camCtl.shakeAmp = Math.max(this.camCtl.shakeAmp, 0.15); this.camCtl.fovPunch = -10; this.stopPair(ev, 0, 0.45, 0.35); this.audio.bassHit(); this.sparks.burst(pos, new THREE.Vector3(0, 1, 0), 24, new THREE.Color(1, 0.85, 0.5), 1.6, 0.5); }
    if (ev.liver) { this.stopPair(ev, 0.12); this.audio.bassHit(); if (hurt) this.subs.show('ぐ…息が…！', { duration: 1.1, mid: true }); else if (mine) this.subs.show('リバーが入った…！', { duration: 1.0 }); }
    if (ev.kind && !ev.finisher && (mine || hurt) && !ev.liver) { const sp = SPECIALS[ev.kind]; if (sp && Math.random() < 0.6) this.subs.show(sp.name + (ev.counter ? '、カウンター！！' : '！！'), { duration: 1.0, mid: true, speaker: mine ? 'player' : 'opp' }); }
    // 땀방울/스파크: 머리 타격은 위로 흩뿌리고, 보디는 낮고 넓게
    const n = Math.round(14 + 26 * P + (ev.counter || ev.finisher ? 30 : 0));
    const col = ev.counter || ev.finisher ? new THREE.Color(1, 0.75, 0.35) : body ? new THREE.Color(0.9, 0.95, 1) : new THREE.Color(1, 1, 1);
    this.sparks.burst(pos, dir, n, col, body ? 0.9 : 1.2 + 0.6 * P, body ? 0.5 : 0.55);

    if (ev.finisher) {
      this.stopPair(ev, 0.22, 1.1, 0.18);
      this.camCtl.onCounter(dir); this.camCtl.shakeAmp = 0.4;
      this.fx.addImpact(px, py, 1.6, true); this.fx.flash = 1.0;
      this.post.onHit(1.6, uv.x, uv.y);
      this.audio.finisherHit();
      if (involved) this.subs.show(ev.charge >= 2 ? 'ぶっ飛べぇぇぇっ！！！' : 'ぶっ飛べぇっ！！', { duration: 1.8, strong: true, speaker: mine ? 'player' : 'opp' });
      if (res.down) { this.fx.addPopup(px, py, 'DOWN!', 'groggy'); setTimeout(() => { if (involved && !this.over) this.subs.show(hurt ? '…立て…立つんだ…！' : '立ってくる…！？', { duration: 1.4, mid: true, speaker: hurt ? 'player' : 'opp' }); }, 1300); }
    } else if (ev.counter) {
      this.stopPair(ev, 0.17, 0.75, 0.3);
      this.camCtl.onCounter(dir);
      this.fx.addImpact(px, py, 1.3, true);
      if (hurt) this.fx.hurtFlash(1.2); else this.fx.flash = 0.8;
      this.post.onHit(1.2, uv.x, uv.y);
      this.audio.counter();
      if (involved) this.subs.line('counter', { strong: true, duration: 1.6, speaker: mine ? 'player' : 'opp' });
    } else if (hurt) {
      this.stopPair(ev, (ev.type === 'hook' ? 0.06 : 0.03) + (body ? 0.02 : 0));
      this.camCtl.onPlayerHit();
      this.camCtl.shakeAmp = Math.max(this.camCtl.shakeAmp, 0.07 + 0.16 * P);
      this.camCtl.kickVel.addScaledVector(dir, 2 + 3 * P);
      this.camCtl.rollKick = (Math.random() > 0.5 ? 1 : -1) * (0.03 + 0.05 * P);
      this.camCtl.fovPunch = 5 + 5 * P;
      this.fx.hurtFlash(P);
      setTimeout(() => { this.camCtl.shakeAmp = Math.max(this.camCtl.shakeAmp, 0.04 + 0.06 * P); }, 90); // 2차 진동
      this.fx.addImpact(px, py, 0.5 * P, false);
      this.audio.impact(0.35 + 0.5 * P);
      if (ev.dempsey && P > 0.9) this.audio.bassHit();
      if (res.staggered) this.subs.show('ぐぅっ…！', { duration: 1.0, mid: true });
      else if (res.interrupted) this.subs.show('しまっ…！', { duration: 0.9, mid: true });
      else if (Math.random() < 0.5) this.subs.line('hurt', { mid: true }); else this.subs.line('oppHit', { mid: true });
    } else {
      this.stopPair(ev, 0.05 + 0.05 * P + (body ? 0.02 : 0));
      if (mine) { this.camCtl.onHit(dir, P); this.post.onHit(P, uv.x, uv.y); this.fx.addImpact(px, py, P, ev.maxSpeed); }
      else this.fx.addImpact(px, py, 0.35 * P, false);
      this.audio.impact(mine ? P : P * 0.6);
      if (mine && P >= 0.75) this.audio.bassHit();
      if (P >= 0.95) this.stopPair(ev, 0, 0.25, 0.45);
      if (mine && !res.ko) {
        const r = Math.random();
        if (P >= 0.9 && r < 0.5) this.subs.line('bigHit', { mid: true });
        else if (r < 0.55) this.subs.line('hit');
        else this.subs.line('oppHurt');
      }
      if (res.groggy && !res.ko) { this.fx.addPopup(px, py, 'GROGGY!', 'groggy'); this.stopPair(ev, 0.12, 0.6, 0.35); this.camCtl.shakeAmp = Math.max(this.camCtl.shakeAmp, 0.14); this.audio.bassHit(); if (involved) this.subs.show(hurt ? 'ぐらっ…！' : 'グロッキーだ…！ 畳み掛けろッ！', { duration: 1.4, strong: !hurt, speaker: hurt ? 'player' : 'opp' }); if (target) target.flash = 1; }
      else if (mine && res.staggered && !res.ko) this.subs.show('効いてる…！', { duration: 1.2, mid: true });
    }
    if (res.ko) {
      this.stopPair(ev, 0.14, 1.6, 0.25);
      if (involved) this.subs.show('ダウン！！', { duration: 2.4, strong: true, speaker: hurt ? 'opp' : 'player' });
      else this.subs.show(`${target.name} ダウン！`, { duration: 1.6, mid: true });
    }
  }

  showWinner(slot) {
    this.over = true;
    this.music.setDuck(0.45);
    const w = this.fighters[slot];
    const me = slot === this.localSlot;
    const canRestart = this.mode !== 'client';
    // 승자 표기: 캐릭터명이 아니라 닉네임 (CPU 면 "CPU 캐릭터명")
    const who = w ? (w.isAI ? `CPU ${w.name}` : (w.nick || w.name)) : '';
    if (this.mode === 'solo') { if (me) { this.soloLevel = this.soloLevel + 1; } this.soloResult = me ? `클리어! 다음: ${this.soloLabel()}` : `패배… 다시: ${this.soloLabel()}`; }
    const title = me ? 'WINNER' : (w ? `${who} WIN` : 'DRAW');
    const sub = (me ? '승리! ' : (w ? `${who} (${w.name}) 승리. ` : '')) + (canRestart ? '아래에서 캐릭터를 고르고 R / 버튼' : '캐릭터를 고르고 방장을 기다리세요');
    setTimeout(() => this.hud.showKO(true, title, sub), 900);
    setTimeout(() => { if (this.over) this.showNextPanel(); }, 1800);
    if (w && !me) this.subs.show(`${who} の勝ち！`, { duration: 2.2, mid: true, voice: false });
  }

  // ================= 루프 =================
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    if (this.paused) return;   // 외부 시뮬/디버그용
    try { this.frame(now); } catch (e) {
      if (!this._errShown) { this._errShown = true; console.error(e); this.showError('[loop] ' + (e.stack || e)); }
    }
  }

  frame(now) {
    const rawDt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    this.realTime += rawDt;

    if (!this.started) {
      this.ring.update(rawDt, 0);
      this.coaches.update(rawDt, 0);
      this.camCtl.update(rawDt, { playerPos: new THREE.Vector3(0, 0, 1.3), oppPos: new THREE.Vector3(0, 0, -1.3), f: new THREE.Vector3(0, 0, -1), s: new THREE.Vector3(-1, 0, 0), intensity: 0, dempseyActive: false, sway: 0, maxSpeed: false, hitStop: 0 });
      this.post.update(rawDt, { intensity: 0, dempseyActive: false, maxSpeed: false, dirX: 0, dirY: 0, focusX: 0.5, focusY: 0.5, time: this.realTime });
      this.post.render();
      return;
    }

    // 시간 스케일은 파이터별로 (맞은 사람/때린 사람만 멈추고, 나머지는 정상 진행). 전역 hitStop/slowMo 는 연출(만화 프레임·카메라)용
    if (this.hitStop > 0) this.hitStop -= rawDt;
    else if (this.slowMo > 0) this.slowMo -= rawDt;
    const localScale = this.timeScaleOf(this.localSlot);
    const simDt = rawDt * localScale;
    this.simTime += simDt;

    // ---- 적응형 품질 ----
    this.frameAvg += (rawDt * 1000 - this.frameAvg) * 0.05;
    this.qualityCool -= rawDt;
    if (this.qualityCool <= 0) {
      if (this.frameAvg > 24 && this.quality > 0) { this.setQuality(this.quality - 1); this.qualityCool = 6; }
      else if (this.frameAvg < 13 && this.quality < 2 && this.autoQuality !== false) { this.setQuality(this.quality + 1); this.qualityCool = 10; }
    }
    const input = this.input;
    if (input.justPressed('KeyQ')) { this.autoQuality = false; this.setQuality((this.quality + 2) % 3); this.qualityCool = 999; }
    if (input.justPressed('KeyB')) { const on = this.music.toggle(); this.subs.show(`BGM: ${on ? 'ON' : 'OFF'}`, { duration: 0.8, voice: false }); }
    if (input.justPressed('KeyV')) { const m = this.voice.toggle(); this.subs.show(`VOICE: ${m.toUpperCase()}`, { duration: 0.8, voice: false }); }
    if (this.localFighter) { this.subs.myChar = this.localFighter.defKey; const tg = this.localFighter.target; if (tg) this.subs.oppChar = tg.defKey; }
    // R = 다음 경기: 경기가 끝난 뒤에만 (경기 중 오입력으로 리셋되지 않게)
    if (input.justPressed('KeyR') && this.mode !== 'client' && this.over) this.nextMatch();

    // 카메라 기준 이동 벡터 → 월드
    this.camera.getWorldDirection(_camF); _camF.y = 0; _camF.normalize();
    _camR.crossVectors(_camF, new THREE.Vector3(0, 1, 0)).normalize();
    this.move.set(0, 0, 0);
    if (input.isDown('KeyW')) this.move.add(_camF);
    if (input.isDown('KeyS')) this.move.sub(_camF);
    if (input.isDown('KeyD')) this.move.add(_camR);
    if (input.isDown('KeyA')) this.move.sub(_camR);
    if (this.move.lengthSq() > 0) this.move.normalize();
    else if (this.touch.active && (this.touch.move.x || this.touch.move.y)) { this.move.addScaledVector(_camF, this.touch.move.y).addScaledVector(_camR, this.touch.move.x); if (this.move.lengthSq() > 1) this.move.normalize(); }
    this.localInput.fromInput(input, this.move);

    if (this.phase === 'intro') {
      if (this.intro.update(rawDt)) this.endIntro();
    } else if (this.phase === 'countdown') {
      this.updateCountdown(rawDt);
    } else if (this.mode === 'client') {
      this.net.send({ t: 'in', d: this.localInput.pack() });
      this.clientInterpolate();
    } else {
      this.simulate(rawDt);
      if (this.mode === 'host') {
        this.snapAccum += rawDt;
        if (this.snapAccum >= 1 / SNAP_HZ) {
          this.snapAccum = 0;
          this.net.broadcast({ t: 'snap', ts: this.realTime, f: this.fighters.map((f) => f.snapshot()), ev: this.pendingEvents });
          this.pendingEvents = [];
        }
      }
    }
    this.localInput.endFrame();

    this.renderFrame(rawDt, simDt);
    input.endFrame();
  }

  timeScaleOf(slot) {
    if (this.fStop[slot] > 0) return 0.03;
    if (this.fSlow[slot][0] > 0) return this.fSlow[slot][1];
    return this.over ? 0.3 : 1;
  }
  applyStop(slot, sec) { if (slot >= 0) this.fStop[slot] = Math.max(this.fStop[slot], sec); }
  applySlow(slot, sec, scale) { if (slot >= 0) { const e = this.fSlow[slot]; if (sec > e[0] || scale < e[1]) { e[0] = Math.max(e[0], sec); e[1] = scale; } } }

  /** 호스트/솔로: 전원 시뮬레이션 (파이터별 시간 스케일) */
  simulate(rawDt) {
    const fs = this.fighters;
    const hits = [];
    for (const f of fs) {
      const sl = f.slot;
      if (this.fStop[sl] > 0) this.fStop[sl] -= rawDt; else if (this.fSlow[sl][0] > 0) this.fSlow[sl][0] -= rawDt;
      const simDt = rawDt * this.timeScaleOf(sl);
      let inp;
      if (f.isAI) inp = f.brain.update(simDt, fs);
      else if (f.slot === this.localSlot) inp = this.localInput;
      else inp = this.netInputs[f.netSlot] || this.netInputs[1];
      const hit = f.update(simDt, rawDt, inp, fs);
      if (hit) hits.push(hit);
      for (const e of f.events) {
        if (e.type === 'punchEnd') { const cb = this.coachBrains[f.slot]; if (cb) cb.onPunchEnd(e.hit); continue; }
        if (e.type === 'ropeLaunch') { this.ropeFx(f, e.k); if (this.mode === 'host') this.pendingEvents.push({ t: 'rope', s: f.slot, k: e.k }); continue; }
        if (e.type === 'special') continue;
        const type = e.type === 'finisherStart' ? 'finisher' : (e.punchType === 'special' ? 'hook' : e.punchType);
        for (const o of fs) if (o.brain && o !== f && (o.target === f || f.target === o)) o.brain.onEnemyPunch(type, f);
        if (e.type === 'finisherStart') { this.applySlow(f.slot, 0.5, 0.2); if (f.slot === this.localSlot) { this.finisherWindFx(); this.music.setDuck(0.35); setTimeout(() => this.music.setDuck(1), 2200); } }
        if (e.type === 'finisherStart' && this.mode === 'host') this.pendingEvents.push({ t: 'fin', s: f.slot });
      }
      if (inp !== this.localInput) inp.endFrame();
    }
    // 서로 겹치지 않게
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
      const a = fs[i], b = fs[j]; if (a.ko || b.ko) continue;
      _sep.subVectors(b.pos, a.pos); _sep.y = 0;
      const d = _sep.length();
      if (d < 0.8 && d > 1e-4) { _sep.multiplyScalar((0.8 - d) / d * 0.5); a.pos.sub(_sep); b.pos.add(_sep); }
    }
    for (const h of hits) {
      const counter = h.target.isCounterWindow && !h.finisher;
      const res = h.target.takeHit(h, counter);
      // 기(氣) 충전: 때릴수록 찬다. 막혀도 조금, 맞은 쪽도 조금
      if (!res.ignore && !res.downed && !h.finisher && h.attacker.rollT <= 0) {
        const base = h.kind ? 12 : h.type === 'hook' ? 8 : h.type === 'flicker' ? 4 : 6;
        const gm = h.attacker.def.gaugeMul || 1, tm = h.target.def.gaugeMul || 1;
        if (res.evaded) { /* 회피됨 */ }
        else if (res.blocked) { h.attacker.dempsey.addGauge(base * 0.4 * gm); h.target.dempsey.addGauge(2 * tm); }
        else { h.attacker.dempsey.addGauge(base * ((counter || h.counter) ? 1.5 : 1) * gm, true); if (h.target.rollT <= 0) h.target.dempsey.addGauge(2.5 * tm); }
      }
      if (res.perfect) { h.attacker.punch = null; h.attacker.queue.length = 0; h.attacker.bufferedHook = null; h.attacker.stagger = Math.max(h.attacker.stagger, 0.5); h.attacker.knock.addScaledVector(h.dir, -1.2); }
      if (h.finisher && !res.armored && !res.blocked && !res.downed && !res.ignore) {
        const extra = (12 + 6 * h.charge) * h.attacker.def.powerMul;
        h.target.hp = Math.max(0, h.target.hp - extra); res.dmg += extra;
        if (!res.down) h.target.stagger = Math.max(h.target.stagger, 2.6);
        if (h.target.hp <= 0 && !h.target.ko) { h.target._die(); res.ko = true; }
      }
      const ev = { t: 'hit', a: h.attacker.slot, b: h.target.slot, side: h.side, type: h.type, zone: h.zone || 'head', kind: h.kind || null, launch: h.launch || 0, liver: !!h.liver, power: +h.power.toFixed(2), pos: [h.pos.x, h.pos.y, h.pos.z], dir: [h.dir.x, h.dir.z], maxSpeed: !!h.maxSpeed, finisher: !!h.finisher, charge: h.charge || 0, counter: !!(counter || h.counter), dempsey: !!h.dempsey, res: { dmg: +res.dmg.toFixed(1), dance: !!res.dance, blocked: !!res.blocked, perfect: !!res.perfect, heavy: !!res.heavy, evaded: !!res.evaded, roll: !!res.roll, down: !!res.down, groggy: h.target.staggerKind === 'groggy' && !!res.staggered, guardBreak: !!res.guardBreak, armored: !!res.armored, staggered: !!res.staggered, interrupted: !!res.interrupted, ko: !!res.ko, downed: !!res.downed, ignore: !!res.ignore } };
      this.hitFx(ev);
      if (this.mode === 'host') this.pendingEvents.push(ev);
    }
    // 코치 판단 (사람 파이터만). 로컬이면 바로 표시, 원격이면 이벤트로 전달
    for (const slot in this.coachBrains) {
      const f = fs[slot]; const key = this.coachBrains[slot].update(rawDt, f, fs);
      if (!key) continue;
      this.coaches.shout(f.slot);
      if (f.slot === this.localSlot) this.coach.show(key);
      else if (this.mode === 'host') this.pendingEvents.push({ t: 'coach', s: f.slot, key });
    }
    if (!this.over) {
      const alive = fs.filter((f) => !f.ko);
      if (alive.length <= 1) {
        const w = alive[0] ? alive[0].slot : -1;
        this.showWinner(w);
        if (this.mode === 'host') this.net.broadcast({ t: 'over', winner: w });
      }
    }
  }

  /** 로프 반동 발사 연출 */
  ropeFx(f, k) {
    const dir = f.forward.clone();
    this.sparks.burst(f.hipsPos.clone().setY(0.6), dir.clone().negate(), 16 + Math.round(14 * k), new THREE.Color(1, 0.9, 0.6), 1.2 + k, 0.45);
    if (f.slot === this.localSlot) {
      this.camCtl.shakeAmp = Math.max(this.camCtl.shakeAmp, 0.05 + 0.06 * k);
      this.camCtl.fovPunch = 6 + 6 * k;
      this.subs.show(k > 0.8 ? 'ロープ反動…！！' : 'ロープ…！', { duration: 0.8, mid: k > 0.8, voice: false });
    }
    this.audio.impact(0.3 + 0.4 * k);
  }

  finisherWindFx() {
    this.slowMo = 0.5; this.slowScale = 0.2;   // 연출용 (내 화면)
    this.camCtl.fovPunch = -16;
    this.camCtl.shakeAmp = Math.max(this.camCtl.shakeAmp, 0.06);
    this.fx.flash = 0.25;
    this.finisherWindT = 0.55;
  }

  // ================= 클라이언트 =================
  onSnapshot(m) {
    this.snaps.push({ recv: performance.now(), d: m });
    if (this.snaps.length > 3) this.snaps.shift();
    for (const e of m.ev) {
      if (e.t === 'hit') this.hitFx(e);
      else if (e.t === 'a') {
        if (e.n === 'whoosh' && e.s !== this.localSlot) continue;
        this.audio[e.n] && this.audio[e.n](...e.a);
        if (e.n === 'swoosh') { const f = this.fighters[e.s]; this.voice.grunt(e.s, f ? f.defKey : 'ippo', e.a[1] || 0.5); }
      }
      else if (e.t === 's') {
        const lf = this.localFighter;
        const relevant = e.s === this.localSlot || (lf && lf.targetSlot === e.s);
        if (relevant) this.subs.show(e.text, Object.assign({}, e.o, { speaker: e.s === this.localSlot ? 'player' : 'opp', charKey: this.fighters[e.s] ? this.fighters[e.s].defKey : 'ippo' }));
      } else if (e.t === 'fin' && e.s === this.localSlot) this.finisherWindFx();
      else if (e.t === 'coach') { this.coaches.shout(e.s); if (e.s === this.localSlot) this.coach.show(e.key); }
      else if (e.t === 'rope') { const f = this.fighters[e.s]; if (f) this.ropeFx(f, e.k); }
    }
  }

  clientInterpolate() {
    const n = this.snaps.length;
    if (n === 0) return;
    if (n === 1) { const s = this.snaps[0].d.f; this.fighters.forEach((f, i) => f.applySnapshot(s[i], s[i], 1)); return; }
    const A = this.snaps[n - 2], B = this.snaps[n - 1];
    const span = Math.max(1, B.recv - A.recv);
    const t = Math.min(1.2, (performance.now() - B.recv) / span);
    this.fighters.forEach((f, i) => f.applySnapshot(A.d.f[i], B.d.f[i], Math.min(1, t)));
    for (const f of this.fighters) f.target = f.targetSlot >= 0 ? this.fighters[f.targetSlot] : null;
  }

  // ================= 렌더/연출 =================
  renderFrame(rawDt, simDt) {
    const [view, opp] = this.viewPair();
    const local = this.localFighter;
    const d = view.dempsey;
    const I = d.intensity;

    // 로컬 드론 사운드
    if (local) {
      const ld = local.dempsey;
      if (ld.active && !this.droneOn) { this.audio.startDrone(); this.droneOn = true; }
      if (!ld.active && this.droneOn) { this.audio.stopDrone(); this.droneOn = false; }
      if (this.droneOn) this.audio.setDrone(ld.intensity, ld.maxSpeed);
    }

    for (const f of this.fighters) {
      f.updateVisualFx(rawDt);
      // ---- 충전 이펙트: 스탠스 중 발밑에서 기가 솟아오른다 (강도 ∝ 파티클), MAX 진입 시 폭발 ----
      const dd = f.dempsey;
      if (dd.active && dd.intensity > 0.05) {
        const I = dd.intensity;
        f._chargeAcc = (f._chargeAcc || 0) + rawDt * (10 + 40 * I) * (this.quality === 0 ? 0.4 : 1);
        const col = dd.maxSpeed ? new THREE.Color(1, 0.75, 0.25) : ({ dempsey: new THREE.Color(0.4, 0.8, 1), flicker: new THREE.Color(0.8, 0.5, 1), counter: new THREE.Color(0.5, 1, 0.7), smash: new THREE.Color(1, 0.45, 0.2) })[dd.style] || new THREE.Color(0.5, 0.8, 1);
        while (f._chargeAcc >= 1) {
          f._chargeAcc -= 1;
          const a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * 0.35;
          const pos = new THREE.Vector3(f.pos.x + Math.cos(a) * r, 0.05, f.pos.z + Math.sin(a) * r);
          this.sparks.burst(pos, new THREE.Vector3(0, 1, 0), 1, col, 0.35 + 0.5 * I, 0.35 + 0.3 * I);
        }
        if (dd.maxSpeed && !f._maxBurst) { f._maxBurst = true; for (let k = 0; k < 3; k++) this.sparks.burst(f.chestPos, new THREE.Vector3(Math.cos(k * 2.1), 0.3, Math.sin(k * 2.1)), 30, new THREE.Color(1, 0.85, 0.4), 2.2, 0.6); }
      } else f._maxBurst = false;
      // 카메라와 내 캐릭터 사이를 가리는 다른 파이터는 반투명
      if (f !== view) {
        const dc = f.chestPos.distanceTo(this.camera.position);
        f.setFade(dc < 1.9 ? Math.max(0.12, (dc - 0.6) / 1.3) : 1);
      } else f.setFade(1);
      // 주먹 땀방울 궤적: 스트라이크 구간에 글러브에서 작은 물방울이 튄다
      const pu = f.punch;
      if (pu) {
        const pr = pu.t / pu.dur;
        if (pr > 0.22 && pr < 0.55) {
          const gl = pu.side === 'L' ? f.gloveL : f.gloveR;
          this.sparks.burst(gl, f.forward, 2, new THREE.Color(0.85, 0.95, 1), 0.35, 0.22);
        }
      }
      if (f.finisher && f.finisher.t > f.finisher.wind) this.sparks.burst(f.finisher.side === 'L' ? f.gloveL : f.gloveR, f.forward, 4, new THREE.Color(1, 0.8, 0.4), 0.6, 0.3);
      // 로프 부스트 중: 발밑 궤적 불꽃
      if (f.boostT > 0 && Math.random() < 0.7) this.sparks.burst(f.pos.clone().setY(0.08), f.forward.clone().negate(), 2, new THREE.Color(1, 0.75, 0.3), 0.6, 0.3);
    }
    this.sparks.update(rawDt);

    // 잔상: 전원 기록, 시점 인물 + 상대만 표시
    for (const f of this.fighters) {
      const g = this.ghostFx[f.slot];
      const tNow = this.mode === 'client' ? this.realTime : f.time;
      g.record(tNow, f.pos, f.yaw, f.rig.root.rotation.x, f.pose);
      let count = 0, interval = f.dempsey.ghostInterval, strength = 1;
      if (f === view) {
        count = f.dempsey.ghostCount;
        if (f.punch) { count = Math.max(count, 5); interval = Math.max(interval, 0.022); }
        if (f.dempsey.maxSpeed) { count = 7; strength = 1.15; }
        if (f.finisher) count = Math.max(count, 6);
      } else if (f === opp) {
        if (f.rattle > 0.05) { count = 5; interval = 0.045; strength = Math.min(1, f.rattle * 1.6); }
        else if (f.blockGhost > 0) { count = 5; interval = 0.03; strength = Math.min(1, f.blockGhost * 2.5); }
        else if (f.dempsey.blend > 0) { count = Math.min(6, f.dempsey.ghostCount); strength = 0.9; }
      }
      if (f === view && f.blockGhost > 0) { count = Math.max(count, 6); interval = 0.03; strength = Math.max(strength, Math.min(1, f.blockGhost * 2.5)); }
      g.update(this.mode === 'client' ? this.realTime : f.time, count, interval, strength);
    }

    // 트레일 (시점 인물)
    {
      const pu = view.punch;
      const pr = pu ? pu.t / pu.dur : 0;
      const lActive = pu && pu.side === 'L' && pr > 0.2 && pr < 0.62;
      const rActive = pu && pu.side === 'R' && pr > 0.2 && pr < 0.62;
      if (lActive) this.trailL.push(view.gloveL); else if (!pu) this.trailL.clear();
      if (rActive) this.trailR.push(view.gloveR); else if (!pu) this.trailR.clear();
      if (d.blend > 0) this.headTrail.push(view.headPos); else this.headTrail.clear();
      this.trailL.update(rawDt, this.camera, !!lActive);
      this.trailR.update(rawDt, this.camera, !!rActive);
      this.headTrail.update(rawDt, this.camera, d.active && I > 0.15);
    }

    // 카메라 (인트로 중엔 Intro 가 직접 제어)
    const f = new THREE.Vector3().subVectors(opp.pos, view.pos); f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
    const s = new THREE.Vector3(f.z, 0, -f.x);
    if (this.phase !== 'intro') this.camCtl.update(rawDt, { playerPos: view.pos, oppPos: opp.pos, f, s, intensity: I, dempseyActive: d.active || !!view.finisher, sway: d.sway, maxSpeed: d.maxSpeed || !!view.finisher, hitStop: this.hitStop });
    if (opp.dempsey.active) this.camCtl.shakeAmp = Math.max(this.camCtl.shakeAmp, 0.01 * opp.dempsey.intensity);

    // 머리 스크린 속도
    _prevHead.set(this.headScreen.x, this.headScreen.y, 0);
    this.project(view.headPos, this.headScreen);
    const vx = (this.headScreen.x - _prevHead.x) / Math.max(1e-3, rawDt);
    const vy = (this.headScreen.y - _prevHead.y) / Math.max(1e-3, rawDt);
    this.headVel.x += (vx - this.headVel.x) * 0.5; this.headVel.y += (vy - this.headVel.y) * 0.5;

    if (this.finisherWindT > 0) this.finisherWindT -= rawDt;
    const rattle = Math.max(opp.rattle, view.rattle);
    const oD = opp.dempsey;
    const fxI = Math.max(I, oD.active ? oD.intensity * 0.7 : 0, this.finisherWindT > 0 ? 1 : 0, view.finisher ? 0.8 : 0);
    this.fx.update(rawDt, {
      intensity: fxI, maxSpeed: d.maxSpeed || this.finisherWindT > 0, dempseyActive: d.active || d.blend > 0.2 || oD.active || !!view.finisher,
      focusX: this.headScreen.x * this.fx.w, focusY: this.headScreen.y * this.fx.h,
      velX: this.headVel.x * this.fx.w, velY: this.headVel.y * this.fx.h,
      hitStop: this.hitStop, crossPulse: d.crossPulse,
    });
    const blurK = d.active ? Math.min(0.014, Math.abs(d.swayVel) * 0.0009 * (0.5 + I)) : 0;
    const hv = this.headVel.length();
    this.post.update(rawDt, {
      intensity: I, dempseyActive: d.active, maxSpeed: d.maxSpeed, rattle,
      dirX: hv > 1e-4 ? (this.headVel.x / hv) * blurK : 0, dirY: hv > 1e-4 ? (this.headVel.y / hv) * blurK : 0,
      focusX: this.headScreen.x, focusY: this.headScreen.y, time: this.realTime,
    });
    this.excitement = Math.max(I * 0.8, this.excitement * Math.exp(-rawDt * 0.6));
    this.ring.update(rawDt, this.excitement);
    this.coaches.update(rawDt, this.excitement);
    this.hudAccum += rawDt;
    if (this.hudAccum >= 1 / 30) { this.hudAccum = 0; this.hud.update(rawDt, this.fighters, local); this.touch.update(local); }
    // 포커스 경고: 창에 포커스가 없거나(다른 앱/탭), 입력창에 포커스가 가 있으면 알린다
    const ae = document.activeElement;
    const typing = ae && ae.tagName === 'INPUT';
    const noFocus = !document.hasFocus();
    const fw = document.getElementById('focus-warn');
    if (noFocus || (typing && ae.id !== 'chat-input')) { fw.textContent = noFocus ? '게임 창을 클릭하세요 — 키 입력이 들어오지 않고 있습니다' : '입력창에 커서가 있습니다 — 화면을 클릭하세요'; fw.classList.remove('hidden'); }
    else fw.classList.add('hidden');
    const kd = document.getElementById('keydbg');
    if (kd) { const age = this.realTime - this.lastKeyT; kd.textContent = (age < 1.5 ? `KEY ${this.lastKey}` : 'KEY —') + (document.hasFocus() ? '' : '  (창 포커스 없음)') + (this.input.isDown('Space') ? '  SPACE▼' : ''); }
    this.post.render();
  }
}

window.game = new Game();
