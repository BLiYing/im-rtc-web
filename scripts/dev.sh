#!/usr/bin/env bash
# dev.sh —— 起 Demo 站点（Vite）。先杀后起、幂等。
#
#   ./scripts/dev.sh            起（已在跑则先杀掉重起）
#   ./scripts/dev.sh stop       只停
#   ./scripts/dev.sh status     看状态
#
# 端口用 5178 而不是 Vite 默认的 5173：本机 5173 已经被别的东西占着。
# **就绪检查会核对页面标题**——只看 HTTP 200 会连到陌生进程上误判
# （服务端那边的 dev.sh 已经踩过一次同样的坑）。
set -u

cd "$(dirname "$0")/.." || { echo "无法定位仓库根目录"; exit 2; }

PORT=${PORT:-5178}
BASE="http://localhost:$PORT"
MARK='im-rtc Demo'
LOG_DIR=${DEV_LOG_DIR:-dev-logs}
LOG="$LOG_DIR/vite.log"
PIDFILE="$LOG_DIR/vite.pid"

running_pid() {
  [ -f "$PIDFILE" ] || return 1
  local pid; pid=$(cat "$PIDFILE" 2>/dev/null)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  echo "$pid"
}

port_holder() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1; }

stop_server() {
  local pid
  if pid=$(running_pid); then
    echo "停止 Vite（pid $pid）…"
    pkill -P "$pid" 2>/dev/null
    kill "$pid" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -9 "$pid" 2>/dev/null
  fi
  rm -f "$PIDFILE"
}

start_server() {
  local holder; holder=$(port_holder)
  if [ -n "$holder" ]; then
    echo "✗ 端口 $PORT 已被 pid $holder 占用："
    ps -p "$holder" -o pid,comm= 2>/dev/null | sed 's/^/    /'
    echo "  换个端口：PORT=5179 ./scripts/dev.sh"
    exit 1
  fi

  mkdir -p "$LOG_DIR"
  echo "启动 Vite $BASE（日志 $LOG）…"
  npm run dev -w demo >"$LOG" 2>&1 &
  echo $! > "$PIDFILE"

  for _ in $(seq 1 60); do
    # 核对页面标题：只看 200 会被端口上任何一个 web 服务骗过去。
    if curl -fsS --max-time 1 "$BASE/" 2>/dev/null | grep -q "$MARK"; then
      echo "✓ Demo 就绪 $BASE"
      return 0
    fi
    sleep 0.25
  done
  echo "✗ 15 秒内没就绪，看日志：tail -n 30 $LOG"
  tail -n 20 "$LOG"
  exit 1
}

case "${1:-start}" in
  start)  stop_server; start_server ;;
  stop)   stop_server; echo "已停止" ;;
  status)
    if pid=$(running_pid); then echo "running（pid $pid） $BASE"; else echo "stopped"; fi ;;
  logs)   tail -f "$LOG" ;;
  *)      echo "用法：$0 [start|stop|status|logs]"; exit 2 ;;
esac
