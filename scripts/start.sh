#!/usr/bin/env bash
# 快速启动：依赖缺失时先跑 setup.sh，再启动 API + 前端（实际启动逻辑在 dev.sh）。
#   bash scripts/start.sh          使用现有数据库
#   bash scripts/start.sh --demo   清空本地库并写入演示事件
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ ! -d "$ROOT/services/api/.venv" ] || [ ! -d "$ROOT/apps/web/node_modules" ]; then
  bash "$ROOT/scripts/setup.sh"
fi
exec bash "$ROOT/scripts/dev.sh" "$@"
