// Net.js — PeerJS 방코드 매칭 (호스트 권위 스타형). 전역 `Peer` (peerjs UMD) 사용.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeCode() { let s = ''; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }
const PREFIX = 'the-fighting-';

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

  _mkPeer(id) {
    // STUN 만으로는 대칭 NAT(특히 모바일 데이터망) 뒤의 게스트가 호스트에 못 붙는다 → 공개 TURN 을 후보에 넣어 릴레이 폴백.
    // (openrelay: metered.ca 가 운영하는 무료 공개 TURN. 직결이 되면 ICE 가 알아서 직결 경로를 고른다)
    const peer = new Peer(id, {
      debug: 1,
      pingInterval: 5000,
      config: {
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        ],
        iceCandidatePoolSize: 4,
      },
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
      c.on('open', () => { c.send({ t: 'welcome', slot: idx + 1 }); this.onJoin && this.onJoin(idx + 1); });
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
        if (m.t === 'welcome') this.mySlot = m.slot;
        this.onMessage && this.onMessage(m, 0);
      });
      c.on('close', () => { clearInterval(this._hbTimer); this.onError && this.onError({ type: 'closed' }); });
      c.on('error', (e) => this.onError && this.onError({ type: 'conn-error', detail: e }));
      c.on('iceStateChanged', (st) => { if (st === 'failed' || st === 'closed') { try { c.close(); } catch (e) {} } });
    });
    this.peer.on('error', (e) => this.onError && this.onError(e));
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
      const dc = c.dataChannel;
      const congested = dc && dc.bufferedAmount > Net.CONGESTED_BYTES;
      if (congested) { if (ev.length) c._evq = (c._evq || []).concat(ev); c._dropped = (c._dropped || 0) + 1; continue; }
      let out = msg;
      if (c._evq && c._evq.length) { out = Object.assign({}, msg, { ev: c._evq.concat(ev) }); c._evq = null; }
      try { c.send(out); } catch (e) {}
    }
  }
  /** client → host */
  send(msg) { if (this.conn && this.conn.open) { try { this.conn.send(msg); } catch (e) {} } }

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
