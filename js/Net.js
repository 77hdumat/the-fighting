// Net.js — PeerJS 방코드 매칭 (호스트 권위 스타형). 전역 `Peer` (peerjs UMD) 사용.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeCode() { let s = ''; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }
const PREFIX = 'the-fighting-';

/**
 * '빠른 채널' (UDP 식): ordered:false + maxRetransmits:0 → 유실된 패킷을 재전송하지 않는다.
 * PeerJS 기본 채널은 reliable:false 여도 SCTP 재전송이 붙어 있어서(순서만 안 지킴) 손실이 나면 재전송을 기다리느라 지연이 튄다.
 * 스냅샷·입력처럼 "다음 것이 오면 이전 것은 필요 없는" 데이터는 이 채널로, 로비·채팅·타격 이벤트처럼 꼭 도착해야 하는 것은 기본 채널로 보낸다.
 * 주의: PeerJS 는 peerConnection.ondatachannel 을 가로채 자기 DataConnection 의 채널로 바꿔치기하므로, 상대가 채널을 만들기 전에 핸들러를 감싸 둔다.
 */
const FAST_LABEL = 'fast';
function guardDataChannel(conn, onFast) {
  const pc = conn.peerConnection; if (!pc) return;
  const orig = pc.ondatachannel;
  pc.ondatachannel = (evt) => { if (evt.channel && evt.channel.label === FAST_LABEL) onFast(evt.channel); else if (orig) orig.call(pc, evt); };
}
function bindFast(ch, onMsg) {
  ch.binaryType = 'arraybuffer';
  ch.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onMsg(m); };
  ch.onerror = () => {};
  return ch;
}

export class Net {
  constructor() {
    this.peer = null;
    this.role = 'none';     // 'host' | 'client'
    this.conns = [];        // host: DataConnection[] (index = slot-1)
    this.conn = null;       // client
    this.code = '';
    this.onMessage = null;  // (msg, fromSlot)
    this.onJoin = null;     // host: (slot)
    this.onLeave = null;    // host: (slot)
    this.onOpen = null;
    this.onError = null;
    this.onReconnect = null;  // host: 시그널링 재연결 성공
    this.mySlot = 0;
  }

  /**
   * ICE 서버 목록. STUN 만으로는 대칭 NAT(모바일 데이터망) 뒤의 기기가 못 붙는다 → TURN(중계) 이 꼭 필요하다.
   * 예전에 쓰던 무료 공개 TURN(openrelay.metered.ca) 은 2026년 현재 죽어서 relay 후보를 하나도 안 준다
   * → 그게 "모바일(LTE)로는 방을 만들어도, 참가해도 안 붙는" 원인. index.html 의 window.TURN_SERVERS 에 살아 있는 TURN 을 넣어야 한다.
   */
  static iceServers() {
    const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
    const extra = (typeof window !== 'undefined' && Array.isArray(window.TURN_SERVERS)) ? window.TURN_SERVERS : [];
    for (const t of extra) if (t && t.urls) list.push(t);
    return list;
  }

  /**
   * window.TURN_ENDPOINT 가 있으면 거기서 단기 TURN 자격증명을 받아 TURN_SERVERS 에 합친다 (Cloudflare Realtime 등).
   * 페이지 로드 직후 한 번 호출. 실패해도 게임은 STUN 만으로 계속 동작한다.
   */
  static fetchTurn() {
    if (Net._turnFetch) return Net._turnFetch;
    const ep = typeof window !== 'undefined' && window.TURN_ENDPOINT;
    Net._turnFetch = !ep ? Promise.resolve() : fetch(ep, { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      const got = (j && j.iceServers) || [];
      const cur = Array.isArray(window.TURN_SERVERS) ? window.TURN_SERVERS : [];
      window.TURN_SERVERS = cur.concat(got.filter((s) => s && s.urls));
    }).catch(() => {});
    return Net._turnFetch;
  }

