#!/bin/bash
# markmax 动作分发：解析 Alfred 传入的 arg（\x1f 分隔）并执行
#   open\x1f<url>                              → 打开链接
#   copy\x1f<url>                              → 复制链接
#   add\x1f<url>\x1f<title>\x1f[<folder>]     → 经 CLI 写入缓存（daemon 自动同步）
#
# add 成功时把标题写到 stdout，作为下游 Post Notification 的 {query}
# （Alfred 通知自带 workflow 图标）；open/copy 无输出则不触发通知。
set -euo pipefail

CLI="{CLI_PATH}"
if [[ "$CLI" != */* ]]; then
  if [[ -n "${MARKMAX_CLI:-}" && -x "$MARKMAX_CLI" ]]; then
    CLI="$MARKMAX_CLI"
  elif command -v markmax-sync >/dev/null 2>&1; then
    CLI="$(command -v markmax-sync)"
  elif [[ -x "$HOME/.cargo/bin/markmax-sync" ]]; then
    CLI="$HOME/.cargo/bin/markmax-sync"
  fi
fi

IFS=$'\x1f' read -r action url title folder <<<"${1:-}"

case "$action" in
  open)
    exec open "$url"
    ;;
  copy)
    printf '%s' "$url" | pbcopy
    ;;
  add)
    args=(add --url "$url")
    [[ -n "${title:-}" ]] && args+=(--title "$title")
    [[ -n "${folder:-}" ]] && args+=(--folder "$folder")
    # 不再用 CLI 内置的 osascript 通知（图标是 Script Editor 的），
    # 改由下游 Alfred Post Notification 展示（带项目图标）。
    "$CLI" "${args[@]}" >/dev/null
    printf '%s' "${title:-$url}"
    ;;
esac
