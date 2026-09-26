#!/bin/bash
# Runs every 5 minutes. Applies new commits on main; does nothing otherwise.
set -euo pipefail
cd /opt/goduarte-relay/repo
git fetch --quiet origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  git reset --quiet --hard origin/main
  echo "goduarte-relay: updating to $(git rev-parse --short HEAD)"
  bash deploy/install.sh
fi
