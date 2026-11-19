#!/usr/bin/env bash
# 前台进程入口：交给 supervisor / 平台托管，不要自行 daemonize。
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data/uploads logs
export NODE_ENV="${NODE_ENV:-production}"

# 项目需要 Node >= 22（src/config.js 使用 import.meta.dirname）。
# Pod 重建后 PATH 可能先命中系统自带的 Node 18，因此不能直接用 `command -v node`，
# 必须按版本挑选。
pick_node() {
  local candidates=()
  [ -n "${NODE_BIN:-}" ] && candidates+=("$NODE_BIN")
  candidates+=("/home/cloud/.nvm/versions/node/v22.23.5/bin/node")
  local p
  for p in /home/cloud/.nvm/versions/node/*/bin/node; do
    [ -x "$p" ] && candidates+=("$p")
  done
  p="$(command -v node 2>/dev/null || true)"
  [ -n "$p" ] && candidates+=("$p")

  local major
  for p in "${candidates[@]}"; do
    [ -n "$p" ] && [ -x "$p" ] || continue
    major="$("$p" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "${major:-0}" -ge 22 ]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

if ! NODE_BIN="$(pick_node)"; then
  echo "启动失败：需要 Node.js >= 22；PATH 中的 node 是 $(command -v node || echo '不存在')" >&2
  exit 1
fi
echo "using node: $NODE_BIN ($("$NODE_BIN" -v))"

exec "$NODE_BIN" --no-warnings server.js