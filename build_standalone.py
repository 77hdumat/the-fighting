#!/usr/bin/env python3
"""dev.html + js/*.js 모듈을 하나의 HTML(인라인 module script)로 합쳐 index.html 을 만든다.
- 배포본은 단일 파일이라 모듈별 캐시 버전이 섞이는 문제가 원천적으로 없다.
- dempsey-standalone.html 은 같은 내용의 복사본 (더블클릭/file:// 용).
개발 중엔 dev.html 을 열면 모듈 버전이 그대로 로드된다."""
import re, os, pathlib
root = pathlib.Path(__file__).parent
js = root / 'js'
mods = {}
for f in js.glob('*.js'):
    mods[f.stem] = f.read_text(encoding='utf-8')

ext_imports = []   # three / addons import 문 (호이스팅)
order = []
def deps(name):
    return re.findall(r"from\s+'\./(\w+)\.js'", mods[name])
def visit(name, stack=()):
    if name in order: return
    if name in stack: raise RuntimeError('circular: ' + name)
    for d in deps(name): visit(d, stack + (name,))
    order.append(name)
for n in mods: visit(n)

out = ['const __M = {};']
seen_ext = set()
for name in order:
    src = mods[name]
    body_lines = []
    for line in src.splitlines():
        m = re.match(r"\s*import\s+(.+?)\s+from\s+'(three[^']*)';", line)
        if m:
            if line.strip() not in seen_ext:
                seen_ext.add(line.strip()); ext_imports.append(line.strip())
            continue
        m = re.match(r"\s*import\s+\{([^}]+)\}\s+from\s+'\./(\w+)\.js';", line)
        if m:
            body_lines.append(f"const {{{m.group(1)}}} = __M.{m.group(2)};")
            continue
        body_lines.append(line)
    body = '\n'.join(body_lines)
    exports = re.findall(r"^export\s+(?:async\s+)?(?:class|function|const|let|var)\s+(\w+)", body, re.M)
    body = re.sub(r"^export\s+", "", body, flags=re.M)
    out.append(f"// ===== {name}.js =====\n__M.{name} = (() => {{\n{body}\nreturn {{ {', '.join(exports)} }};\n}})();")
script = '\n'.join(ext_imports) + '\n' + '\n'.join(out)

import time, re as _re
build_id = str(int(time.time()))
idx_path = root / 'dev.html'
idx = idx_path.read_text(encoding='utf-8')
idx = _re.sub(r"js/main\.js\?v=[^\"]*", "js/main.js?v=" + build_id, idx)
idx_path.write_text(idx, encoding='utf-8')
html = idx
css = (root / 'style.css').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
html = _re.sub(r'<script type="module" src="js/main\.js[^"]*"[^>]*></script>', lambda m: '<script type="module">\n' + script + '\n</script>', html)
# 빌드 ID 를 페이지에 심고, 같은 값을 version.json 으로도 내보낸다 (자동 갱신용)
html = html.replace('<head>', '<head>\n<meta name="build-id" content="' + build_id + '">\n<meta http-equiv="Cache-Control" content="no-cache">', 1)
html = html.replace('</head>', '<script>window.__BUILD_ID = "' + build_id + '";</script>\n</head>', 1)
(root / 'index.html').write_text(html, encoding='utf-8')
(root / 'dempsey-standalone.html').write_text(html, encoding='utf-8')
(root / 'version.json').write_text('{"build":"' + build_id + '"}\n', encoding='utf-8')
print('built index.html + dempsey-standalone.html', len(html), 'bytes; build', build_id, '; modules:', order)
