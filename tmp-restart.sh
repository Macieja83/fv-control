#!/bin/bash
set -e

pkill -f 'node dist/index.js' 2>/dev/null || true
pkill -f 'node dist/worker.js' 2>/dev/null || true
sleep 1

cd /opt/fv-control/backend
nohup node dist/index.js > /tmp/fv-api.log 2>&1 &
nohup node dist/worker.js > /tmp/fv-worker.log 2>&1 &
sleep 3

echo "=== PROCESSES ==="
pgrep -af 'node dist/' | grep -v tailscale | grep -v bash || true

echo "=== WORKER LOG ==="
tail -10 /tmp/fv-worker.log

echo "=== API LOG ==="
tail -5 /tmp/fv-api.log
