#!/bin/sh
# 빌드 → 커밋 → push = GitHub Pages 배포 (1~2분 후 반영)
set -e
cd "$(dirname "$0")"
python3 build_standalone.py
git add -A
git commit -q -m "${1:-deploy $(date '+%Y-%m-%d %H:%M')}" || true
git push -q origin main
echo "pushed → https://77hdumat.github.io/the-fighting/  (1~2분 뒤 반영, 안 바뀌면 강력 새로고침)"
