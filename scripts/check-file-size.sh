#!/usr/bin/env bash
# check-file-size.sh —— 防「上帝文件」体检：单个 .ts/.tsx 文件行数超阈值即失败（见 CONVENTIONS.md §2）。
#
#   全量（pre-commit / CI / test.sh 第 1 步）：  ./scripts/check-file-size.sh
#   指定文件：                                   ./scripts/check-file-size.sh a.ts b.tsx
#   编辑期钩子单文件（静默，仅超限时 stderr+exit 2）： ./scripts/check-file-size.sh --hook path/to/x.tsx
#   门禁自检（防「fail-open 闸回归后静默放行」）：  ./scripts/check-file-size.sh --selftest
#
#   退出码 1 = 有文件超预算；2 = --hook 命中超限 / 内部错误。
#
# 阈值 400。超标的正确处理是**拆分**，不是放宽阈值：
#   ① 组件膨胀     → 抽子组件 + 抽自定义 hook（useCallControls），逻辑与渲染分离。
#   ② 纯计算逻辑   → 抽独立 .ts 模块并直接单测（不经 React）。
#   ③ 状态机膨胀   → 按状态族拆文件。
# 姊妹项目 im-web 的教训：App.tsx 长到 4891 行后拆了很久才收口。别重蹈覆辙。
#
# 历史欠账登记在 grandfather_limit()：值 = 登记时行数 + 少量余量，**只准降不准升**；
# 降到 MAX 以下后从表里删掉那一行。新仓请保持这张表为空。
set -u

MAX_LINES=${MAX_LINES:-400}
WARN_RATIO=${WARN_RATIO:-80}   # 达上限该比例即预警（不失败），尽早规划拆分

grandfather_limit() {
  case "$1" in
    # 目前没有历史欠账 —— 新仓，别开这个口子。
    *) echo "" ;;
  esac
}

# 测试文件不纳入体检（表驱动用例天然长）；生成代码同理。
is_skipped() {
  case "$1" in
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*.d.ts|*/__tests__/*) return 0 ;;
  esac
  return 1
}

cd "$(dirname "$0")/.." || { echo "无法定位仓库根目录"; exit 2; }

limit_for() {
  local gf; gf=$(grandfather_limit "$1")
  [ -n "$gf" ] && echo "$gf" || echo "$MAX_LINES"
}

# ---- 自检：门禁本身是「fail-open」的闸，回归会静默放行超标文件 ----
if [ "${1:-}" = "--selftest" ]; then
  tmp=$(mktemp -d) || { echo "mktemp 失败"; exit 2; }
  trap 'rm -rf "$tmp"' EXIT
  fails=0
  mk() { yes 'x' | head -n "$1" > "$2"; }
  chk() { # $1=期望退出码 $2=MAX(空=默认) $3=描述 —— 其余=传给本脚本的参数
    local want="$1" maxv="$2" desc="$3"; shift 3
    local got
    if [ -n "$maxv" ]; then MAX_LINES="$maxv" "$0" "$@" >/dev/null 2>&1; else "$0" "$@" >/dev/null 2>&1; fi
    got=$?
    if [ "$got" -ne "$want" ]; then echo "  ✗ 自检失败：${desc}（期望 exit ${want}，实得 ${got}）"; fails=1
    else echo "  ✓ ${desc}"; fi
  }
  mk 10 "$tmp/small.ts"
  mk 999 "$tmp/big.ts"
  mk 999 "$tmp/big.test.ts"
  echo "== 门禁自检 =="
  chk 0 100 "小文件放行"            "$tmp/small.ts"
  chk 1 100 "大文件拦截"            "$tmp/big.ts"
  chk 0 100 "测试文件跳过"          "$tmp/big.test.ts"
  chk 2 100 "--hook 超限返回 2"     --hook "$tmp/big.ts"
  chk 0 100 "--hook 正常返回 0"     --hook "$tmp/small.ts"
  echo ""
  [ "$fails" -eq 0 ] && { echo "结果：✓ 门禁自检通过。"; exit 0; } || { echo "结果：✗ 门禁自身有问题，先修脚本。"; exit 1; }
fi

# ---- 编辑期钩子模式：只看一个文件，静默通过，超限写 stderr 并 exit 2 ----
if [ "${1:-}" = "--hook" ]; then
  f="${2:-}"
  [ -n "$f" ] && [ -f "$f" ] || exit 0
  case "$f" in *.ts|*.tsx) ;; *) exit 0 ;; esac
  is_skipped "$f" && exit 0
  lines=$(wc -l < "$f" | tr -d ' ')
  limit=$(limit_for "$f")
  if [ "$lines" -gt "$limit" ]; then
    echo "⚠ 体量超限：${f} ${lines} 行 > ${limit}。请拆分（抽子组件 + 自定义 hook / 纯逻辑抽独立模块），别放宽阈值。见 CONVENTIONS.md §2。" >&2
    exit 2
  fi
  exit 0
fi

# ---- 全量 / 指定文件 ----
fail=0; warn=0
if [ "$#" -gt 0 ]; then
  SRC=("$@")
else
  SRC=()
  scan_dirs=()
  for d in packages demo; do [ -d "$d" ] && scan_dirs+=("$d"); done
  if [ ${#scan_dirs[@]} -gt 0 ]; then
    while IFS= read -r line; do SRC+=("$line"); done < <(find "${scan_dirs[@]}" \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/node_modules/*" -not -path "*/dist/*" 2>/dev/null | sort)
  fi
fi

echo "== 单文件行数体检（默认上限 ${MAX_LINES}；历史欠账见脚本内 grandfather_limit）=="
if [ ${#SRC[@]} -eq 0 ]; then
  echo "  （没有待检查的 .ts/.tsx 文件——新仓尚未落地代码）"
  echo ""
  echo "结果：✓ 全部通过。"
  exit 0
fi
for f in "${SRC[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in *.ts|*.tsx) ;; *) continue ;; esac
  is_skipped "$f" && continue
  lines=$(wc -l < "$f" | tr -d ' ')
  gf=$(grandfather_limit "$f")
  if [ -n "$gf" ]; then limit=$gf; tag=" [欠账·待拆]"; else limit=$MAX_LINES; tag=""; fi
  if [ "$lines" -gt "$limit" ]; then
    echo "  ✗ FAIL  ${f}  ${lines} 行 > ${limit}${tag}"
    fail=1
  else
    warn_at=$(( limit * WARN_RATIO / 100 ))
    if [ "$lines" -ge "$warn_at" ]; then
      echo "  ⚠ WARN  ${f}  ${lines} 行（≥ ${warn_at}，接近上限 ${limit}）${tag}"
      warn=1
    fi
  fi
done

echo ""
if [ "$fail" -ne 0 ]; then
  echo "结果：✗ 有文件超预算——请拆分（抽子组件 + 自定义 hook / 纯逻辑抽独立模块），不要放宽阈值。见 CONVENTIONS.md §2。"
  exit 1
fi
[ "$warn" -ne 0 ] && echo "结果：✓ 通过（有 WARN——尽早规划拆分，勿等触顶）。" || echo "结果：✓ 全部通过。"
exit 0
