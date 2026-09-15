#!/usr/bin/env python3
"""no-cache 정적 서버. 브라우저/터널 캐시 때문에 구버전이 남지 않도록 Cache-Control: no-store 를 붙인다."""
import http.server, socketserver, sys
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), H) as httpd:
    print('serving on', PORT, flush=True)
    httpd.serve_forever()
