// main.js — Game: 4인 난투. 모드: solo(로컬+CPU3) / host(방장 권위 시뮬 + 브로드캐스트) / client(입력 전송 + 스냅샷 보간 렌더)
import * as THREE from 'three';
import { buildRing } from './Ring.js';
import { buildCliff } from './Cliff.js';
import { Fighter, setArena } from './Fighter.js';
import { AIBrain } from './AIBrain.js';
import { InputState } from './InputState.js';
import { AfterImageEffect } from './AfterImageEffect.js';
import { CameraController } from './CameraController.js';
import { AudioManager } from './AudioManager.js';
import { SubtitleManager } from './SubtitleManager.js';
import { FxOverlay } from './FxOverlay.js';
import { PostFX } from './PostFX.js';
import { PHOTOREAL, PRESETS } from './RenderSettings.js';
import { RenderFoundation } from './RenderFoundation.js';
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
import { UltimateFx } from './Ultimate.js';

const _v = new THREE.Vector3();
const _prevHead = new THREE.Vector3();
const _camF = new THREE.Vector3();
const _camR = new THREE.Vector3();
const _sep = new THREE.Vector3();
const SPAWNS = [[0, 2.4], [0, -2.4], [2.4, 0], [-2.4, 0]];
const AUDIO_FWD = ['whoosh', 'swoosh', 'impact', 'bassHit', 'riser', 'maxSpeedHit', 'stagger', 'ko', 'block', 'chargeUp', 'finisherWind', 'finisherHit', 'counter', 'cheer', 'engine', 'clang', 'nyang', 'shutter'];
const SNAP_HZ = 30;

