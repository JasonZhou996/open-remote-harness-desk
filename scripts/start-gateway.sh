#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$(readlink -f -- "$0")")/.."
export HOST=0.0.0.0
export PORT=8899 CODEX_WEBUI_NO_AUTH=1
export XARNESS_BUNDLED_CODEX_BIN=/usr/lib/chatgpt/resources/codex
export CODEX_WEBUI_CWD="$HOME"
unset CODEX_WEBUI_PASSWORD
exec "${BUN_BIN:-$HOME/.npm-global/lib/node_modules/@bitkyc08/opencodex/node_modules/bun/bin/bun.exe}" server/gateway/index.ts
