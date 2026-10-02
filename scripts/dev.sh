#!/usr/bin/env bash
# 一键本地运行：API (127.0.0.1:8000) + 首页 dev server (http://localhost:5173)。Ctrl+C 一起停。
#   bash scripts/dev.sh          使用现有数据库
#   bash scripts/dev.sh --demo   清空本地库并写入两条演示事件（一条 4 分钟后开始，一条进行中）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="$ROOT/services/api"
WEB="$ROOT/apps/web"

command -v uv  >/dev/null || { echo "缺少 uv：brew install uv"; exit 1; }
command -v npm >/dev/null || { echo "缺少 Node/npm：brew install node"; exit 1; }

# 密钥只在 services/api/.env 里。只把该文件导进 API 进程环境，绝不进前端。
if [ -f "$API/.env" ]; then
  echo "== 载入 services/api/.env"
  set -a
  # shellcheck disable=SC1091
  . "$API/.env"
  set +a
else
  echo "== 没有 services/api/.env：助手不可用，其余功能正常"
fi

# node_modules 若是在别的系统（如 Linux 沙箱）装的，原生绑定不匹配本机，重新安装。
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  NEED=darwin-arm64 ;;
  Darwin-x86_64) NEED=darwin-x64 ;;
  *)             NEED="" ;;
esac
if [ ! -d "$WEB/node_modules" ] || { [ -n "$NEED" ] && [ ! -d "$WEB/node_modules/@rolldown/binding-$NEED" ]; }; then
  echo "== 安装前端依赖（本机平台 ${NEED}）"
  rm -rf "$WEB/node_modules"
  (cd "$WEB" && npm install)
fi

if [ "${1:-}" = "--demo" ]; then
  echo "== 写入演示事件"
  mkdir -p "$API/var" && rm -f "$API/var/kairos.sqlite3"*
  (cd "$API" && uv run kairos-dev seed --in=4m  --minutes 30 --title 高数课   --location "教三 204")
  (cd "$API" && uv run kairos-dev seed --in=-5m --minutes 40 --title 英语早读 --location 图书馆)
fi

cleanup() { kill "$API_PID" "$WEB_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd "$API" && uv run kairos-api) &
API_PID=$!
(cd "$WEB" && npm run dev) &
WEB_PID=$!

for _ in $(seq 1 60); do
  curl -s -o /dev/null http://127.0.0.1:8000/api/v1/health && curl -s -o /dev/null http://localhost:5173/ && break
  sleep 0.5
done
echo
echo "== 已启动：首页 http://localhost:5173   预览 http://localhost:5173/preview.html   Ctrl+C 停止"
command -v open >/dev/null && open http://localhost:5173/ || true
wait