class Game {
  constructor() {
    const canvas = document.getElementById('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.info.autoReset = true;
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
    this.mapKind = 'ring';
    this.ring = buildRing(this.scene);
    setArena({ kind: 'ring', radius: () => 4.15 });
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
    this.ultFx = new UltimateFx(this.scene, this.audio, this.fx, this.camera);
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
    if (PHOTOREAL || new URLSearchParams(location.search).has('profile')) {
      this.renderFoundation = new RenderFoundation(this);
      this.renderFoundation.init().catch((error) => {
        this.showError('검증용 렌더링 초기화 실패: ' + error.message);
        this.renderFoundation.status.textContent = '초기화 실패 · 상세 오류 확인';
      });
    }

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('error', (e) => this.showError(e.message || String(e.error)));
    window.addEventListener('unhandledrejection', (e) => this.showError(String(e.reason)));
    window.addEventListener('pointerdown', () => { this.audio.init(); this.music.resumePending(); this.music.play(this.started ? 'battle' : 'menu'); }, { once: true });
    // 포커스 진단: 마지막 키 입력 시각/코드 기록, 캔버스 클릭 시 입력창 포커스 해제
    this.lastKeyT = -99; this.lastKey = '';
    window.addEventListener('keydown', (e) => { this.lastKeyT = this.realTime; this.lastKey = e.code; }, true);
    canvas.addEventListener('pointerdown', () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); canvas.focus(); });
    this.setupLobby();
    this.autoJoinFromUrl();
    requestAnimationFrame((t) => this.loop(t));
  }

  /** 주소에 ?r=코드 가 있으면 코드 채우고 바로 입장 시도 */
  autoJoinFromUrl() {
    let code = '';
    try { code = (new URLSearchParams(location.search).get('r') || '').toUpperCase().trim(); } catch (e) {}
    if (!/^[A-Z0-9]{5}$/.test(code)) return;
    const input = document.getElementById('join-code');
    if (input) input.value = code;
    const hint = document.querySelector('#menu .hint');
    if (hint) hint.textContent = `초대 링크로 입장 중… (방 ${code})`;
    setTimeout(() => { if (this.net.role === 'none' && !this.started) { this.audio.init(); this.joinRoom(code); } }, 350);
  }

  // ================= 로비 =================
  setupLobby() {
    const $ = (id) => document.getElementById(id);
    $('btn-solo').addEventListener('click', () => {
      this.audio.init();
      this.setMap(this.myMap);
      this.startMatch('solo', this.soloCfg());
    });
    $('btn-host').addEventListener('click', () => { this.audio.init(); this.hostRoom(); });
    $('btn-join').addEventListener('click', () => { this.audio.init(); const c = $('join-code').value; if (c.length === 5) this.joinRoom(c); });
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); e.stopPropagation(); });
    $('btn-start').addEventListener('click', () => this.hostStart());
    $('btn-leave').addEventListener('click', () => this.confirmLeave());
    // ---- 맵 / 규칙 선택 ----
    try { this.myMap = localStorage.getItem('dr-map') || 'ring'; this.myRule = localStorage.getItem('dr-rule') || 'ffa'; } catch (e) { this.myMap = 'ring'; this.myRule = 'ffa'; }
    const syncOpts = () => {
      document.querySelectorAll('[data-map]').forEach((b) => b.classList.toggle('sel', b.dataset.map === this.myMap));
      document.querySelectorAll('[data-rule]').forEach((b) => b.classList.toggle('sel', b.dataset.rule === this.myRule));
    };
    const optChanged = () => {
      syncOpts(); this.showRoomRules();
      if (this.roster) this.renderRoster(this.roster);
      if (this.net.role === 'host' && this.roster) this.broadcastLobby();
    };
    document.querySelectorAll('[data-map]').forEach((b) => b.addEventListener('click', () => {
      if (this.net.role === 'client') return;             // 맵/규칙은 방장이 정한다
      this.myMap = b.dataset.map; try { localStorage.setItem('dr-map', this.myMap); } catch (e) {}
      optChanged();
    }));
    document.querySelectorAll('[data-rule]').forEach((b) => b.addEventListener('click', () => {
      if (this.net.role === 'client') return;
      this.myRule = b.dataset.rule; try { localStorage.setItem('dr-rule', this.myRule); } catch (e) {}
      optChanged();
    }));
    this.syncOpts = syncOpts;
    syncOpts();
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
    // 방 링크: 주소에 ?r=코드 를 붙여 두면 받는 쪽은 누르기만 하면 바로 입장
    this.inviteUrl = (code) => `${location.origin}${location.pathname}?r=${code}`;
    const copyCode = async () => {
      const code = codeEl.textContent.trim();
      if (!code || code === '-----') return;
      const url = this.inviteUrl(code);
      // 모바일이면 공유 시트로 (카톡/메신저 바로 전달)
      if (navigator.share && this.isTouch) {
        try { await navigator.share({ title: '더파이팅', text: `같이 하자! 방코드 ${code}`, url }); this.lobbyMsg('공유했습니다'); return; } catch (e) { /* 취소 시 복사로 폴백 */ }
      }
      try { await navigator.clipboard.writeText(url); }
      catch (e) { const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      codeEl.classList.add('copied');
      this.lobbyMsg('초대 링크 복사됨 — 붙여넣으면 바로 입장됩니다');
      setTimeout(() => codeEl.classList.remove('copied'), 900);
    };
    codeEl.addEventListener('click', copyCode);
    $('netinfo').addEventListener('click', () => { if (this.net.code) { codeEl.textContent = this.net.code; copyCode(); } });
    // ---- 캐릭터 선택 ----
    try { this.myChar = localStorage.getItem('dr-char') || 'ippo'; } catch (e) { this.myChar = 'ippo'; }
    if (!CHARACTERS[this.myChar]) this.myChar = 'ippo';
    const DESC = {
      ippo: { style: '인파이터', st: '<b>U</b> 가젤 펀치(띄움) · <b>I</b> 리버 블로(주저앉힘) · <b>L</b> <b>뎀프시롤 난타</b>(∞ 스웨이 12연타 → 마무리 다운)' , pw: 3, sp: 3, hp: 3 },
      mashiba: { style: '히트맨 · 최장 리치', st: '<b>U</b> 플리커 3연(무예비) · <b>I</b> 초핑 라이트 · <b>L</b> 초핑 라이트 강', pw: 3, sp: 4, hp: 3 },
      miyata: { style: '아웃복서 · 카운터', st: '<b>U</b> 졸트 카운터 · <b>I</b> 백스텝 잽 · <b>L</b> 졸트 블로(다운 없음·초고속)', pw: 2, sp: 5, hp: 2 },
      sendo: { style: '파워 슬러거 · 느리지만 한 방', st: '<b>U</b> 스매시(띄움) · <b>I</b> 러시 3연 · <b>L</b> 스매시 강 · 약타 아머', pw: 5, sp: 1, hp: 4 },
      chaechae: { style: '히든 · 문화생활 인플루언서', st: '<b>기본</b> 냥냥펀치(초고속·경량) · <b>U</b> 냥냥 4연타 · <b>I</b> 고양이 할퀴기 · <b>L</b> <b>릴스 촬영</b>(상대가 강제로 유행 댄스 → 오글거려 쓰러짐)<br><i>기 게이지 15% 빨리 참</i>', pw: 1, sp: 5, hp: 2 },
      jjeonghyo: { style: '히든 · 3대 500', st: '<b>기본</b> 덤벨 펀치(무겁고 느림) · <b>U</b> 덤벨 훅 · <b>I</b> 데드리프트 업(띄움) · <b>L</b> <b>바벨 내려찍기</b><br><i>기 게이지 20% 느림 · 체력 최고</i>', pw: 5, sp: 2, hp: 5 },
      ohsh: { style: '히든 · 빵 러버', st: '<b>기본</b> 빵 들고 타격(가볍고 빠름) · <b>U</b> 갑자기 때리기(기습·스턴) · <b>I</b> 빵 던지기 · <b>L</b> <b>간식 폭격</b>(소금빵·호두과자 46개 낙하)<br><i>가장 작고 약하지만 가장 빨리 기가 참</i>', pw: 1, sp: 5, hp: 1 },
      jungjuwon: { style: '히든 · 헤드폰 먹방', st: '<b>기본</b> 묵직한 타격 · <b>U</b> 삼각김밥 던지기 · <b>I</b> 배치기(띄움) · <b>L</b> <b>카페 돌격</b>(카페 생성 후 질주, 부딪히는 전원 스턴+데미지)<br><i>체력 두 번째로 높음</i>', pw: 4, sp: 2, hp: 5 },
      gokomong: { style: '히든 · ISTP 무감정', st: '<b>기본</b> 귀찮아 펀치(낭창) · <b>U</b> 집가서 아기봐야돼 킥(발 판정·띄움) · <b>I</b> 귀찮아 2연 · <b>L</b> <b>칼차단</b>(푸념을 끊고 도리도리 → 상처받아 기절)<br><i>무난한 올라운더</i>', pw: 3, sp: 3, hp: 3 },
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
      this.setMap(this.myMap);
    } else {
      this.chars[0] = this.myChar;
      cfg = [];
      this.intros[0] = this.myIntro;
      const seats2 = this.seats && this.seats.length === 4 ? this.seats : [0, 1, 2, 3];
      seats2.forEach((ns, seat) => {
        const r = this.roster[ns];
        if (!r || r.type === 'empty') return;
        const c = { type: r.type, netSlot: ns, seat, name: this.names[ns], char: this.chars[ns] || this.charOf(ns), intro: (this.intros && this.intros[ns]) || '' };
        if (this.myRule === 'team') c.team = seat % 2;
        cfg.push(c);
      });
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
    if (this.myRule === 'team') {
      // 2:2 팀전 (나 + CPU 파트너 vs CPU 2명)
      return [
        { type: 'local', char: this.myChar, intro: this.myIntro, team: 0 },
        { type: 'ai', char: opp, level: this.soloLevel, team: 1 },
        { type: 'ai', char: others[(this.soloLevel) % others.length], level: this.soloLevel, team: 0 },
        { type: 'ai', char: others[(this.soloLevel + 1) % others.length], level: this.soloLevel, team: 1 },
      ];
    }
    return [{ type: 'local', char: this.myChar, intro: this.myIntro, team: 0 }, { type: 'ai', char: opp, level: this.soloLevel, team: 1 }];
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
    this.hitStop = 0; this.slowMo = 0; this.snaps = []; this.playT = null; this._pred = null; this.coachBrains = {};
    if (this.ultFx) this.ultFx.clear();
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
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
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

  /** 로비 하단에 맵/규칙 표시 (게스트는 호스트 설정을 따른다) */
  showRoomRules() {
    const lm = document.getElementById('lobby-modes');
    if (lm) lm.classList.toggle('readonly', this.net.role === 'client');
    if (this.syncOpts) this.syncOpts();
    const el = document.getElementById('room-rules');
    if (!el) return;
    const map = this.myMap === 'cliff' ? '암벽 (낙사)' : '복싱 링';
    const rule = this.myRule === 'team' ? '2:2 팀전' : '난투';
    el.textContent = `맵: ${map} · 규칙: ${rule}` + (this.net.role === 'client' ? ' (방장 설정)' : '');
  }

  renderRoster(list) {
    this.roster = this.roster || list;
    if (!this.seats || this.seats.length !== 4) this.seats = [0, 1, 2, 3];
    const team = this.myRule === 'team';
    const host = this.net.role === 'host';
    const wrap = document.getElementById('roster-wrap');
    const teams = document.getElementById('roster-teams');
    if (wrap) wrap.classList.toggle('hidden', team);
    if (teams) teams.classList.toggle('hidden', !team);

    const swapSeats = (a, b) => {
      if (a === b) return;
      const t = this.seats[a]; this.seats[a] = this.seats[b]; this.seats[b] = t;
      this.renderRoster(this.roster);
      this.broadcastLobby();
    };

    const row = (seat) => {
      const ns = this.seats[seat];
      const r = list[ns] || { type: 'empty' };
      const li = document.createElement('li');
      li.className = r.type === 'empty' ? 'empty' : '';
      li.dataset.seat = seat;
      const who = r.type === 'empty' ? '빈 자리' : (r.name || this.nickOf(ns)) + (r.type === 'local' ? ' (YOU)' : '');
      const ch = r.type === 'empty' ? '—' : CHARACTERS[r.char || this.charOf(ns)].name;
      li.appendChild(document.createTextNode(`${ch} · ${who}`));
      if (host && r.type === 'remote') {
        const kb = document.createElement('button'); kb.className = 'kick'; kb.textContent = '강퇴';
        kb.addEventListener('click', (e) => { e.stopPropagation(); this.kickPlayer(ns); });
        li.appendChild(kb);
      }
      // ---- 방장 전용 드래그앤드랍: 좌석끼리 교환 (빈 자리에 놓으면 이동) ----
      if (host) {
        li.draggable = r.type !== 'empty';
        if (li.draggable) li.classList.add('drag');
        li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(seat)); e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); });
        li.addEventListener('dragend', () => li.classList.remove('dragging'));
        li.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; li.classList.add('dragover'); });
        li.addEventListener('dragleave', () => li.classList.remove('dragover'));
        li.addEventListener('drop', (e) => {
          e.preventDefault(); li.classList.remove('dragover');
          const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
          if (!isNaN(from)) swapSeats(from, seat);
        });
      }
      return li;
    };

    if (team) {
      const a = document.getElementById('roster-a'), b = document.getElementById('roster-b');
      a.innerHTML = ''; b.innerHTML = '';
      for (let seat = 0; seat < 4; seat++) (seat % 2 === 0 ? a : b).appendChild(row(seat));
    } else {
      const ul = document.getElementById('roster');
      ul.innerHTML = '';
      for (let seat = 0; seat < 4; seat++) ul.appendChild(row(seat));
    }
    const hintEl = document.getElementById('roster-hint');
    if (hintEl) hintEl.textContent = host ? '선수를 끌어다 자리를 바꿀 수 있습니다 (서로 교환)' : '';
  }

  hostRoom(code = null) {
    const net = this.net;
    this.names = [this.myNick]; this.chars = [this.myChar]; this.intros = [this.myIntro];
    this.roster = [{ type: 'local', name: this.myNick, char: this.myChar }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' }];
    this.seats = [0, 1, 2, 3];   // 좌석 → netSlot (방장이 드래그로 바꾼다)
    net.onOpen = (code) => { try { history.replaceState(null, '', `?r=${code}`); } catch (e) {} this.showLobby(code); this.showRoomRules(); this.renderRoster(this.roster); document.getElementById('btn-start').classList.remove('hidden'); this.lobbyMsg('친구에게 코드를 알려주세요. 참가한 사람끼리만 싸웁니다 (2~4명). 시작 버튼으로 시작'); this.broadcastLobby(); };
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
      else if (m.t === 'ping') { const c = this.net.conns[slot - 1]; if (c && c.open) { try { c.send({ t: 'pong', t0: m.t0 }); } catch (e) {} } }
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

  broadcastLobby() { this.net.broadcast({ t: 'lobby', roster: this.roster, names: this.names, chars: this.chars, map: this.myMap, rule: this.myRule, seats: this.seats }); }

  hostStart() {
    if (this.started) return;
    // 참가한 사람만 (빈 자리는 CPU 로 채우지 않음). netSlot = 접속 슬롯, 배열 인덱스 = 파이터 번호
    const cfg = [];
    const seats = this.seats && this.seats.length === 4 ? this.seats : [0, 1, 2, 3];
    seats.forEach((ns, seat) => {
      const r = this.roster[ns];
      if (!r || r.type === 'empty') return;
      cfg.push({ type: r.type, netSlot: ns, seat, name: this.names[ns], char: this.chars[ns] || this.charOf(ns), intro: (this.intros && this.intros[ns]) || '' });
    });
    if (cfg.length < 2) { this.lobbyMsg('2명 이상 참가해야 시작할 수 있습니다'); return; }
    if (this.myRule === 'team') {
      if (cfg.length < 4) { this.lobbyMsg('2:2 팀전은 4명이 필요합니다 (지금 ' + cfg.length + '명)'); return; }
      cfg.forEach((c) => { c.team = (c.seat !== undefined ? c.seat : 0) % 2; });
    }
    this.net.started = true;
    this.net.broadcast({ t: 'start', cfg, map: this.myMap });
    this.setMap(this.myMap);
    this.startMatch('host', cfg);
  }

  joinRoom(code) {
    const net = this.net;
    net.onOpen = () => { this.showLobby(code); this.showRoomRules(); this.showChat(true); this.lobbyMsg('접속 완료. 방장이 시작할 때까지 대기…'); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };
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
      else if (m.t === 'lobby') { if (m.map) this.myMap = m.map; if (m.rule) this.myRule = m.rule; if (m.seats) this.seats = m.seats; this.showRoomRules(); this.rosterRaw = m.roster; this.names = m.names || []; this.chars = m.chars || []; this.renderRoster(m.roster.map((r, i) => (i === net.mySlot ? { type: 'local', name: r.name } : i === 0 ? { type: 'remote', name: r.name } : r))); }
      else if (m.t === 'full') this.lobbyMsg('방이 가득 찼거나 이미 시작됨');
      else if (m.t === 'start') { this.setMap(m.map || 'ring'); this.names = []; m.cfg.forEach((c) => { this.names[c.netSlot] = c.name; }); this.localSlot = Math.max(0, m.cfg.findIndex((c) => c.netSlot === net.mySlot)); this.startMatch('client', m.cfg); }
      else if (m.t === 'snap') { if (this.phase === 'fight') this.onSnapshot(m); }
      else if (m.t === 'pong') { const r = performance.now() - m.t0; this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r; }
      else if (m.t === 'skipv') { this.showSkipHint(m.n, m.total); }
      else if (m.t === 'phase') { if (m.p === 'countdown') this.endIntro(); else if (m.p === 'fight') { this.phase = 'fight'; document.getElementById('countdown').classList.add('hidden'); } }
      else if (m.t === 'chat') this.addChat(m.from, String(m.text).slice(0, 120), !!m.sys);
      else if (m.t === 'over') this.showWinner(m.winner, m.team !== undefined ? m.team : null);
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

  /** 정적 지오메트리의 행렬 갱신을 끈다 (매 프레임 updateMatrixWorld 비용 절감) */
  freezeStatic(group) {
    if (!group) return;
    group.updateMatrixWorld(true);
    group.traverse((o) => { if (o.isMesh) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
  }

  /** 맵 교체 (ring | cliff). 경기 시작 전에 부른다 */
  setMap(kind) {
    if (kind === this.mapKind && this.ring) return;
    if (this.ring && this.ring.dispose) this.ring.dispose();
    else if (this.ring && this.ring.group) this.scene.remove(this.ring.group);
    this.mapKind = kind;
    if (kind === 'cliff') {
      this.ring = buildCliff(this.scene);
      this.freezeStatic(this.ring.group);
      setArena({ kind: 'cliff', radius: (x, z) => this.ring.radius(x, z) });
    } else {
      this.ring = buildRing(this.scene);
      this.freezeStatic(this.ring.group);
      setArena({ kind: 'ring', radius: () => 4.15 });
    }
    this.coaches.setVisible ? this.coaches.setVisible(kind !== 'cliff') : null;
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
    if (mode !== 'client') this.localSlot = Math.max(0, cfg.findIndex((c) => (c.netSlot ?? 0) === 0));
    this.buildFighters(cfg);
    this.started = true; this.over = false;
    if (this.isTouch) this.touch.setVisible(true);
    document.getElementById('start-overlay').classList.add('hidden');
    // 입력칸(코드/닉네임)에 남은 포커스 해제 — 안 하면 키 입력이 게임에 안 들어간다
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    try { document.getElementById('gl').focus(); window.focus(); } catch (e) {}
    this.input.down.clear();
    document.getElementById('netinfo').textContent = mode === 'solo' ? this.soloLabel() : `ROOM ${this.net.code} · ${mode.toUpperCase()} · Enter = 채팅`;
    this.netLabel = mode === 'solo' ? '' : `ROOM ${this.net.code} · ${mode.toUpperCase()} · Enter = 채팅`;
    if (mode !== 'solo') { this.showChat(true); this.addChat(0, '시합 개시. Enter 로 채팅', true); }
    this.music.pendingTrack = 'battle'; this.music.play('battle');
    if (this.ring && this.ring.reset) this.ring.reset();
    this.beginIntro();
  }

  buildFighters(cfg) {
    for (const f of this.fighters) this.scene.remove(f.rig.root);
    this.fighters = cfg.map((c, i) => {
      const px = this.makeProxies(i);
      const f = new Fighter(this.scene, i, CHARACTERS[c.char] ? c.char : CHARACTER_ORDER[(c.netSlot ?? i) % 4], px.audio, px.subs);
      f.netSlot = c.netSlot ?? i;
      f.team = c.team !== undefined ? c.team : null;   // 팀전에서만 지정 (난투는 null)
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
    // 팀전: 팀마다 첫 주자만 링 위에, 나머지는 대기(벤치)
    this.teamMode = !!(this.cfg && this.cfg.some((c) => c.team !== undefined && c.team !== null));
    if (this.teamMode) {
      // 안전장치: 팀 값이 빠진 선수는 자리 순서로 팀을 메운다 (팀 판정이 null 이면 같은 편도 때려진다)
      this.fighters.forEach((f, i) => { if (f.team === null || f.team === undefined) f.team = i % 2; });
      const started = {};
      for (const f of this.fighters) {
        const first = !started[f.team];
        started[f.team] = true;
        this.setBenched(f, !first);
      }
      this.subT = 0;
    } else {
      for (const f of this.fighters) this.setBenched(f, false);
    }
    this.hud.build(this.fighters, this.localSlot);
    this.hud.showKO(false);
    this.coachBrains = {};
    for (const f of this.fighters) if (!f.isAI) this.coachBrains[f.slot] = new CoachBrain();
    document.getElementById('coach').classList.add('hidden');
    this.hitStop = 0; this.slowMo = 0; this.snaps = []; this.playT = null; this._pred = null;
    if (this.ultFx) this.ultFx.clear();
    this.camCtl.initialized = false;
  }

  resetMatch() { this.buildFighters(this.cfg); if (this.ring && this.ring.reset) this.ring.reset(); this.over = false; this.music.setDuck(1); this.music.play('battle'); if (this.mode === 'solo') document.getElementById('netinfo').textContent = this.soloLabel(); document.getElementById('next-overlay').classList.add('hidden'); this.hud.showKO(false); this.beginIntro(); }

  /** 교체 대기 처리: 화면 밖으로 내리고 판정에서 제외 */
  setBenched(f, on) {
    f.benched = on;
    f.rig.root.visible = !on;
    if (on) { f.punch = null; f.queue.length = 0; f.dempsey.stop(); f.guard = false; }
  }

  /** 팀전 교체: 쓰러진 팀의 다음 선수를 올린다 */
  updateSubs(dt) {
    if (!this.teamMode || this.mode === 'client') return;
    // 쓰러진 선수는 KO 연출 뒤 무대에서 내보낸다 (시체가 남아 "차례 아닌 사람이 서 있는" 것처럼 보이던 문제)
    for (const f of this.fighters) {
      if (f.ko && !f.benched && (f.koT > 2.2 || f.fallY > 6)) {
        this.setBenched(f, true);
        if (this.mode === 'host') this.pendingEvents.push({ t: 'out', s: f.slot });
      }
    }
    if (this.over) return;
    const teams = {};
    for (const f of this.fighters) {
      const t = f.team;
      if (!teams[t]) teams[t] = { alive: [], active: [], bench: [] };
      if (!f.ko) teams[t].alive.push(f);
      if (!f.benched && !f.ko) teams[t].active.push(f);
      if (f.benched && !f.ko) teams[t].bench.push(f);   // 퇴장한 시체(ko)는 후보에서 제외
    }
    for (const t in teams) {
      const T = teams[t];
      // 아직 무대에 남아있는(퇴장 전) 쓰러진 선수가 있으면 교체를 기다린다
      const corpseOnStage = this.fighters.some((f) => f.team == t && f.ko && !f.benched);
      if (corpseOnStage) { if (this._subT) this._subT[t] = 0; continue; }
      if (T.active.length === 0 && T.bench.length > 0) {
        // 2.2초 뒤 다음 주자 등장
        this._subT = this._subT || {};
        this._subT[t] = (this._subT[t] || 0) + dt;
        if (this._subT[t] >= 2.2) {
          this._subT[t] = 0;
          const next = T.bench[0];
          const sp = SPAWNS[next.slot % 4];
          next.pos.set(sp[0], 0, sp[1]);
          next.forward.set(-sp[0], 0, -sp[1]).normalize();
          next.yaw = Math.atan2(next.forward.x, next.forward.z);
          next.hp = next.maxHp; next.fallY = 0; next.fallT = 0; next.fellOut = false; next.fallVy = 0; next._fallDir = null; next.rig.root.rotation.set(0, 0, 0);
          this.setBenched(next, false);
          next.subs.show('교대다—!', { duration: 1.4, strong: true });
          this.fx.addPopup(this.fx.w / 2, this.fx.h * 0.3, `${next.nick || next.name} 등장!`, 'dodge');
          this.audio.bell(1);
          if (this.mode === 'host') this.pendingEvents.push({ t: 'sub', s: next.slot });
        }
      }
    }
  }

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
    // 등장씬에는 후보 선수까지 전원 소개 (벤치는 인트로가 끝나면 다시 숨긴다)
    this.introBench = this.fighters.filter((f) => f.benched);
    for (const f of this.introBench) f.rig.root.visible = true;
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
    if (this.introBench) { for (const f of this.introBench) if (f.benched) f.rig.root.visible = false; this.introBench = null; }
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
    // 교체 대기 중이면 무대에 있는 같은 팀 선수를 관전한다
    if (v && v.benched) {
      v = fs.find((f) => !f.benched && !f.ko && (v.team === null || f.team === v.team))
        || fs.find((f) => !f.benched && !f.ko) || v;
    }
    if (!v || v.ko) v = fs.find((f) => !f.ko && !f.benched) || fs.find((f) => !f.ko) || fs[0];
    let o = v.target || fs.find((f) => f !== v && !f.ko) || fs.find((f) => f !== v);
    if (this.mode === 'client' && v.targetSlot >= 0) o = fs[v.targetSlot] || o;
    return [v, o];
  }

  setQuality(q) {
    if (PHOTOREAL && this.renderFoundation) {
      this.renderFoundation.setPreset(Object.keys(PRESETS)[q]);
      return;
    }
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
    // 타격음 샘플 선택: 훅·카운터·필살기는 묵직하게, 잽·플리커는 가볍게,
    // 뎀프시 연타는 후속타 샘플, 보디/리버는 둔탁한 샘플
    const sfxKind = (ev.finisher || ev.counter || ev.kind || ev.heavy || ev.type === 'hook') ? 'hook'
      : (body || ev.liver) ? 'body'
      : ev.dempsey ? 'follow'
      : 'jab';
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
      this.audio.impact(0.6 + 0.4 * P, 'body'); if (P > 0.8) this.audio.bassHit();
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
        this.audio.impact(1, 'hook'); this.audio.bassHit(); this.camCtl.onHit(dir, 1);
      }
      return;
    }
    if (res.blocked && res.ko) {
      // 칩 데미지로 KO — 일반 KO 연출로 넘긴다
      this.stopPair(ev, 0.14, 1.6, 0.25);
      this.audio.impact(1, 'hook');
      if (involved) this.subs.show('ダウン！！', { duration: 2.4, strong: true, speaker: hurt ? 'opp' : 'player' });
      return;
    }
    if (res.blocked) {
      this.audio.block();
      this.fx.addImpact(px, py, 0.25, false);
      this.sparks.burst(pos, dir, 8, new THREE.Color(0.8, 0.85, 1), 0.7, 0.35);
      this.stopPair(ev, 0.025); if (involved) this.camCtl.shakeAmp = Math.max(this.camCtl.shakeAmp, 0.02);
      if (res.guardBreak && involved) { this.subs.show('ガードが…！！', { duration: 1.2, mid: true, speaker: hurt ? 'player' : 'opp' }); this.audio.impact(0.8, 'hook'); this.camCtl.onHit(dir, 0.9); }
      else if (mine && Math.random() < 0.3) this.subs.show(Math.random() < 0.5 ? '読めてる…' : 'そんなもんか？', { duration: 0.9, speaker: 'opp' });
      return;
    }
    if (res.armored) {
      this.audio.impact(0.4, 'follow');
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
      this.audio.impact(0.35 + 0.5 * P, sfxKind);
      if (ev.dempsey && P > 0.9) this.audio.bassHit();
      if (res.staggered) this.subs.show('ぐぅっ…！', { duration: 1.0, mid: true });
      else if (res.interrupted) this.subs.show('しまっ…！', { duration: 0.9, mid: true });
      else if (Math.random() < 0.5) this.subs.line('hurt', { mid: true }); else this.subs.line('oppHit', { mid: true });
    } else {
      this.stopPair(ev, 0.05 + 0.05 * P + (body ? 0.02 : 0));
      if (mine) { this.camCtl.onHit(dir, P); this.post.onHit(P, uv.x, uv.y); this.fx.addImpact(px, py, P, ev.maxSpeed); }
      else this.fx.addImpact(px, py, 0.35 * P, false);
      this.audio.impact(mine ? P : P * 0.6, sfxKind);
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

  showWinner(slot, team = null) {
    this.over = true;
    this.music.setDuck(0.45);
    const w = this.fighters[slot];
    const me = slot === this.localSlot;
    const canRestart = this.mode !== 'client';
    // 승자 표기: 캐릭터명이 아니라 닉네임 (CPU 면 "CPU 캐릭터명")
    const who = w ? (w.isAI ? `CPU ${w.name}` : (w.nick || w.name)) : '';
    if (this.mode === 'solo') { if (me) { this.soloLevel = this.soloLevel + 1; } this.soloResult = me ? `클리어! 다음: ${this.soloLabel()}` : `패배… 다시: ${this.soloLabel()}`; }
    const title = team !== null ? (w && w.team === (this.localFighter && this.localFighter.team) ? 'TEAM WIN' : `TEAM ${team + 1} WIN`) : (me ? 'WINNER' : (w ? `${who} WIN` : 'DRAW'));
    const sub = (me ? '승리! ' : (w ? `${who} (${w.name}) 승리. ` : '')) + (canRestart ? '아래에서 캐릭터를 고르고 R / 버튼' : '캐릭터를 고르고 방장을 기다리세요');
    setTimeout(() => this.hud.showKO(true, title, sub), 900);
    setTimeout(() => { if (this.over) this.showNextPanel(); }, 1800);
    if (w && !me) this.subs.show(`${who} の勝ち！`, { duration: 2.2, mid: true, voice: false });
  }

  // ================= 루프 =================
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    if (this.paused) return;   // 외부 시뮬/디버그용
    try {
      this.renderFoundation?.beforeFrame(now - this.last, now);
      this.frame(now);
      this.renderFoundation?.afterFrame();
    } catch (e) {
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
      if (this.renderFoundation) this.renderFoundation.render(); else this.post.render();
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
    if (!PHOTOREAL && this.qualityCool <= 0) {
      if (this.frameAvg > 24 && this.quality > 0) { this.setQuality(this.quality - 1); this.qualityCool = 6; }
      else if (this.frameAvg < 13 && this.quality < 2 && this.autoQuality !== false) { this.setQuality(this.quality + 1); this.qualityCool = 10; }
    }
    const input = this.input;
    if (input.justPressed('KeyQ')) {
      if (PHOTOREAL) {
        const names = Object.keys(PRESETS), current = names.indexOf(this.renderFoundation.name);
        this.renderFoundation.setPreset(names[(current + 1) % names.length]);
      } else { this.autoQuality = false; this.setQuality((this.quality + 2) % 3); this.qualityCool = 999; }
    }
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
      this.predictInput(input);
      this.pingT = (this.pingT || 0) + rawDt;
      if (this.pingT > 1) { this.pingT = 0; this.net.send({ t: 'ping', t0: performance.now() }); }
      this.clientInterpolate(rawDt);
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
      if (f.benched) continue;        // 교체 대기 중인 선수는 시뮬레이션하지 않는다 (벤치에서 낙사하던 버그)
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
        if (e.type === 'ultStart') {
          const tg = this.fighters[e.target];
          this.ultFx.play(e.kind, f, tg);
          this.music.setDuck(0.3); setTimeout(() => this.music.setDuck(1), 3600);
          this.applySlow(f.slot, 0.35, 0.25);
          if (f.slot === this.localSlot || (tg && tg.slot === this.localSlot)) this.finisherWindFx();
          this.fx.addPopup(this.fx.w / 2, this.fx.h * 0.3, ({ reels: '릴스 촬영 중!!', barbell: '3대 500!!', bike: '교통사고!!', snackRain: '간식 폭격!!', cafeRush: '커피 마셔야 돼!!', coldCut: '칼차단!!' })[e.kind] || '필살!!', 'groggy');
          if (this.mode === 'host') this.pendingEvents.push({ t: 'ult', s: f.slot, b: e.target, k: e.kind });
          continue;
        }
        if (e.type === 'ultBlocked') {
          const tg = this.fighters[e.target];
          this.audio.guardHeavy(1.2); this.camCtl.onHit(f.forward, 0.7);
          this.fx.addPopup(this.fx.w / 2, this.fx.h * 0.34, '가드!!', 'dodge');
          if (tg) this.sparks.burst(tg.chestPos, f.forward, 26, new THREE.Color(0.75, 0.9, 1), 1.4, 0.7);
          if (this.mode === 'host') this.pendingEvents.push({ t: 'ultblk', s: f.slot, b: e.target });
          continue;
        }
        if (e.type === 'ultHurt') {
          // 간식 폭격에 맞는 동안 계속 비명 + 카메라 흔들림
          this.voice.hurt(f.slot, f.defKey, 0.8);
          this.camCtl.onHit(f.forward, 0.3);
          continue;
        }
        if (e.type === 'rushHit') {
          // 0.1초 도트라 연출은 솎아서 (소리/흔들림 폭주 방지)
          this._rushFxT = (this._rushFxT || 0) + 1;
          if (this._rushFxT % 3 === 0) { this.camCtl.onHit(f.forward, 0.45); this.audio.impact(0.5, 'follow'); }
          const tg = this.fighters[e.target];
          if (tg && this._rushFxT % 2 === 0) this.sparks.burst(tg.chestPos, f.forward, 8, new THREE.Color(1, 0.85, 0.5), 0.9, 0.35);
          if (this.mode === 'host' && this._rushFxT % 3 === 0) this.pendingEvents.push({ t: 'rush', s: f.slot, b: e.target });
          continue;
        }
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
      if (d < 0.58 && d > 1e-4) { _sep.multiplyScalar((0.58 - d) / d * 0.5); a.pos.sub(_sep); b.pos.add(_sep); }
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
    this.updateSubs(rawDt);
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
      if (this.teamMode) {
        const teamsAlive = new Set(alive.map((f) => f.team));
        if (teamsAlive.size <= 1) {
          const wt = [...teamsAlive][0];
          const w = alive.find((f) => f.team === wt);
          this.showWinner(w ? w.slot : -1, wt);
          if (this.mode === 'host') this.net.broadcast({ t: 'over', winner: w ? w.slot : -1, team: wt });
        }
      } else if (alive.length <= 1) {
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
    const now = performance.now();
    // 도착 간격의 흔들림(지터)을 추적해 재생 지연을 필요한 만큼만 잡는다
    if (this._lastRecv) {
      const gap = now - this._lastRecv;
      const nominal = 1000 / SNAP_HZ;
      const dev = Math.abs(gap - nominal);
      this.jitter = this.jitter === undefined ? dev : this.jitter * 0.88 + dev * 0.12;
    }
    this._lastRecv = now;
    this.snaps.push({ recv: now, ts: (m.ts || 0) * 1000, d: m });
    if (this.snaps.length > 10) this.snaps.shift();
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
      else if (e.t === 'ult') {
        // 연출형 필살: 게스트도 3D 소품(유물/랙/오토바이/폰·링라이트/카페)을 똑같이 본다
        const a = this.fighters[e.s], b = this.fighters[e.b];
        if (a) {
          this.ultFx.play(e.k, a, b);
          // 클라는 파이터 로직을 돌리지 않으므로 연출 카메라용 상태를 직접 세팅한다 (renderFrame 에서 감쇠)
          const DUR = { reels: 3.4, snackRain: 3.6, cafeRush: 3.2, coldCut: 3.4, barbell: 3.6, bike: 3.0 };
          a.ultT = DUR[e.k] || 3.2; a.ultKind = e.k; a.ultTarget = b || a;
          this.music.setDuck(0.3); setTimeout(() => this.music.setDuck(1), 3600);
          this.applySlow(a.slot, 0.35, 0.25);
          if (a.slot === this.localSlot || (b && b.slot === this.localSlot)) this.finisherWindFx();
          this.fx.addPopup(this.fx.w / 2, this.fx.h * 0.3, ({ reels: '릴스 촬영 중!!', barbell: '3대 500!!', bike: '교통사고!!', snackRain: '간식 폭격!!', cafeRush: '커피 마셔야 돼!!', coldCut: '칼차단!!' })[e.k] || '필살!!', 'groggy');
        }
      }
      else if (e.t === 'ultblk') {
        const a = this.fighters[e.s], b = this.fighters[e.b];
        this.audio.guardHeavy(1.2);
        if (a) this.camCtl.onHit(a.forward, 0.7);
        this.fx.addPopup(this.fx.w / 2, this.fx.h * 0.34, '가드!!', 'dodge');
        if (b) this.sparks.burst(b.chestPos, a ? a.forward : new THREE.Vector3(0, 0, 1), 26, new THREE.Color(0.75, 0.9, 1), 1.4, 0.7);
      }
      else if (e.t === 'out') { const f = this.fighters[e.s]; if (f) this.setBenched(f, true); }
      else if (e.t === 'sub') {
        const f = this.fighters[e.s];
        if (f) { this.setBenched(f, false); this.audio.bell(1); this.fx.addPopup(this.fx.w / 2, this.fx.h * 0.3, `${f.nick || f.name} 등장!`, 'dodge'); }
      }
      else if (e.t === 'rush') {
        const a = this.fighters[e.s], b = this.fighters[e.b];
        this.audio.impact(0.5);
        if (a) this.camCtl.onHit(a.forward, 0.45);
        if (b && a) this.sparks.burst(b.chestPos, a.forward, 8, new THREE.Color(1, 0.85, 0.5), 0.9, 0.35);
      }
    }
  }

  /**
   * 클라 보간: 서버 타임스탬프 기준으로 "조금 늦게" 재생한다.
   * 도착 시각 기준으로 맞추면 네트워크 지터가 그대로 튐/멈춤으로 보이므로,
   * 재생 시계(playT)를 두고 버퍼가 두꺼우면 살짝 빠르게, 얇으면 살짝 느리게 돌려 지터를 흡수한다.
   */
  clientInterpolate(rawDt = 1 / 60) {
    const n = this.snaps.length;
    if (n === 0) return;
    const latest = this.snaps[n - 1];
    if (n === 1) { const s0 = latest.d.f; this.fighters.forEach((f, i) => f.applySnapshot(s0[i], s0[i], 1)); return; }

    // 재생 지연: 스냅샷 간격 2개 + RTT 절반 (최소 70ms, 최대 220ms)
    const interval = 1000 / SNAP_HZ;
    // 회선이 깨끗하면 지연을 최소로 (= 게스트가 더 빨리 본다). 지터가 크면 그만큼만 더 버퍼링
    const delay = Math.min(200, Math.max(38, interval * 1.15 + (this.jitter || 6) * 2.2 + (this.rtt || 40) * 0.25));
    if (this.playT === undefined || this.playT === null) this.playT = latest.ts - delay;

    // 버퍼 두께에 따라 재생 속도 미세 조정 (±12%) — 튀지 않게 천천히 따라붙는다
    const target = latest.ts - delay;
    const drift = target - this.playT;
    let rate = 1;
    if (Math.abs(drift) > 400) this.playT = target;                    // 크게 벌어지면 그냥 점프 (렉 스파이크)
    else rate = 1 + Math.max(-0.12, Math.min(0.12, drift / 600));
    this.playT += rawDt * 1000 * rate;

    // playT 를 감싸는 두 스냅샷 찾기
    let A = this.snaps[0], B = this.snaps[1];
    for (let i = 0; i < n - 1; i++) {
      if (this.snaps[i].ts <= this.playT && this.snaps[i + 1].ts >= this.playT) { A = this.snaps[i]; B = this.snaps[i + 1]; break; }
      if (this.snaps[i + 1].ts < this.playT) { A = this.snaps[i]; B = this.snaps[i + 1]; }
    }
    const span = Math.max(1, B.ts - A.ts);
    // 최신 스냅샷보다 앞서 있으면 잠깐만 외삽 (최대 1프레임 분량)
    const t = Math.max(0, Math.min(1.35, (this.playT - A.ts) / span));
    this.fighters.forEach((f, i) => f.applySnapshot(A.d.f[i], B.d.f[i], t));
    for (const f of this.fighters) f.target = f.targetSlot >= 0 ? this.fighters[f.targetSlot] : null;
    this.netBufMs = latest.ts - this.playT;
    this.predictLocal(rawDt);
  }

  /** 버튼 입력을 받은 그 프레임에 내 캐릭터 동작을 먼저 그려 준다 (호스트 확인 전) */
  predictInput(input) {
    const f = this.localFighter; if (!f || f.benched || f.falling || f.ko) return;
    // 호스트가 거부할 입력(쿨다운·경직·게이지 부족 등)은 예측도 하지 않는다
    if (input.justPressed('KeyJ')) { if (f.canPredict('J')) f.predictPunch('L', 'straight'); }
    else if (input.justPressed('KeyK')) { if (f.canPredict('K')) f.predictPunch('R', 'straight'); }
    else if (input.justPressed('KeyU')) { if (f.canPredict('U')) f.predictPunch('R', 'special'); }
    else if (input.justPressed('KeyI')) { if (f.canPredict('I')) f.predictPunch('L', 'special'); }
    else if (input.justPressed('KeyL')) { if (f.canPredict('L')) f.predictPunch('R', 'hook'); }
  }

  /**
   * 내 캐릭터만 로컬 예측: 입력을 즉시 반영하고(오프셋 누적), 서버 위치로 부드럽게 되돌린다.
   * 왕복 지연(입력→호스트→스냅샷) 때문에 게스트의 내 캐릭터가 늦게 따라오던 버벅임을 없앤다.
   */
  predictLocal(rawDt) {
    const f = this.localFighter; if (!f || f.benched) return;
    if (f.falling || f.ko || f.fallY > 0.01 || f.downT > 0) { if (this._pred) this._pred.set(0, 0, 0); return; }
    if (!this._pred) this._pred = new THREE.Vector3();
    const p = this._pred;
    const blocked = f.ko || f.downT > 0 || f.stagger > 0 || !!f.finisher || f.airY > 0.01;
    if (!blocked) {
      const speed = 2.5 * Math.pow(f.def.speedMul, 0.75) * (f.dempsey.active ? 0.9 : 1) * (f.guard ? 0.55 : 1);
      p.x += this.move.x * speed * rawDt;
      p.z += this.move.z * speed * rawDt;
    }
    // 서버 위치로 수렴 (0.35초 시정수) + 과도한 어긋남 방지
    const decay = Math.exp(-rawDt / 0.35);
    p.multiplyScalar(decay);
    const max = 0.7;
    const len = Math.hypot(p.x, p.z);
    if (len > max) { p.x *= max / len; p.z *= max / len; }
    f.pos.x += p.x; f.pos.z += p.z;
    if (this.mapKind === 'cliff') {
      // 암벽은 경계가 원형이고 밖으로 나갈 수 있어야 한다 (낙사 판정은 호스트가 한다)
      const r = Math.hypot(f.pos.x, f.pos.z), lim = (this.ring && this.ring.radius ? this.ring.radius(f.pos.x, f.pos.z) : 6.2) + 1.2;
      if (r > lim) { f.pos.x *= lim / r; f.pos.z *= lim / r; }
    } else {
      f.pos.x = Math.max(-4.15, Math.min(4.15, f.pos.x));
      f.pos.z = Math.max(-4.15, Math.min(4.15, f.pos.z));
    }
    f._applyNow(f.pose);
    // 펀치/가드 예측 포즈를 서버 포즈 위에 덮는다
    f.applyPrediction(rawDt, f.punchProgress > 0.001, this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight'));
  }

  // ================= 렌더/연출 =================
  renderFrame(rawDt, simDt) {
    // 클라이언트: 연출형 필살 카메라용 타이머 감쇠 (시뮬레이션을 돌리지 않으므로 직접 깎는다)
    if (this.mode === 'client') {
      for (const f of this.fighters) {
        if (f.ultT > 0) { f.ultT -= rawDt; if (f.ultT <= 0) { f.ultT = 0; f.ultKind = null; f.ultTarget = null; } }
      }
    }
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
    this.ultFx.update(rawDt);

    // 잔상: 전원 기록, 시점 인물 + 상대만 표시
    for (const f of this.fighters) {
      const g = this.ghostFx[f.slot];
      const tNow = this.mode === 'client' ? this.realTime : f.time;
      g.record(tNow, f.pos, f.yaw, f.rig.root.rotation.x, f.pose);
      // 잔상은 "공격 중"일 때만 (이동/걷기에는 남기지 않는다)
      const attacking = !!f.punch || !!f.finisher || f.rollT > 0 || f.ultT > 0;
      let count = 0, interval = f.dempsey.ghostInterval, strength = 1;
      if (f === view || f === opp) {
        if (attacking) {
          count = f.finisher || f.ultT > 0 || f.rollT > 0 ? 7 : 5;
          interval = f.rollT > 0 ? 0.022 : 0.026;
          strength = f.finisher || f.ultT > 0 ? 1.15 : 1;
        }
        if (f.dempsey.maxSpeed && attacking) { count = Math.max(count, 7); strength = 1.15; }
      }
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
    // ---- 낙사 카메라: 떨어지는 선수를 따라 내려가며 지켜본다 ----
    // 낙하 카메라는 '떨어지는 본인'(관전 중이면 관전 대상)에게만 적용한다.
    // 예전에는 local.target 이 떨어져도 따라 내려가서, 밀어낸 쪽 화면까지 같이 끌려갔다.
    // 낙하 중에는 benched/ko 가 아니므로 viewPair() 가 항상 본인을 view 로 준다 → 이 한 줄로 충분하다.
    const faller = (view && (view.fallT > 0 || (view.ko && view.fallY > 0.5))) ? view : null;
    // 낙하 중에는 camCtl 이 카메라를 쓰지 않게 한다 (apply:false).
    // 예전에는 camCtl 이 매 프레임 카메라를 통째로 덮어써서, 아래 위치 lerp·FOV 가 거의 상쇄되고
    // 전체 덮어쓰기인 lookAt 만 살아남았다 → 제자리에서 고개만 돌리는 그림이 됐다.
    if (this.phase !== 'intro') this.camCtl.update(rawDt, { playerPos: view.pos, oppPos: opp.pos, f, s, intensity: I, dempseyActive: d.active || !!view.finisher, sway: d.sway, maxSpeed: d.maxSpeed || !!view.finisher, hitStop: this.hitStop, apply: !faller });
    if (faller) {
      const y = -(faller.fallY || 0);
      const want = faller.pos.clone().add(new THREE.Vector3(0, y + 2.2, 0)).addScaledVector(faller.forward, -2.6);
      this.camera.position.lerp(want, Math.min(1, rawDt * 5));
      this.camera.up.set(0, 1, 0);   // camCtl 의 롤킥이 남아 수평선이 기울지 않도록
      this.camera.lookAt(faller.pos.x, y + 0.7, faller.pos.z);
      const wantFov = 62;
      this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, rawDt * 3);
      this.camera.updateProjectionMatrix();
      this.camCtl.initialized = false;
    }
    // ---- 필살 연출 카메라: 하늘에서 떨어지는 유물·랙·오토바이가 확실히 보이는 와이드 샷 ----
    const ultF = this.fighters.find((x) => x.ultT > 0);
    if (ultF && ultF.ultTarget) {
      const tg = ultF.ultTarget;
      const mid = ultF.pos.clone().add(tg.pos).multiplyScalar(0.5);
      const axis = new THREE.Vector3().subVectors(tg.pos, ultF.pos).setY(0).normalize();
      const sideV = new THREE.Vector3(axis.z, 0, -axis.x);
      const k = ultF.ultKind;
      const up = k === 'reels' ? 1.75 : k === 'coldCut' ? 1.9 : k === 'snackRain' ? 3.0 : k === 'cafeRush' ? 3.4 : k === 'barbell' ? 2.6 : 2.2;
      const back = k === 'reels' ? 3.6 : k === 'coldCut' ? 4.0 : k === 'cafeRush' ? 7.5 : k === 'snackRain' ? 6.4 : 5.6;
      const want = mid.clone().addScaledVector(sideV, back * 0.75).addScaledVector(axis, -back * 0.5).add(new THREE.Vector3(0, up, 0));
      this.camera.position.lerp(want, Math.min(1, rawDt * 3.4));
      const lookBase = k === 'cafeRush' ? ultF.pos : tg.pos;
      const look = lookBase.clone().add(new THREE.Vector3(0, k === 'reels' ? 1.15 : k === 'coldCut' ? 1.5 : k === 'snackRain' ? 1.8 : 1.3, 0));
      this.camera.lookAt(look);
      const wantFov = k === 'reels' ? 46 : k === 'coldCut' ? 48 : k === 'cafeRush' ? 66 : 58;
      this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, rawDt * 3);
      this.camera.updateProjectionMatrix();
      this.camCtl.initialized = false;   // 연출 끝나면 자연스럽게 다시 붙는다
    }
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
    if (this.hudAccum >= 1 / 30) {
      this.hudAccum = 0; this.hud.update(rawDt, this.fighters, local); this.touch.update(local);
      const benchEl = document.getElementById('bench-banner');
      if (benchEl) benchEl.classList.toggle('hidden', !(local && local.benched && !local.ko && this.phase === 'fight'));
      if (this.mode === 'client' && this.netLabel) {
        const el = document.getElementById('netinfo');
        if (el) el.textContent = `${this.netLabel} · PING ${Math.round(this.rtt || 0)}ms · BUF ${Math.round(this.netBufMs || 0)}ms`;
      }
    }
    // 포커스 경고: 창에 포커스가 없거나(다른 앱/탭), 입력창에 포커스가 가 있으면 알린다
    const ae = document.activeElement;
    const typing = ae && ae.tagName === 'INPUT';
    const noFocus = !document.hasFocus();
    const fw = document.getElementById('focus-warn');
    if (noFocus || (typing && ae.id !== 'chat-input')) { fw.textContent = noFocus ? '게임 창을 클릭하세요 — 키 입력이 들어오지 않고 있습니다' : '입력창에 커서가 있습니다 — 화면을 클릭하세요'; fw.classList.remove('hidden'); }
    else fw.classList.add('hidden');
    const kd = document.getElementById('keydbg');
    if (kd) { const age = this.realTime - this.lastKeyT; kd.textContent = (age < 1.5 ? `KEY ${this.lastKey}` : 'KEY —') + (document.hasFocus() ? '' : '  (창 포커스 없음)') + (this.input.isDown('Space') ? '  SPACE▼' : ''); }
    if (this.renderFoundation) this.renderFoundation.render(); else this.post.render();
  }
}

window.game = new Game();
