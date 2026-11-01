#!/usr/bin/env bash
# Restore a data backup and the previous app version.
set -euo pipefail
cd /opt/closet
BACKUP=${1:?usage: ./rollback.sh /srv/closet/backups/data-<stamp>-<commit>.tar.gz}
docker compose stop libre-closet
mv /srv/closet/data "/srv/closet/data.failed-$(date +%Y%m%d-%H%M%S)"
tar -xzf "$BACKUP" -C /srv/closet
docker image tag libre-closet:previous libre-closet:current
docker compose up -d --no-build
echo "Rolled back. The failed data folder is kept next to /srv/closet/data."
