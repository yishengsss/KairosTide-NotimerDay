#!/usr/bin/env bash
# 一次性环境配置：检查工具、装后端与前端依赖、准备 services/api/.env。完成后用 scripts/start.sh 启动。
#   bash scripts/setup.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="$ROOT/services/api"
WEB="$ROOT/apps/web"

need() { command -v "$1" >/dev/null || { echo "缺少 $1：$2"; exit 1; }; }
need uv      "brew install uv  或  curl -LsSf https://astral.sh/uv/install.sh | sh"
need node    "brew install node"
need npm     "brew install node"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node 需要 20 以上，当前 $(node -v)"; exit 1; }

echo "== 后端依赖（uv sync）"
(cd "$API" && uv sync)

echo "== 前端依赖（npm ci）"
rm -rf "$WEB/node_modules"   # 别的平台装的原生绑定在本机用不了
(cd "$WEB" && { npm ci || npm install; })

# 密钥只放 services/api/.env，不进前端、不进仓库（.gitignore 已忽略）。
if [ ! -f "$API/.env" ]; then
  cp "$API/env.example" "$API/.env"
  echo "== 已从 env.example 生成 services/api/.env"
  printf "输入 MIMO_API_KEY（回车跳过，助手将不可用）："
  read -rs KEY || KEY=""
  echo
  if [ -n "$KEY" ]; then
    tmp="$(mktemp)"
    grep -v '^MIMO_API_KEY=' "$API/.env" > "$tmp" || true
    printf 'MIMO_API_KEY=%s\n' "$KEY" >> "$tmp"
    mv "$tmp" "$API/.env"
    echo "== 密钥已写入 services/api/.env"
  fi
  chmod 600 "$API/.env"
else
  echo "== services/api/.env 已存在，保持不动"
fi

echo
echo "配置完成。启动：bash scripts/start.sh   （带演示数据：bash scripts/start.sh --demo）"
