#!/usr/bin/env bash
# check-logging.sh —— 日志纪律的硬闸（CONVENTIONS.md §6）。
#
#   ./scripts/check-logging.sh            全量
#   ./scripts/check-logging.sh --selftest 门禁自检
#
# 机制说明见 ../im-rtc-server/docs/mechanism/LOGGING.md（四仓统一）。
#
# 为什么需要一道闸：这几条规矩在规范里写了很久，但规范拦不住手滑。
# 姊妹项目上「禁止直接 console」这条出过很多次违规而无人察觉——有兜底时看起来没坏。
#
# 三条规矩：
#   ① 业务代码禁止 console.* —— 一律走 engine 的 logger（logger.ts 是唯一豁免）。
#   ② 媒体回调与统计轮询（HOTPATH-BEGIN/END 之间）禁止日志：那是高频路径。
#   ③ 凭据与 SDP 不得整条进日志 —— 必须过 redact / redactSdp / redactCandidate。
set -u

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

# CHECK_ROOT 让 --selftest 能把闸门指向临时目录。
# 不做这一步的话，自检的子调用会 cd 回真仓库、扫到「全部通过」，
# 于是**自检永远说闸门坏了**——这道自检本身就是这么被抓出来的。
SCAN_ROOT="${CHECK_ROOT:-$(dirname "$0")/..}"
cd "$SCAN_ROOT" || { echo "无法定位扫描根目录 $SCAN_ROOT"; exit 2; }

fail=0
report() { echo "  ✗ $1"; fail=1; }

sources() {
  find packages demo -type f \( -name '*.ts' -o -name '*.tsx' \) \
    -not -path '*/node_modules/*' -not -path '*/dist/*' \
    -not -name '*.test.ts' -not -name '*.test.tsx' 2>/dev/null | sort
}

is_console_exempt() {
  case "$1" in
    */src/logger.ts) return 0 ;;
  esac
  return 1
}

# ── 自检 ──────────────────────────────────────────────────────
run_selftest() {
  tmp=$(mktemp -d) || exit 2
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/packages/bad/src"
  cat > "$tmp/packages/bad/src/x.ts" <<'TS'
export function f(token: string): void {
  console.log('nope');
  logger.info('leak', { token: token });
}
TS
  if CHECK_ROOT="$tmp" bash "$SELF" >/dev/null 2>&1; then
    echo "✗ selftest：闸门放行了明显违规的文件"
    exit 1
  fi
  echo "✓ check-logging selftest 通过"
  exit 0
}

if [ "${1:-}" = "--selftest" ]; then
  run_selftest
fi


echo "== 日志纪律检查 =="

# ── ① console.* ───────────────────────────────────────────────
echo "  [1/3] 直接用 console"
while IFS= read -r file; do
  is_console_exempt "$file" && continue
  hits=$(grep -nE '(^|[^[:alnum:]_.$])console\.(log|info|warn|error|debug|trace)\(' "$file" \
         | grep -v 'eslint-disable' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r hit; do report "$file:$hit —— 走 engine 的 logger，别直接用 console"; done <<< "$hits"
  fi
done < <(sources)

# ── ② 高频路径里的日志 ────────────────────────────────────────
echo "  [2/3] 高频路径（HOTPATH-BEGIN…HOTPATH-END）里的日志调用"
while IFS= read -r file; do
  hits=$(awk '
    /HOTPATH-BEGIN/ { inhot=1; next }
    /HOTPATH-END/   { inhot=0; next }
    inhot && /logger\.|console\./ { print NR ": " $0 }
  ' "$file" || true)
  if [ -n "$hits" ]; then
    while IFS= read -r hit; do report "$file:$hit —— 高频路径禁止日志，用计数器或事件"; done <<< "$hits"
  fi
done < <(sources)

# ── ③ 凭据 / SDP 整条进日志 ───────────────────────────────────
echo "  [3/3] 凭据与 SDP 是否过了脱敏"
SENSITIVE="'(token|roomToken|room_token|secret|sdp|candidate|password)'"
while IFS= read -r file; do
  hits=$(grep -nE "logger\.(debug|info|warn|error)\(.*(token|roomToken|sdp|candidate)\s*[,:}]" "$file" \
         | grep -vE 'redact|Redact' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r hit; do
      report "$file:$hit —— 用 redact / redactSdp / redactCandidate"
    done <<< "$hits"
  fi
done < <(sources)
: "$SENSITIVE"

echo ""
if [ "$fail" -ne 0 ]; then
  echo "结果：✗ 日志纪律有违规。见 CONVENTIONS.md §6 与 ../im-rtc-server/docs/mechanism/LOGGING.md。"
  exit 1
fi
echo "结果：✓ 全部通过。"
exit 0
