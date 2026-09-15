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
    this.mySlot = 0;
  }

  _mkPeer(id) {
    return new Peer(id, { debug: 1, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } });
  }

  /** code 를 주면 그 코드로 방을 연다 (호스트 승계). 아직 이전 호스트 ID 가 안 풀렸으면 잠시 후 재시도 */
  host(maxClients = 3, code = null, tries = 0) {
    this.role = 'host';
    this.code = code || makeCode();
    this.peer = this._mkPeer(PREFIX + this.code);
    this.peer.on('open', () => this.onOpen && this.onOpen(this.code));
    this.peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        this.peer.destroy();
        if (code && tries < 10) setTimeout(() => this.host(maxClients, code, tries + 1), 900);
        else this.host(maxClients);
        return;
      }
      this.onError && this.onError(e);
    });
    this.peer.on('connection', (c) => {
      const slot = this.conns.findIndex((x) => !x) ;
      const idx = slot === -1 ? this.conns.length : slot;
      if (idx >= maxClients || this.started) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; }
      this.conns[idx] = c;
      c.on('open', () => { c.send({ t: 'welcome', slot: idx + 1 }); this.onJoin && this.onJoin(idx + 1); });
      c.on('data', (m) => this.onMessage && this.onMessage(m, idx + 1));
      const gone = () => { if (this.conns[idx] !== c) return; this.conns[idx] = null; this.onLeave && this.onLeave(idx + 1); };
      c.on('close', gone);
      c.on('error', gone);
    });
  }

  join(code) {
    this.role = 'client';
    this.code = code.toUpperCase().trim();
    this.peer = this._mkPeer(undefined);
    this.peer.on('open', () => {
      const c = this.peer.connect(PREFIX + this.code, { serialization: 'json', reliable: false });
      this.conn = c;
      c.on('open', () => { this.onOpen && this.onOpen(this.code); });
      c.on('data', (m) => {
        if (m.t === 'welcome') this.mySlot = m.slot;
        this.onMessage && this.onMessage(m, 0);
      });
      c.on('close', () => this.onError && this.onError({ type: 'closed' }));
    });
    this.peer.on('error', (e) => this.onError && this.onError(e));
  }

  /** host → 모든 클라 */
  broadcast(msg) {
    for (const c of this.conns) if (c && c.open) { try { c.send(msg); } catch (e) {} }
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
    this.onMessage = this.onJoin = this.onLeave = this.onOpen = this.onError = null;
    try { this.peer && this.peer.destroy(); } catch (e) {}
    this.peer = null; this.conns = []; this.conn = null; this.role = 'none';
  }
}
