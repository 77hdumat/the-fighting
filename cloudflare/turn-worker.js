// Cloudflare Worker: 게임 클라이언트에 단기 TURN 자격증명을 발급한다.
// 배포: Cloudflare 대시보드 → Workers & Pages → Create Worker → 이 파일 내용 붙여넣기 → Deploy
//       Settings → Variables and Secrets 에 아래 두 개를 Secret 으로 추가:
//         TURN_KEY_ID    = Realtime → TURN → 키 만들기에서 받은 Key ID
//         TURN_API_TOKEN = 같은 화면의 API Token
// 게임 쪽: dev.html 의 window.TURN_ENDPOINT = 'https://<worker-name>.<account>.workers.dev/turn'
export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',           // 필요하면 'https://77hdumat.github.io' 로 제한
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (url.pathname !== '/turn') return new Response('ok', { headers: cors });
    // 자격증명 유효시간: 4시간 (경기 하나가 이보다 길 일은 없다. 연결이 이미 맺어진 뒤에는 만료돼도 끊기지 않는다)
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 14400 }),
    });
    if (!r.ok) return new Response(JSON.stringify({ error: 'turn credential failed', status: r.status }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
    const j = await r.json();   // { iceServers: [{ urls: [...], username, credential }] }
    return new Response(JSON.stringify(j), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  },
};
