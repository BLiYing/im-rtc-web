#!/usr/bin/env bash
# pack-sdk.sh —— 把两个 SDK 包「像宿主一样」装进 .sdk-release/<档>/node_modules，
# 给 IMRTC_SDK=local / public 时 vite（demo / demo-react）与 tsc（tsconfig.sdk-*.json）
# 按包的 dist / .d.ts 解析用，而不是别名直接指到 src。
#
#   ./scripts/pack-sdk.sh local     build 两个包 → npm pack → 原样解包进 .sdk-release/local
#   ./scripts/pack-sdk.sh public    从 npm registry 装两个包的当前版本到 .sdk-release/public
#
# **两档都不装 peer 依赖**（react / react-dom）：
#   local  —— 直接解包 tgz，压根不跑 npm install，peer 依赖无从谈起。
#   public —— `npm install --omit=peer`，显式关掉 npm 7+ 起「自动装 peerDependencies」的默认行为。
# 不这么做的后果：.sdk-release/*/node_modules 下会多出一份 react，demo-react 用它时
# 变成两份 React 实例同时活着，报 "Invalid hook call"。
#
# public 档现在会 404 ——两个包还没发布到 npmjs，这是预期的（见下面的报错文案）。
set -eu

cd "$(dirname "$0")/.." || { echo "无法定位仓库根目录"; exit 2; }
REPO_ROOT=$(pwd)

MODE="${1:-}"
case "$MODE" in
  local|public) ;;
  *) echo "用法：$0 local|public" >&2; exit 2 ;;
esac

ENGINE_DIR="packages/call-engine"
UIKIT_DIR="packages/call-uikit-react"
ENGINE_NAME=$(node -p "require('./${ENGINE_DIR}/package.json').name")
UIKIT_NAME=$(node -p "require('./${UIKIT_DIR}/package.json').name")

OUT_DIR="${REPO_ROOT}/.sdk-release/${MODE}"
NM="${OUT_DIR}/node_modules"

rm -rf "$OUT_DIR"
mkdir -p "$NM"

pack_local() {
  echo "== 本地包档：build 两个包 → npm pack → 解包进 ${NM} =="
  # 项目引用保证 engine 先于 uikit 构建（uikit 的类型依赖 engine 的 .d.ts）。
  npx tsc -b "${ENGINE_DIR}" "${UIKIT_DIR}"

  local tgz_dir="${OUT_DIR}/tgz"
  mkdir -p "$tgz_dir"

  local dir name tgz_name extract_dir
  for dir in "${ENGINE_DIR}" "${UIKIT_DIR}"; do
    name=$(node -p "require('./${dir}/package.json').name")
    tgz_name=$(cd "$dir" && npm pack --silent --pack-destination "$tgz_dir")
    extract_dir="${NM}/${name}"
    mkdir -p "$extract_dir"
    # npm pack 的 tgz 顶层固定叫 package/，--strip-components=1 把它剥掉，
    # 落地成 node_modules/<name>/{dist,package.json,...}——和真实 npm install 后
    # 宿主 node_modules 里看到的目录结构一致。全程没有跑 npm install，
    # 所以 package.json 里的 dependencies / peerDependencies 都不会被装进来。
    tar -xzf "${tgz_dir}/${tgz_name}" -C "$extract_dir" --strip-components=1
  done
  echo "  完成：${ENGINE_NAME}、${UIKIT_NAME} → ${NM}"
}

pack_public() {
  echo "== 公网包档：从 npm registry 装 ${ENGINE_NAME} / ${UIKIT_NAME} 到 ${NM} =="
  local engine_version uikit_version
  engine_version=$(node -p "require('./${ENGINE_DIR}/package.json').version")
  uikit_version=$(node -p "require('./${UIKIT_DIR}/package.json').version")

  local log
  log=$(mktemp)
  if npm install \
      --no-save --no-package-lock --omit=peer --omit=dev \
      --prefix "$OUT_DIR" \
      "${ENGINE_NAME}@${engine_version}" "${UIKIT_NAME}@${uikit_version}" \
      >"$log" 2>&1; then
    echo "  完成：${ENGINE_NAME}@${engine_version}、${UIKIT_NAME}@${uikit_version} → ${NM}"
    rm -f "$log"
    return 0
  fi

  echo ""
  if grep -qiE '404|E404|not found' "$log"; then
    echo "  ✗ 公网还没有这两个包（预期中的失败——${ENGINE_NAME} / ${UIKIT_NAME} 尚未发布到 npmjs）。"
    echo "    发布后这一档才会成功；发布前想验证，用 ./scripts/pack-sdk.sh local。"
  else
    echo "  ✗ npm install 失败，原始输出："
    sed 's/^/    /' "$log"
  fi
  rm -f "$log"
  return 1
}

case "$MODE" in
  local)  pack_local ;;
  public) pack_public ;;
esac
