#!/usr/bin/env bash
# workspaceDirs.sh —— 门禁要扫哪些目录：从根 package.json 的 "workspaces" 推出来，**不手写列表**。
#
#   . scripts/lib/workspaceDirs.sh
#   workspace_dirs            # 在当前目录下读 package.json，每行打印一个存在的顶层目录
#
# 为什么不手写：`check-file-size.sh` 与 `check-logging.sh` 原先各自写死了 `packages demo`，
# 后来加了 `demo-react` workspace，两处都没跟上——demo-react 从此不受体量与日志纪律约束，
# 而门禁照样报「全部通过」（09-17 发现）。workspace 清单是唯一真相源，门禁跟着它走。
#
# 只认形如 "packages/*" / "demo" 的简单条目，取第一段路径去重；解析不出任何目录时返回 1，
# 调用方必须当作错误处理——扫描目录为空时「全部通过」正是这类闸门 fail-open 的样子。
# 用 sed 而不是 node：pre-commit 钩子里不想为读一个数组起 node 进程，且要兼容 macOS bash 3.2。

workspace_dirs() {
  [ -f package.json ] || return 1
  local dirs
  dirs=$(sed -n '/"workspaces"[[:space:]]*:[[:space:]]*\[/,/\]/p' package.json \
    | grep -oE '"[^"]+"' \
    | tr -d '"' \
    | grep -v '^workspaces$' \
    | sed 's|/.*$||' \
    | sort -u)
  local found=0 d
  for d in $dirs; do
    [ -d "$d" ] || continue
    echo "$d"
    found=1
  done
  [ "$found" -eq 1 ]
}
