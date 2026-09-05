#!/usr/bin/env bash
# check-pack.sh —— **发布前看清包里到底有什么**。
#
#   ./scripts/check-pack.sh            检查两个包
#   ./scripts/check-pack.sh --list     顺带把文件清单打出来
#
# 为什么需要它：`npm publish` 打进去的东西由 `files` 字段决定，而漏写 `files`
# 的后果是**源码、测试、tsconfig 全被发出去**——这件事在本地跑测试是看不出来的，
# 等发现时包已经在别人的 node_modules 里了。
#
# 三条硬规则：
#   1. 必须有 dist/ 产物（否则宿主 import 进来是空的）；
#   2. **不许**有 src/ 或 test/（发布的是产物不是仓库）；
#   3. private:true 的包发不出去，必须显式声明。
set -u

cd "$(dirname "$0")/.." || { echo "无法定位仓库根目录"; exit 2; }

LIST=0
[ "${1:-}" = "--list" ] && LIST=1

failed=0
check_pkg() {
  local dir="$1" name
  name=$(node -p "require('./${dir}/package.json').name")
  echo ""
  echo "── ${name}（${dir}）"

  if [ "$(node -p "require('./${dir}/package.json').private === true")" = "true" ]; then
    echo "  ✗ private:true —— npm publish 会直接拒绝"
    failed=$((failed + 1))
    return
  fi

  local files
  # `npm pack --dry-run` 把清单打到 stderr，所以要 2>&1。
  files=$(cd "${dir}" && npm pack --dry-run --json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        try{ (JSON.parse(s)[0].files||[]).forEach(f=>console.log(f.path)) }catch(e){}
      })')

  if [ -z "$files" ]; then
    echo "  ✗ 拿不到文件清单（先跑一次 npm run build？）"
    failed=$((failed + 1))
    return
  fi

  local count dist bad
  count=$(echo "$files" | wc -l | tr -d ' ')
  dist=$(echo "$files" | grep -c '^dist/' || true)
  # 源码与测试绝不该进包。用 grep -E 一次列全，方便一眼看出漏了哪条规则。
  bad=$(echo "$files" | grep -E '^(src/|test/|tests/)|\.tsbuildinfo$|^tsconfig' || true)

  echo "  文件 ${count} 个，其中 dist/ ${dist} 个"
  [ "$LIST" = "1" ] && echo "$files" | sed 's/^/      /'

  if [ "$dist" -eq 0 ]; then
    echo "  ✗ 包里没有 dist/ —— 宿主 import 进来会是空的"
    failed=$((failed + 1))
  fi
  if [ -n "$bad" ]; then
    echo "  ✗ 这些不该进包（发布的是产物不是仓库）："
    echo "$bad" | sed 's/^/      /'
    failed=$((failed + 1))
  fi
  [ "$dist" -gt 0 ] && [ -z "$bad" ] && echo "  ✓ 干净"
}

echo "== npm 打包体检（npm pack --dry-run）=="
check_pkg packages/call-engine
check_pkg packages/call-uikit-react

echo ""
if [ "$failed" -eq 0 ]; then
  echo "结果：✓ 两个包都干净。"
  exit 0
fi
echo "结果：✗ ${failed} 处问题——见上面。"
exit 1
