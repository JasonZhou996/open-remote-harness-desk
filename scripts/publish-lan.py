#!/usr/bin/env python3
"""Publish LAN discovery to the configured host on network changes."""
import ipaddress
import os
import re
import selectors
import subprocess
import sys
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

PUBLISH = """set -eu
install -d -m 755 /var/lib/codex-webui
lan_tmp=$(mktemp /var/lib/codex-webui/.lan-discovery.XXXXXX)
trap 'rm -f "$lan_tmp"' EXIT
cat > "$lan_tmp"
chmod 644 "$lan_tmp"
mv -f "$lan_tmp" /var/lib/codex-webui/lan-discovery.properties
"""


def snapshot():
    with build_opener(ProxyHandler({})).open("http://127.0.0.1:8899/api/auth/status", timeout=3) as response:
        server_id = response.headers.get("x-codex-server-id", "")
        lan_url = response.headers.get("x-codex-lan-url", "")
    address = urlsplit(lan_url)
    private = (ipaddress.ip_network("10.0.0.0/8"), ipaddress.ip_network("172.16.0.0/12"),
               ipaddress.ip_network("192.168.0.0/16"))
    if (not re.fullmatch(r"[A-Za-z0-9-]{1,128}", server_id)
            or address.scheme != "http" or address.port != 8899
            or address.username or address.password or address.query or address.fragment
            or address.path not in ("", "/")
            or not any(ipaddress.ip_address(address.hostname) in subnet for subnet in private)):
        raise ValueError("No valid LAN address advertised by WebUI")
    return f"serverId={server_id}\nlanUrl={lan_url}\n".encode()


def publish(payload):
    target = os.environ["ORHD_TUNNEL_TARGET"]
    key = os.environ["ORHD_TUNNEL_KEY"]
    port = os.environ["ORHD_TUNNEL_PORT"]
    ssh = ["/usr/bin/ssh", "-i", key, "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-p", port, target]
    subprocess.run(ssh + [PUBLISH], input=payload, check=True, timeout=15, stdout=subprocess.DEVNULL)


def main():
    if "--once" in sys.argv:
        publish(snapshot())
        print("LAN discovery published", flush=True)
        return
    # No idle polling: ip monitor wakes on network changes; failures retry until reported.
    with subprocess.Popen(["/usr/sbin/ip", "-4", "monitor", "address", "link", "route"], stdout=subprocess.PIPE) as monitor:
        selector = selectors.DefaultSelector()
        selector.register(monitor.stdout, selectors.EVENT_READ)
        last = None
        while True:
            retry = None
            try:
                payload = snapshot()
                if payload != last:
                    publish(payload)
                    last = payload
                    print("LAN discovery updated", flush=True)
            except Exception as error:
                print(f"LAN report pending: {error}", file=sys.stderr, flush=True)
                retry = 5
            if selector.select(retry) and not os.read(monitor.stdout.fileno(), 65536):
                raise RuntimeError("Network monitor exited")


if __name__ == "__main__":
    main()
