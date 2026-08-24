#!/bin/bash
# markmax Alfred 新增入口（keyword: mka）
#
# 流程：
#   1. 探测前台应用；仅支持 Chrome / Edge / Brave / Safari，否则提示无效（不做兜底）
#   2. osascript 取活动标签页的 URL 与标题
#   3. 读缓存目录 folders.json 列出已有文件夹供选择（不选即存为未分类）
#   4. 回车经 action.sh 调用 markmax-sync add 写入本机缓存，daemon 自动同步
set -euo pipefail

# Alfred 脚本环境的 locale 不可控：兜底设置，避免多字节字符解析异常
export LANG="${LANG:-en_US.UTF-8}"

# ---------- 定位 CLI（同 mk.sh） ----------
locate_cli() {
  local cli="{CLI_PATH}"
  if [[ "$cli" == */* ]]; then
    echo "$cli"
    return
  fi
  if [[ -n "${MARKMAX_CLI:-}" && -x "$MARKMAX_CLI" ]]; then
    echo "$MARKMAX_CLI"
  elif command -v markmax-sync >/dev/null 2>&1; then
    command -v markmax-sync
  elif [[ -x "$HOME/.cargo/bin/markmax-sync" ]]; then
    echo "$HOME/.cargo/bin/markmax-sync"
  else
    echo ""
  fi
}

# ---------- JSON 最小转义：反斜杠/双引号转义，剔除换行/回车/制表符 ----------
jesc() {
  local s="${1//$'\\'/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/ }"
  s="${s//$'\r'/ }"
  s="${s//$'\t'/ }"
  printf '%s' "$s"
}

err_item() {
  printf '{"items":[{"title":"%s","subtitle":"%s","valid":false}]}' "$(jesc "$1")" "$(jesc "${2:-}")"
}

CLI="$(locate_cli)"
if [[ -z "$CLI" ]]; then
  err_item "未找到 markmax-sync" "请先安装 CLI：cargo install --path cli（或设置 MARKMAX_CLI 环境变量）"
  exit 0
fi

# ---------- 前台探测 ----------
front=$(osascript -e 'tell application "System Events" to get name of first process whose frontmost is true' 2>/dev/null) || front=""

case "$front" in
  "Google Chrome")
    script='tell application "Google Chrome" to tell active tab of front window to return URL & linefeed & title'
    ;;
  "Microsoft Edge")
    script='tell application "Microsoft Edge" to tell active tab of front window to return URL & linefeed & title'
    ;;
  "Brave Browser")
    script='tell application "Brave Browser" to tell active tab of front window to return URL & linefeed & title'
    ;;
  "Safari")
    script='tell application "Safari" to tell front document to return URL & linefeed & name'
    ;;
  *)
    err_item "请在要收藏的浏览器中触发 mka" "支持 Chrome、Edge、Brave、Safari；当前前台：${front:-未知}"
    exit 0
    ;;
esac

out=$(osascript -e "$script" 2>&1) || {
  msg="无法获取标签页"
  case "$out" in
    *-1743*|*"Not authorized"*)
      msg="自动化授权被拒绝，请在 系统设置 → 隐私与安全性 → 自动化 中允许 Alfred 控制该浏览器"
      ;;
  esac
  err_item "$msg" "$out"
  exit 0
}

url="${out%%$'\n'*}"
title="${out#*$'\n'}"

# ---------- 缓存目录与文件夹列表 ----------
cfg="$HOME/.markmax/markmax-config.json"
cache_dir=$(sed -n 's/.*"cache_dir"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$cfg" 2>/dev/null | head -1)
[[ -z "$cache_dir" ]] && cache_dir="$HOME/.markmax"

esc_url=$(jesc "$url")
esc_title=$(jesc "$title")
S='\u001f'

item() { # $1=显示标题 $2=副标题 $3=arg(JSON 转义已就绪)
  printf '{"title":"%s","subtitle":"%s","arg":"%s","valid":true},' "$(jesc "$1")" "$(jesc "$2")" "$3"
}

items="$(item "添加「${esc_title}」" "${esc_url} ↩ 存为未分类" "add${S}${esc_url}${S}${esc_title}${S}")"

folders_file="$cache_dir/folders.json"
if [[ ! -f "$folders_file" ]]; then
  items+="$(item "暂无文件夹记录" "启动 markmax-sync 同步一次后自动生成" "")"
else
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    esc_f=$(jesc "$f")
    items+="$(item "保存到「${esc_f}」" "${f} ↩ 选择此文件夹" "add${S}${esc_url}${S}${esc_title}${S}${esc_f}")"
  done < <(sed -n 's/^[[:space:]]*"\(.*\)",\{0,1\}$/\1/p' "$folders_file")
fi

printf '{"items":[%s]}' "${items%,}"
