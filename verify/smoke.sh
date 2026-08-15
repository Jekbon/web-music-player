#!/usr/bin/env bash
# Verify 冒烟脚本：启动服务，验证首页/静态资源/曲库API/Range流式/上传/歌单，然后停止服务。
set -u
cd "$(dirname "$0")/.."

PORT=18798
MUSIC_DIR=$(mktemp -d /tmp/wmp-verify-music-XXXXXX)
DATA_DIR=$(mktemp -d /tmp/wmp-verify-data-XXXXXX)
BASE="http://127.0.0.1:${PORT}"
FAIL=0

check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS: $1 ($3)"; else echo "FAIL: $1 (expected $2, got $3)"; FAIL=1; fi
}

# 准备测试曲目（wav 头 + 数据，可被扫描收录）
mkdir -p "$MUSIC_DIR/测试专辑"
printf 'RIFF' > "$MUSIC_DIR/测试专辑/demo.wav"
head -c 1024 /dev/zero >> "$MUSIC_DIR/测试专辑/demo.wav"
printf '[00:01.00]verify line\n' > "$MUSIC_DIR/测试专辑/demo.lrc"

PORT=$PORT MUSIC_DIR="$MUSIC_DIR" DATA_DIR="$DATA_DIR" node server.js > /tmp/wmp-verify-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; rm -rf "$MUSIC_DIR" "$DATA_DIR"' EXIT

# 等待就绪
for i in $(seq 1 40); do
  curl -s -o /dev/null "$BASE/api/library" && break
  sleep 0.2
done

check "首页 index.html" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")"
check "style.css" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/style.css")"
check "app.js" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/app.js")"

LIB=$(curl -s "$BASE/api/library")
TRACK_ID=$(echo "$LIB" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['tracks'][0]['id'] if d['tracks'] else '')")
check "曲库收录 1 首" "1" "$(echo "$LIB" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['tracks']))")"
check "曲目字段完整" "ok" "$(echo "$LIB" | python3 -c "import json,sys; t=json.load(sys.stdin)['tracks'][0]; print('ok' if all(k in t for k in ['id','title','artist','album','folder','path','size']) else 'missing')")"

check "stream 无 Range 返回 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/stream/$TRACK_ID")"
check "stream Range 返回 206" "206" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-99' "$BASE/api/stream/$TRACK_ID")"
check "stream Content-Range 正确" "bytes 0-99/1028" "$(curl -s -D - -o /dev/null -H 'Range: bytes=0-99' "$BASE/api/stream/$TRACK_ID" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-range"{print $2}')"
check "stream 未知 id 返回 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/stream/deadbeefdeadbeef")"

check "lyrics 找到 lrc" "True" "$(curl -s "$BASE/api/lyrics/$TRACK_ID" | python3 -c "import json,sys; print(json.load(sys.stdin)['found'])")"

# 上传（python 构造 multipart，保证二进制完整）
TMPFILE=$(mktemp)
printf 'RIFF' > "$TMPFILE"; head -c 512 /dev/zero >> "$TMPFILE"
HTTP=$(python3 - "$BASE" "$TMPFILE" <<'EOF'
import sys, urllib.request, os
base, src = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()
boundary = '----wmpverify'
body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.wav"\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
req = urllib.request.Request(base + '/api/upload', data=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
try:
    resp = urllib.request.urlopen(req)
    print(resp.status)
except urllib.error.HTTPError as e:
    print(e.code)
EOF
)
check "上传 wav 返回 201" "201" "$HTTP"
check "上传后曲库收录 2 首" "2" "$(curl -s "$BASE/api/library" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['tracks']))")"

BAD=$(python3 - "$BASE" <<'EOF'
import sys, urllib.request
base = sys.argv[1]
boundary = '----wmpverify'
body = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.exe"\r\n\r\nx\r\n--{boundary}--\r\n'.encode()
req = urllib.request.Request(base + '/api/upload', data=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
try:
    print(urllib.request.urlopen(req).status)
except urllib.error.HTTPError as e:
    print(e.code)
EOF
)
check "上传 exe 被拒绝 400" "400" "$BAD"

# 歌单
PL_ID=$(curl -s -X POST "$BASE/api/playlists" -d '{"name":"验证歌单"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
check "歌单创建" "ok" "$([ -n "$PL_ID" ] && echo ok || echo fail)"
check "歌单列表含 1 项" "1" "$(curl -s "$BASE/api/playlists" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['playlists']))")"
check "添加曲目到歌单" "1" "$(curl -s -X POST "$BASE/api/playlists/$PL_ID/tracks" -d "{\"trackId\":\"$TRACK_ID\"}" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['trackIds']))")"
check "歌单落盘文件存在" "ok" "$([ -f "$DATA_DIR/playlists.json" ] && echo ok || echo fail)"
check "删除歌单 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/playlists/$PL_ID")"

echo "----------------------------------------"
if [ "$FAIL" = "0" ]; then echo "SMOKE RESULT: ALL PASS"; exit 0; else echo "SMOKE RESULT: FAILURES DETECTED"; exit 1; fi
