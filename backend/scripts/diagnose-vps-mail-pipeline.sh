#!/usr/bin/env bash
# Diagnostyka na VPS: Redis, /ready, status usług user systemd.
#   chmod +x diagnose-vps-mail-pipeline.sh && ./diagnose-vps-mail-pipeline.sh
# Opcja: FV_API=https://fv.resta.biz ./diagnose-vps-mail-pipeline.sh

set -euo pipefail
API="${FV_API:-http://127.0.0.1:3001}"

echo "=== 1) Redis na localhost:6379 ==="
if command -v redis-cli >/dev/null 2>&1; then
  redis-cli -h 127.0.0.1 -p 6379 ping || echo "BŁĄD: brak PONG — uruchom: cd ~/fv-control && docker compose up -d redis"
else
  echo "brak redis-cli; sprawdź ręcznie: docker compose up -d redis (port 6379)"
fi

echo ""
echo "=== 2) GET $API/api/v1/ready ==="
curl -sS "$API/api/v1/ready" || echo "BŁĄD: API nie odpowiada (nginx / port / firewall)"

echo ""
echo "=== 3) systemd --user (backend + worker) ==="
systemctl --user is-active fv-control-backend.service 2>/dev/null || echo "fv-control-backend: ?"
systemctl --user is-active fv-control-worker.service 2>/dev/null || echo "fv-control-worker: ?"

echo ""
echo "=== 4) Ostatnie logi workera (20 linii) ==="
journalctl --user -u fv-control-worker.service -n 20 --no-pager 2>/dev/null || echo "brak journalctl / brak usługi"

echo ""
echo "Jeśli ready pokazuje redis: down → REDIS_URL + działający Redis."
echo "Jeśli redis ok, a faktur brak → journalctl workera + nowy mail PDF + POST .../sync."
