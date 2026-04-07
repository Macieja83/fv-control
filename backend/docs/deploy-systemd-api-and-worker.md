# VPS: systemd — API **i** worker (wymagane pod mail → faktury)

Sam proces **`npm run start`** (Fastify) **tylko przyjmuje HTTP** (login, `POST .../sync`, itd.).  
**Nie wykonuje** synchronizacji IMAP ani kroków pipeline na kolejce BullMQ.

Te rzeczy robi **osobny proces**: **`npm run worker:start`** (`node dist/worker.js`) — musi działać **równolegle** z API, z **tym samym** `.env` (`DATABASE_URL`, `REDIS_URL`, `JWT_*`, `ENCRYPTION_KEY`, `BULLMQ_PREFIX`).

Bez workera typowy objaw: **`POST .../sync` zwraca `jobId`**, ale **faktury nie pojawiają się** w UI — joby czekają lub nie są w ogóle przetwarzane.

## Redis — najczęstszy powód „dalej nic nie wpada”

BullMQ **wymaga działającego serwera Redis**. Jeśli na VPS **nie było** żadnego Redis, dopisane `REDIS_URL=redis://127.0.0.1:6379` **nie pomoże**, dopóki **nic nie nasłuchuje na porcie 6379**.

**Z repozytorium** (katalog główny, tam gdzie jest `docker-compose.yml`):

```bash
cd ~/fv-control
docker compose up -d redis
redis-cli -h 127.0.0.1 -p 6379 ping
# oczekiwane: PONG
```

W `backend/.env`:

```env
REDIS_URL=redis://127.0.0.1:6379
```

Potem **restart** API i workera:

```bash
systemctl --user restart fv-control-backend.service
systemctl --user restart fv-control-worker.service
```

Sprawdź:

```bash
curl -sS http://127.0.0.1:3001/api/v1/ready
```

W JSON musi być **`"redis":"ok"`** (jeśli jest `"down"` — worker nie przetworzy kolejki).

## Redis (alternatywy)

Jeśli Redis jest gdzie indziej — dopasuj `REDIS_URL`. API i worker **muszą** wskazywać **ten sam** Redis i ten sam `BULLMQ_PREFIX` (domyślnie `fvcontrol` w kodzie).

## Szybki instalator (jeden skrypt)

Na VPS, w sklonowanym repo:

```bash
cd ~/fv-control/backend
git pull
chmod +x scripts/install-systemd-user-worker.sh
./scripts/install-systemd-user-worker.sh
```

Jeśli backend nie jest w `~/fv-control/backend`:

```bash
BACKEND_DIR=/home/marcin/fv-control/backend ./scripts/install-systemd-user-worker.sh
```

Wymaga: istniejący `.env`, wykonane wcześniej `npm run build` (`dist/worker.js`).

---

## Drugi unit systemd (user) — worker (ręcznie)

Po zbudowaniu backendu (`npm run build`) na serwerze:

```bash
cat > /home/marcin/.config/systemd/user/fv-control-worker.service <<'EOF'
[Unit]
Description=FV Control Worker (BullMQ: pipeline + IMAP sync)
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/marcin/fv-control/backend
EnvironmentFile=/home/marcin/fv-control/backend/.env
ExecStart=/usr/bin/npm run worker:start
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now fv-control-worker.service
systemctl --user status fv-control-worker.service --no-pager -l
```

## `.env` — minimalne dopiski (obok tego co już masz)

Upewnij się, że w `**/home/marcin/fv-control/backend/.env**` jest:

- `REDIS_URL=...` (nie polegaj na domyślnym, jeśli Redis nie jest na `127.0.0.1:6379`)
- opcjonalnie `BULLMQ_PREFIX=fvcontrol` (domyślnie tak jest w kodzie — API i worker **muszą** mieć tę samą wartość)

Po zmianie `.env`:

```bash
systemctl --user restart fv-control-backend.service
systemctl --user restart fv-control-worker.service
```

## Weryfikacja

1. `GET /api/v1/ready` — `redis: ok`, `database: ok`.
2. Oba serwisy **active (running)**.
3. Po `POST .../sync` w logach workera powinny pojawić się ślady przetwarzania (bez błędów połączenia z Redis).

## Uwaga: `postgres` w `DATABASE_URL` na hoście

Jeśli API działa **na hoście** (systemd), a w `DATABASE_URL` jest host **`postgres`**, to zadziała tylko wtedy, gdy ten hostname jest rozwiązywany (np. wpis w `/etc/hosts` albo Docker network — rzadko domyślnie).  
Jeśli Postgres z Compose ma port na hoście, często używa się `127.0.0.1:5432`.

Skrypt diagnostyczny (VPS): `backend/scripts/diagnose-vps-mail-pipeline.sh`.

Powiązane: [runbooks.md](./runbooks.md) (Redis, worker).