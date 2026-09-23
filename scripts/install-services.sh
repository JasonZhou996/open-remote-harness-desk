#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "$(readlink -f -- "$0")")/.." && pwd)
python3 - "$project_root" <<'PY'
from pathlib import Path
from datetime import datetime
import shutil, sys

root = Path(sys.argv[1])
if any(char.isspace() for char in str(root)) or '%' in str(root):
    raise SystemExit('服务目录不能包含空白或 %；请在不含这些字符的目录安装。')
units = Path.home() / '.config/systemd/user'
backup = Path.home() / '.local/share/ai-webui-backups' / datetime.now().strftime('services-%Y%m%d-%H%M%S-%f')
units.mkdir(parents=True, exist_ok=True)
for name in ('ai-webui.target', 'codex-webui.service', 'claude-bridge.service', 'zcode-local.service', 'codex-webui-tunnel.service', 'codex-webui-lan-publish.service'):
    source = root / 'deploy' / name
    target = units / name
    content = source.read_text().replace('@PROJECT_ROOT@', str(root))
    if target.exists():
        if target.read_text() == content:
            continue
        backup.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, backup / name)
    temp = units / (name + '.new')
    temp.write_text(content)
    temp.replace(target)
if backup.exists(): print('原服务配置已备份：' + str(backup))
PY
systemctl --user daemon-reload
systemctl --user enable ai-webui.target
# Transfer boot ownership without stopping or restarting active services.
systemctl --user disable codex-webui.service claude-bridge.service zcode-local.service codex-webui-tunnel.service codex-webui-lan-publish.service
exec "$project_root/start.sh"
