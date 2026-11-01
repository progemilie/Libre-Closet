#!/usr/bin/env bash
# Deploy the fork's main branch; the data is copied before the new version starts.
set -euo pipefail
cd /opt/closet
BACKUPS=/srv/closet/backups
STAMP=$(date +%Y%m%d-%H%M%S)
OLD=$(git -C src rev-parse --short HEAD)

git -C src pull --ff-only
NEW=$(git -C src rev-parse --short HEAD)
echo "Deploying $OLD -> $NEW: $(git -C src log -1 --format=%s)"

# Keep the running version as :previous, then build the new one (the app keeps running)
docker image tag libre-closet:current libre-closet:previous 2>/dev/null || true
docker compose build libre-closet

# Stop the app so SQLite is closed, then copy all data
docker compose stop libre-closet
tar -czf "$BACKUPS/data-$STAMP-$OLD.tar.gz" -C /srv/closet data
echo "Backup: $BACKUPS/data-$STAMP-$OLD.tar.gz"

# Start the new version; migrations run now
docker compose up -d --no-build

# Wait until the app answers through Caddy
for i in $(seq 1 30); do
  if curl -fsk --resolve closet.home.arpa:443:127.0.0.1 -o /dev/null https://closet.home.arpa/; then
    echo "OK: $NEW is live"
    ls -1t "$BACKUPS"/data-*.tar.gz | tail -n +6 | xargs -r rm --
    exit 0
  fi
  sleep 2
done
docker compose logs --tail 50 libre-closet
echo "Not answering. Roll back with: ./rollback.sh $BACKUPS/data-$STAMP-$OLD.tar.gz"
exit 1
