#!/usr/bin/env bash
#
# Web 音乐播放器 启停脚本
#
# 用法:
#   ./music-player.sh start    # 后台启动服务
#   ./music-player.sh stop     # 停止服务
#   ./music-player.sh restart  # 重启服务
#   ./music-player.sh status   # 查看运行状态
#
# 可通过环境变量覆盖默认配置（与 server.js 保持一致）:
#   PORT=9000 MUSIC_DIR=/path/to/songs ./music-player.sh start
#
set -u

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$APP_DIR/tmp/server.pid"
LOG_FILE="$APP_DIR/tmp/server.log"
PORT="${PORT:-8787}"
HOST="${HOST:-0.0.0.0}"

mkdir -p "$APP_DIR/tmp"

# ─── 工具函数 ───────────────────────────────────────────────

# 通过 PID 文件获取正在运行的服务 PID；未运行返回非 0
pid_from_file() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  # 确认 PID 存活且确实是本项目的 node 进程
  if kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o args= 2>/dev/null | grep -q "server\.js"; then
    echo "$pid"
    return 0
  fi
  return 1
}

# 兜底：无 PID 文件时，按「node server.js 且工作目录为本项目」识别进程
find_orphan_pid() {
  local d pid cmdline cwd
  for d in /proc/[0-9]*; do
    pid="${d#/proc/}"
    cmdline="$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)" || continue
    case "$cmdline" in
      *node*server.js*) ;;
      *) continue ;;
    esac
    cwd="$(readlink "$d/cwd" 2>/dev/null)" || continue
    if [ "$cwd" = "$APP_DIR" ]; then
      echo "$pid"
      return 0
    fi
  done
  return 1
}

# 综合获取服务 PID（PID 文件优先，其次兜底识别）
running_pid() {
  pid_from_file && return 0
  find_orphan_pid && return 0
  return 1
}

# 检查端口是否已被占用（尝试绑定，绑定失败即占用）
port_in_use() {
  ! node -e "
    const s = require('net').createServer();
    s.once('error', () => process.exit(1));
    s.listen(${PORT}, '${HOST}', () => s.close(() => process.exit(0)));
  " >/dev/null 2>&1
}

wait_stopped() {
  local pid="$1" i
  for i in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.2
  done
  return 1
}

# ─── 命令实现 ───────────────────────────────────────────────

do_start() {
  local pid
  if pid="$(running_pid)"; then
    echo "服务已在运行 (PID: $pid, 端口: $PORT)"
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "错误: 未找到 node，请先安装 Node.js >= 22" >&2
    return 1
  fi

  if port_in_use; then
    echo "错误: 端口 $PORT 已被其他进程占用，请改用其他端口（如 PORT=9000 $0 start）或先停止占用进程" >&2
    return 1
  fi

  echo "启动 Web 音乐播放器 (端口: $PORT) ..."
  cd "$APP_DIR" || return 1
  nohup node server.js >>"$LOG_FILE" 2>&1 </dev/null &
  pid=$!
  echo "$pid" >"$PID_FILE"

  # 等待就绪：进程存活且 HTTP 可达（最多 5 秒）
  local i
  for i in $(seq 1 25); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "错误: 进程启动后立即退出，日志末尾如下: $LOG_FILE" >&2
      tail -n 15 "$LOG_FILE" >&2
      return 1
    fi
    if curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/library" 2>/dev/null; then
      echo "启动成功 (PID: $pid)"
      echo "  本机访问:   http://localhost:$PORT"
      echo "  日志文件:   $LOG_FILE"
      return 0
    fi
    sleep 0.2
  done

  echo "警告: 进程已启动 (PID: $pid)，但端口 $PORT 未在 5 秒内就绪，请检查日志: $LOG_FILE" >&2
  return 1
}

do_stop() {
  local pid
  if ! pid="$(running_pid)"; then
    echo "服务未在运行"
    rm -f "$PID_FILE"
    return 0
  fi

  echo "停止服务 (PID: $pid) ..."
  kill "$pid" 2>/dev/null
  if wait_stopped "$pid"; then
    echo "已停止"
  else
    echo "进程未在 4 秒内退出，强制终止 ..."
    kill -9 "$pid" 2>/dev/null
    wait_stopped "$pid" || true
    echo "已强制停止"
  fi
  rm -f "$PID_FILE"
  return 0
}

do_status() {
  local pid
  if pid="$(running_pid)"; then
    echo "运行中 (PID: $pid, 端口: $PORT)"
    if curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/library" 2>/dev/null; then
      echo "  HTTP 检查: 正常 (http://127.0.0.1:$PORT)"
    else
      echo "  HTTP 检查: 无响应（进程存活但接口不可达）"
    fi
  else
    echo "未运行"
    return 1
  fi
}

# ─── 入口 ───────────────────────────────────────────────────

case "${1:-}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop && do_start ;;
  status)  do_status ;;
  *)
    echo "用法: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
