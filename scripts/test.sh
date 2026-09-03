#!/usr/bin/env bash
# test.sh —— 本仓唯一测试入口。全绿才能说「完成」（CONVENTIONS.md §9 / CLAUDE.md「完成的定义」）。
#
#   ./scripts/test.sh                    全量
#   RTC_CONFORMANCE_DIR=... ./scripts/test.sh   指定一致性向量目录
#
# 步骤顺序是有意的：先跑最便宜的体量门禁，再类型检查，最后跑测试——
# 让「文件长到 500 行」这种问题在两秒内暴露，而不是等 vitest 跑完。
set -u

cd "$(dirname "$0")/.." || { echo "无法定位仓库根目录"; exit 2; }

failed=()
step_no=0

run_step() {
  local name="$1"; shift
  step_no=$((step_no + 1))
  echo ""
  echo "──[$step_no] $name ──────────────────────────────"
  if "$@"; then
    echo "  ✓ $name"
  else
    echo "  ✗ $name"
    failed+=("$name")
    return 1
  fi
  return 0
}

ensure_deps() {
  if [ ! -d node_modules ]; then
    echo "  node_modules 不在，先装依赖…"
    npm install --no-audit --no-fund || return 1
  fi
  echo "  依赖就绪"
  return 0
}

# 一致性向量在 im-rtc-server 仓里，**本仓只读引用，不拷贝**。
# 找不到时明确报错而不是跳过——被静默跳过的一致性测试比没有测试更糟。
check_conformance_available() {
  local dir="${RTC_CONFORMANCE_DIR:-../im-rtc-server/docs/conformance}"
  if [ -d "$dir" ]; then
    echo "  向量目录：$dir"
    return 0
  fi
  echo "  ✗ 找不到一致性向量目录：$dir"
  echo "    把 im-rtc-server 克隆到本仓同级，或设 RTC_CONFORMANCE_DIR。"
  echo "    **不要拷贝一份向量到本仓**——一拷贝就会漏同步。"
  return 1
}

echo "== im-rtc-web 全量回归 =="

run_step "依赖" ensure_deps
run_step "单文件体量门禁" ./scripts/check-file-size.sh
run_step "日志纪律门禁" ./scripts/check-logging.sh
# 闸门自己回归成 fail-open 会静默放行，所以每次回归都自检一次。
run_step "门禁自检" ./scripts/check-logging.sh --selftest
run_step "一致性向量可达" check_conformance_available
run_step "TypeScript 类型检查" npx tsc -b
run_step "Demo 类型检查（自画 UI）" npx tsc --noEmit -p demo
run_step "Demo 类型检查（引 uikit）" npx tsc --noEmit -p demo-react
run_step "vitest（engine）" npx vitest run --root packages/call-engine
# uikit 单独一步：它跑在 jsdom 上，而 engine **必须**能在无 DOM 的 node 里跑通
# （CONVENTIONS §1）。合成一步就等于把 engine 也放进 jsdom，那条约束就没人守了。
run_step "vitest（uikit）" npx vitest run --root packages/call-uikit-react

echo ""
echo "════════════════════════════════════════════════"
if [ ${#failed[@]} -eq 0 ]; then
  echo "结果：✓ 全绿（$step_no 步）"
  exit 0
fi
echo "结果：✗ ${#failed[@]} 步失败："
printf '  · %s\n' "${failed[@]}"
exit 1
