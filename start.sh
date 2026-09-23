#!/usr/bin/env bash
set -euo pipefail
case "${1:-start}" in
  start|stop|restart) exec systemctl --user "${1:-start}" ai-webui.target ;;
  status) exec systemctl --user --no-pager status ai-webui.target codex-webui.service claude-bridge.service zcode-local.service codex-webui-tunnel.service codex-webui-lan-publish.service ;;
  logs) exec journalctl --user -f -u codex-webui.service -u claude-bridge.service -u zcode-local.service ;;
  *) printf '用法：%s [start|stop|restart|status|logs]\n' "$0" >&2; exit 2 ;;
esac
