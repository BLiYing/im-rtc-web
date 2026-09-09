#!/usr/bin/env bash
# dev.sh —— 起 Demo 站点（Vite）。先杀后起、幂等。
#
#   ./scripts/dev.sh                起 demo（5178，已在跑则先杀掉重起）
#   ./scripts/dev.sh react          起 demo-react（5179）
#   ./scripts/dev.sh stop react     只停
#   ./scripts/dev.sh status react   看状态
#   ./scripts/dev.sh logs react     跟日志
#
# 两个 Demo 是两条集成路线（见 demo-react/vite.config.ts 的注释），各占一个端口：
# demo 5178 / demo-react 5179。用 5178/5179 而不是 Vite 默认的 5173：本机 5173 被
# 姊妹项目 im-web 占着。
#
# **端口不提供覆盖**：它写死在各自 vite.config.ts 里且 strictPort:true，vite 根本不读
# PORT 环境变量。老版本那句提示「换个端口：PORT=5179 ./scripts/dev.sh」是假的——既改不
# 了端口，workspace 也仍然是硬编码的 demo，照着做只会又起一个 5178。
#
# **就绪检查会核对页面标题**——只看 HTTP 200 会连到陌生进程上误判
# （服务端那边的 dev.sh 已经踩过一次同样的坑）。
#
# **反复出现的那种「端口被占」**：用 Ctrl+Z 而不是 Ctrl+C 停 vite，会把整个进程组挂起
# （STAT=T）。挂起的进程仍然持有 listen socket 却不响应任何请求，下次启动就报
# "Port is already in use"，curl 上去是连得上、然后零字节超时。这种进程收不到 SIGTERM，
# 而且 SIGCONT 唤醒后会立刻因后台读 tty 收到 SIGTTIN 再次挂起——只能 KILL 整个进程组。
# reclaim_port() 干的就是这件事，且只对本仓的进程动手。
set -u

cd "$(dirname "$0")/.." || { echo "无法定位仓库根目录"; exit 2; }
REPO_ROOT=$(pwd)

usage() { echo "用法：$0 [start|stop|status|logs] [demo|react]"; }

# 命令与目标各认各的词，顺序随意：`dev.sh react`、`dev.sh stop react` 都行。
CMD=start
TARGET=demo
for arg in "$@"; do
  case "$arg" in
    start|stop|status|logs) CMD=$arg ;;
    demo|react)             TARGET=$arg ;;
    *) usage; exit 2 ;;
  esac
done

LOG_DIR=${DEV_LOG_DIR:-dev-logs}

# 标题取自各自的 index.html，两个串互不包含——就绪检查才不会张冠李戴。
case "$TARGET" in
  demo)
    PORT=5178; WORKSPACE=demo;       MARK='im-rtc Demo'
    LOG="$LOG_DIR/vite.log";         PIDFILE="$LOG_DIR/vite.pid" ;;
  react)
    PORT=5179; WORKSPACE=demo-react; MARK='引 uikit 的 Demo'
    LOG="$LOG_DIR/vite-react.log";   PIDFILE="$LOG_DIR/vite-react.pid" ;;
esac
BASE="http://localhost:$PORT"

running_pid() {
  [ -f "$PIDFILE" ] || return 1
  local pid; pid=$(cat "$PIDFILE" 2>/dev/null)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  echo "$pid"
}

port_holder() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1; }

show_proc() { ps -p "$1" -o pid=,stat=,command= 2>/dev/null | sed 's/^/    /'; }

# 停本脚本自己起的那棵进程树（认 pidfile）。
stop_server() {
  local pid
  if pid=$(running_pid); then
    echo "停止 Vite（pid ${pid}）…"
    pkill -P "$pid" 2>/dev/null
    kill "$pid" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -9 "$pid" 2>/dev/null
  fi
  rm -f "$PIDFILE"
}

# 回收端口上的残留：**只杀本仓的进程**（命令行里带 REPO_ROOT），外部进程一律不碰。
# 这条路径覆盖的是 pidfile 管不到的情况——比如你在别的终端直接 `npm run dev:react`
# 然后 Ctrl+Z 挂起了它。
reclaim_port() {
  local holder cmd pgid self_pgid
  holder=$(port_holder)
  [ -n "$holder" ] || return 0

  cmd=$(ps -o command= -p "$holder" 2>/dev/null)
  case "$cmd" in
    *"$REPO_ROOT"*) ;;
    *)
      echo "✗ 端口 ${PORT} 被本仓之外的进程占用，不动它："
      show_proc "$holder"
      return 1 ;;
  esac

  echo "端口 ${PORT} 上有本仓残留进程，回收…"
  show_proc "$holder"
  # 连进程组一起杀：npm → npm → vite 三层，只杀 vite 会剩下两个 npm 空壳。
  # 用 KILL 不用 TERM：挂起态（STAT=T）的进程收不到 TERM。
  # 自己的进程组要跳过，否则这一刀砍到脚本自己身上。
  self_pgid=$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')
  pgid=$(ps -o pgid= -p "$holder" 2>/dev/null | tr -d ' ')
  if [ -n "$pgid" ] && [ "$pgid" != "$self_pgid" ]; then
    kill -9 -"$pgid" 2>/dev/null
  fi
  kill -9 "$holder" 2>/dev/null

  for _ in $(seq 1 20); do
    [ -z "$(port_holder)" ] && return 0
    sleep 0.25
  done
  echo "✗ 端口 ${PORT} 仍被占用，手动看：lsof -nP -iTCP:${PORT} -sTCP:LISTEN"
  return 1
}

start_server() {
  reclaim_port || exit 1

  mkdir -p "$LOG_DIR"
  echo "启动 Vite ${BASE}（workspace ${WORKSPACE}，日志 ${LOG}）…"
  npm run dev -w "$WORKSPACE" >"$LOG" 2>&1 &
  echo $! > "$PIDFILE"

  for _ in $(seq 1 60); do
    # 核对页面标题：只看 200 会被端口上任何一个 web 服务骗过去。
    if curl -fsS --max-time 1 "$BASE/" 2>/dev/null | grep -q "$MARK"; then
      echo "✓ ${WORKSPACE} 就绪 ${BASE}"
      return 0
    fi
    sleep 0.25
  done
  echo "✗ 15 秒内没就绪，看日志：tail -n 30 ${LOG}"
  tail -n 20 "$LOG"
  exit 1
}

case "$CMD" in
  start)  stop_server; start_server ;;
  stop)   stop_server; reclaim_port && echo "已停止 ${WORKSPACE}" ;;
  status)
    pid=$(running_pid) || pid=""
    holder=$(port_holder)
    if [ -n "$pid" ]; then
      echo "running（pid ${pid}） ${BASE}"
    elif [ -n "$holder" ]; then
      echo "端口 ${PORT} 被占，但不是本脚本起的："
      show_proc "$holder"
    else
      echo "stopped"
    fi ;;
  logs)   tail -f "$LOG" ;;
esac
