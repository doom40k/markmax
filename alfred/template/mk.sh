#!/bin/bash
# markmax Alfred 搜索入口（keyword: mk）
#
# CLI 定位优先级：
#   1. {CLI_PATH} —— install-alfred 安装时注入的绝对路径
#   2. $MARKMAX_CLI 环境变量
#   3. PATH 中的 markmax-sync
#   4. ~/.cargo/bin/markmax-sync
set -u

CLI="{CLI_PATH}"
if [[ "$CLI" != */* ]]; then
  # 占位符未被替换（.alfredworkflow 分发包场景）：动态定位二进制
  if [[ -n "${MARKMAX_CLI:-}" && -x "$MARKMAX_CLI" ]]; then
    CLI="$MARKMAX_CLI"
  elif command -v markmax-sync >/dev/null 2>&1; then
    CLI="$(command -v markmax-sync)"
  elif [[ -x "$HOME/.cargo/bin/markmax-sync" ]]; then
    CLI="$HOME/.cargo/bin/markmax-sync"
  fi
fi

exec "$CLI" search --alfred "$1"
