#!/usr/bin/env bash
# Uruchom NA SERWERZE (SSH), jako ten sam user co fv-control-backend (np. marcin).
# Nie uruchamiaj z Windows — tylko bash na VPS.
#
#   chmod +x install-systemd-user-worker.sh
#   ./install-systemd-user-worker.sh
#
# Opcjonalnie: BACKEND_DIR=/ścieżka/do/backend ./install-systemd-user-worker.sh

set -euo pipefail

BACKEND_DIR="${BACKEND_DIR:-$HOME/fv-control/backend}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_NAME="fv-control-worker.service"

if [[ ! -d "$BACKEND_DIR" ]]; then
  echo "ERROR: Katalog backendu nie istnieje: $BACKEND_DIR"
  echo "Ustaw: export BACKEND_DIR=/pełna/ścieżka/do/backend && $0"
  exit 1
fi

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  echo "ERROR: Brak $BACKEND_DIR/.env — utwórz najpierw .env (jak dla API)."
  exit 1
fi

if [[ ! -f "$BACKEND_DIR/dist/worker.js" ]]; then
  echo "ERROR: Brak $BACKEND_DIR/dist/worker.js — w katalogu backendu uruchom: npm run build"
  exit 1
fi

if ! grep -q '^REDIS_URL=' "$BACKEND_DIR/.env"; then
  echo "INFO: Brak REDIS_URL w .env — dopisuję REDIS_URL=redis://127.0.0.1:6379"
  echo "      (jeśli Redis jest gdzie indziej, popraw ręcznie w .env i: systemctl --user restart $UNIT_NAME)"
  echo "" >> "$BACKEND_DIR/.env"
  echo "REDIS_URL=redis://127.0.0.1:6379" >> "$BACKEND_DIR/.env"
fi

mkdir -p "$UNIT_DIR"

# shellcheck disable=SC2094
cat > "$UNIT_DIR/$UNIT_NAME" <<EOF
[Unit]
Description=FV Control Worker (BullMQ: pipeline + IMAP sync)
After=network.target

[Service]
Type=simple
WorkingDirectory=$BACKEND_DIR
EnvironmentFile=$BACKEND_DIR/.env
ExecStart=/usr/bin/npm run worker:start
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"

echo ""
echo "=== status $UNIT_NAME ==="
systemctl --user status "$UNIT_NAME" --no-pager -l || true

echo ""
echo "Ostatnie logi (Ctrl+C aby wyjść z follow — opcjonalnie):"
echo "  journalctl --user -u $UNIT_NAME -f"
echo ""
echo "Sprawdź API:"
echo "  curl -sS \"\${FV_API:-http://127.0.0.1:3001}/api/v1/ready\""
