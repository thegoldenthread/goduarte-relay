#!/bin/bash
# Idempotent: safe to run on first boot and after every update.
set -euo pipefail
REPO=/opt/goduarte-relay/repo

id relay >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin relay

# One token per lane, generated here on the server and never committed.
mkdir -p /etc/goduarte-relay
node "$REPO/relay/tokens.mjs" "$REPO/relay/lanes.json" /etc/goduarte-relay/tokens.json
chown root:relay /etc/goduarte-relay/tokens.json
chmod 640 /etc/goduarte-relay/tokens.json
chmod 750 /etc/goduarte-relay && chown root:relay /etc/goduarte-relay

install -m 644 "$REPO/deploy/goduarte-relay.service"        /etc/systemd/system/goduarte-relay.service
install -m 644 "$REPO/deploy/goduarte-relay-update.service" /etc/systemd/system/goduarte-relay-update.service
install -m 644 "$REPO/deploy/goduarte-relay-update.timer"   /etc/systemd/system/goduarte-relay-update.timer
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
install -m 644 "$REPO/deploy/Caddyfile" /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable --now goduarte-relay-update.timer
systemctl enable goduarte-relay
systemctl restart goduarte-relay
systemctl reload caddy || systemctl restart caddy
echo "goduarte-relay: installed $(git -C "$REPO" rev-parse --short HEAD)"