  /** TURN 이 실제로 relay 후보를 주는지 한 번 확인 (로비 안내용). 결과: 'ok' | 'none' */
  static probeTurn(timeoutMs = 6000) {
    if (Net._turnProbe) return Net._turnProbe;
    Net._turnProbe = Net.fetchTurn().then(() => new Promise((res) => {
      try {
        const turn = Net.iceServers().filter((s) => String(s.urls).includes('turn'));
        if (!turn.length) return res('none');
        const pc = new RTCPeerConnection({ iceServers: turn, iceTransportPolicy: 'relay' });
        let done = false;
        const finish = (v) => { if (done) return; done = true; try { pc.close(); } catch (e) {} res(v); };
        pc.onicecandidate = (e) => { if (e.candidate && e.candidate.type === 'relay') finish('ok'); else if (!e.candidate) finish('none'); };
        pc.createDataChannel('probe');
        pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => finish('none'));
        setTimeout(() => finish('none'), timeoutMs);
      } catch (e) { res('none'); }
    }));
    return Net._turnProbe;
  }

  _mkPeer(id) {
    const peer = new Peer(id, {
      debug: 1,
      pingInterval: 5000,
      config: { iceServers: Net.iceServers(), iceCandidatePoolSize: 4 },
    });
    // 시그널링 서버와 끊기면(모바일 화면 꺼짐·망 전환) 이미 맺은 P2P 는 살아 있지만 새 참가/재접속이 안 된다 → 자동 재연결.
    // 게스트가 "접속 중…" 에서 못 벗어나는 대표 원인이 방장의 시그널링이 조용히 죽은 것이다.
    const tryReconnect = () => { if (!peer.destroyed && this.peer === peer && peer.disconnected) { try { peer.reconnect(); } catch (e) {} } };
    peer.on('disconnected', () => {
      if (peer.destroyed || this.peer !== peer) return;
      clearTimeout(this._reconnT);
      this._reconnT = setTimeout(tryReconnect, 1200);
    });
    // 화면이 다시 켜지거나 망이 돌아오면 기다리지 않고 바로
    const wake = () => { if (document.visibilityState === 'visible') tryReconnect(); };
    document.addEventListener('visibilitychange', wake); window.addEventListener('online', wake);
    this._unwake = () => { document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); };
    return peer;
  }

  /** 클라: 이 시간 안에 데이터채널이 안 열리면 timeout 에러 (기본 15초) */
  static JOIN_TIMEOUT = 12000;

  /**
   * code 를 주면 그 코드로 방을 연다 (호스트 승계). 아직 이전 호스트 ID 가 안 풀렸으면 잠시 후 재시도.
   * 한 번 열린 뒤의 unavailable-id 는 시그널링 재연결 중 서버에 내 옛 소켓이 아직 남아 있는 것 → 같은 코드로 계속 재시도
   * (코드를 바꾸면 게스트가 옛 코드로 붙다 영원히 "접속 중…" 에 걸린다).
   */
  host(maxClients = 3, code = null, tries = 0) {
    if (!Net._turnDone) { Net.fetchTurn().then(() => { Net._turnDone = true; if (this.role === 'host') this.host(maxClients, code, tries); }); this.role = 'host'; return; }
    this.role = 'host';
    this.code = code || makeCode();
    const myCode = this.code;
    this.peer = this._mkPeer(PREFIX + myCode);
    let opened = false;
    this.peer.on('open', () => {
      if (opened) { this.onReconnect && this.onReconnect(); return; }   // 시그널링 재연결 — 방은 그대로
      opened = true; this.onOpen && this.onOpen(myCode);
    });
    this.peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        if (this.peer && !this.peer.destroyed) this.peer.destroy();
        if (this.peer && this.peer.id !== PREFIX + myCode) return;    // 이미 다른 피어로 넘어감
        if (opened || code) { if (tries < 40) setTimeout(() => { if (this.role === 'host' && this.code === myCode) this.host(maxClients, myCode, tries + 1); }, 1500); else this.onError && this.onError(e); }
        else this.host(maxClients);                                    // 처음부터 겹친 코드 → 새 코드
        return;
      }
      this.onError && this.onError(e);
    });
    this.peer.on('connection', (c) => {
      const slot = this.conns.findIndex((x) => !x) ;
      const idx = slot === -1 ? this.conns.length : slot;
      // 자리가 없을 때만 여기서 거절. 경기 중 참가 여부는 게임 쪽(onJoin)이 정한다 (경기 종료 화면에서는 받아 준다)
      if (idx >= maxClients) { c.on('open', () => { c.send({ t: 'full', why: 'slots' }); setTimeout(() => c.close(), 300); }); return; }
      this.conns[idx] = c;
      c._lastRx = performance.now(); c._hb = false;
      c.on('open', () => {
        // 게스트가 welcome 을 받고 빠른 채널을 만든다 → 그 전에 가로채기 준비
        guardDataChannel(c, (ch) => { c._fast = bindFast(ch, (m) => { c._lastRx = performance.now(); this.onMessage && this.onMessage(m, idx + 1); }); });
        c.send({ t: 'welcome', slot: idx + 1 }); this.onJoin && this.onJoin(idx + 1);
      });
      c.on('data', (m) => {
        c._lastRx = performance.now();
        if (m && m.t === 'hb') { c._hb = true; try { c.send({ t: 'hb', t0: m.t0 }); } catch (e) {} return; }   // 하트비트는 게임에 안 넘긴다
        this.onMessage && this.onMessage(m, idx + 1);
      });
      const gone = () => { if (this.conns[idx] !== c) return; this.conns[idx] = null; this.onLeave && this.onLeave(idx + 1); };
      c.on('close', gone);
      c.on('error', gone);
      c.on('iceStateChanged', (st) => { if (st === 'failed' || st === 'closed') { try { c.close(); } catch (e) {} gone(); } });
    });
    // 하트비트가 끊긴 게스트는 정리한다 (탭 종료·화면 꺼짐은 WebRTC 가 30초 이상 지나야 알아채므로).
    // 하트비트를 한 번이라도 보낸(=새 빌드) 게스트만 대상.
    this._hbTimer = setInterval(() => {
      const now = performance.now();
      this.conns.forEach((c, i) => { if (c && c._hb && now - c._lastRx > Net.HB_TIMEOUT) { try { c.close(); } catch (e) {} if (this.conns[i] === c) { this.conns[i] = null; this.onLeave && this.onLeave(i + 1); } } });
    }, 2000);
  }

  /** 하트비트: 1초마다, 8초 침묵이면 끊긴 것으로 본다 */
  static HB_INTERVAL = 1000;
  static HB_TIMEOUT = 8000;

  join(code) {
    if (!Net._turnDone) { Net.fetchTurn().then(() => { Net._turnDone = true; if (this.role === 'client') this.join(code); }); this.role = 'client'; return; }
    this.role = 'client';
    this.code = code.toUpperCase().trim();
    this.peer = this._mkPeer(undefined);
    let opened = false;
    // 접속 타임아웃: 시그널링은 됐는데 ICE 가 끝내 안 붙는 경우(방화벽·NAT) 무한 "접속 중…" 을 막는다
    this._joinT = setTimeout(() => { if (!opened && this.onError) this.onError({ type: 'timeout' }); }, Net.JOIN_TIMEOUT);
    this.peer.on('open', () => {
      // reliable:false → 비순서(unordered) 채널. 손실된 패킷을 기다리느라 뒤 패킷까지 막히는(HOL) 일이 없어 게임용으로 낫다.
      // 대신 순서가 뒤바뀔 수 있으므로 스냅샷/입력에는 시퀀스 번호를 붙여 오래된 것을 버린다 (main.js)
      const c = this.peer.connect(PREFIX + this.code, { serialization: 'json', reliable: false });
      this.conn = c;
      let lastRx = performance.now();
      c.on('open', () => {
        opened = true; clearTimeout(this._joinT); lastRx = performance.now();
        // 하트비트: 방장이 조용히 사라진 것(폰 화면 꺼짐·앱 종료)을 몇 초 안에 알아채고 재접속으로 넘어간다
        clearInterval(this._hbTimer);
        this._hbTimer = setInterval(() => {
          if (this.conn !== c) { clearInterval(this._hbTimer); return; }
          if (!c.open) return;
          try { c.send({ t: 'hb', t0: performance.now() }); } catch (e) {}
          if (performance.now() - lastRx > Net.HB_TIMEOUT) { clearInterval(this._hbTimer); try { c.close(); } catch (e) {} }
        }, Net.HB_INTERVAL);
        this.onOpen && this.onOpen(this.code);
      });
      c.on('data', (m) => {
        lastRx = performance.now();
        if (m && m.t === 'hb') { const r = performance.now() - m.t0; this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r; return; }
        if (m.t === 'welcome') { this.mySlot = m.slot; this._openFast(c); }
        this.onMessage && this.onMessage(m, 0);
      });
      c.on('close', () => { clearInterval(this._hbTimer); this.onError && this.onError({ type: 'closed' }); });
      c.on('error', (e) => this.onError && this.onError({ type: 'conn-error', detail: e }));
      c.on('iceStateChanged', (st) => { if (st === 'failed' || st === 'closed') { try { c.close(); } catch (e) {} } });
    });
    this.peer.on('error', (e) => this.onError && this.onError(e));
  }

  /** 클라: 호스트와의 연결 위에 UDP 식 채널을 하나 더 연다 (실패해도 기본 채널로 동작) */
  _openFast(c) {
    try {
      const pc = c.peerConnection; if (!pc || c._fast) return;
      const ch = pc.createDataChannel(FAST_LABEL, { ordered: false, maxRetransmits: 0 });
      c._fast = bindFast(ch, (m) => { this._fastRx = performance.now(); this.onMessage && this.onMessage(m, 0); });
      ch.onopen = () => { this.fastOpen = true; };
      ch.onclose = () => { this.fastOpen = false; c._fast = null; };
    } catch (e) { /* 지원 안 함 → 기본 채널 */ }
  }

  /** 연결 경로 (direct / relay) — HUD 표시용. 5초마다 갱신 */
  async probePath() {
    const c = this.role === 'client' ? this.conn : this.conns.find((x) => x && x.open);
    const pc = c && c.peerConnection; if (!pc || !pc.getStats) return this.pathType;
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach((r) => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || !pair)) pair = r; });
      if (pair) {
        const lc = stats.get(pair.localCandidateId), rc = stats.get(pair.remoteCandidateId);
        const relay = (lc && lc.candidateType === 'relay') || (rc && rc.candidateType === 'relay');
        this.pathType = relay ? 'relay' : 'direct';
        if (pair.currentRoundTripTime !== undefined) this.iceRtt = pair.currentRoundTripTime * 1000;
      }
    } catch (e) {}
    return this.pathType;
  }

  /** host → 모든 클라 */
  broadcast(msg) {
    for (const c of this.conns) if (c && c.open) { try { c.send(msg); } catch (e) {} }
  }

  /** 송신 버퍼에 이만큼 이상 쌓여 있으면(아직 망에 못 내보낸 바이트) 그 게스트는 혼잡한 것으로 본다 */
  static CONGESTED_BYTES = 3000;

  /**
   * host → 모든 클라, 단 '버릴 수 있는' 메시지(스냅샷). 회선이 느린 게스트에게는 큐에 쌓지 않고 이번 것을 건너뛴다.
   * 쌓아 두면 지연이 계속 늘다가 한꺼번에 도착해 '미끄러지다 뚝 끊기고, 안 맞다가 우다다 맞는' 현상이 된다.
   * 건너뛴 스냅샷의 이벤트(ev)는 게스트별로 모아 두었다가 다음에 보낼 때 같이 보낸다 (타격·효과음 유실 방지).
   */
  broadcastDroppable(msg) {
    const ev = msg.ev || [];
    for (const c of this.conns) {
      if (!c || !c.open) continue;
      const fast = c._fast && c._fast.readyState === 'open' ? c._fast : null;
      const dc = fast || c.dataChannel;
      const congested = dc && dc.bufferedAmount > Net.CONGESTED_BYTES;
      if (congested) { if (ev.length) c._evq = (c._evq || []).concat(ev); c._dropped = (c._dropped || 0) + 1; continue; }
      let out = msg;
      if (c._evq && c._evq.length) { out = Object.assign({}, msg, { ev: c._evq.concat(ev) }); c._evq = null; }
      try { if (fast) fast.send(JSON.stringify(out)); else c.send(out); } catch (e) {}
    }
  }
  /** client → host (신뢰) */
  send(msg) { if (this.conn && this.conn.open) { try { this.conn.send(msg); } catch (e) {} } }
  /** client → host, 빠른 채널 우선 (입력처럼 다음 것으로 대체되는 데이터). 채널이 없으면 기본 채널 */
  sendFast(msg) {
    const c = this.conn; if (!c || !c.open) return;
    const f = c._fast;
    if (f && f.readyState === 'open') { try { f.send(JSON.stringify(msg)); return; } catch (e) {} }
    try { c.send(msg); } catch (e) {}
  }

  /** host: 슬롯 강퇴 — 통보 후 연결 종료 (close 이벤트로 onLeave 호출됨) */
  kick(slot) {
    const c = this.conns[slot - 1]; if (!c) return;
    try { c.send({ t: 'kicked' }); } catch (e) {}
    setTimeout(() => { if (this.conns[slot - 1] === c) { this.conns[slot - 1] = null; this.onLeave && this.onLeave(slot); } try { c.close(); } catch (e) {} }, 150);
  }

  get connectedSlots() { const r = []; this.conns.forEach((c, i) => { if (c && c.open) r.push(i + 1); }); return r; }

  close() {
    // 콜백 먼저 끊는다 — destroy 중 나오는 close/error 이벤트가 새 Net 의 상태를 건드리지 않게
    this.onMessage = this.onJoin = this.onLeave = this.onOpen = this.onError = this.onReconnect = null;
    clearTimeout(this._joinT); clearTimeout(this._reconnT); clearInterval(this._hbTimer);
    if (this._unwake) { this._unwake(); this._unwake = null; }
    try { this.peer && this.peer.destroy(); } catch (e) {}
    this.peer = null; this.conns = []; this.conn = null; this.role = 'none';
  }
}
