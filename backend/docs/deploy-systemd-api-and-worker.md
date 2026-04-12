# VPS: systemd — API **i** worker (wymagane pod mail → faktury)

## Kanon adresów (Resta — zapamiętaj jedną tabelę)

| Gdzie | Co | Uwaga |
|--------|-----|--------|
| **Przeglądarka (produkcja)** | `https://fv.resta.biz` | UI (statyczne pliki z `/var/www/fv-control`). Żądania **`/api/...`** nginx zwykle **proxy** na backend na hoście. |
| **Backend na VPS (loopback)** | `http://127.0.0.1:3000` | Domyślny port z `backend/.env` → **`PORT=3000`** (`backend/src/config.ts`). **`curl` / diagnostyka po SSH** — zawsze ten port, **o ile** w `.env` nie zmienisz `PORT`. |
| **Dev lokalnie** | API `http://localhost:3000`, UI Vite `http://localhost:5173` | Zgodnie z `backend/.env.example` i root `README.md`. |

**Nie używamy `:3001` w dokumentacji tego repozytorium** — to był błędny przykład; produkcyjny VPS Resta nasłuchuje na **`3000`**.

### Checklist: port, nginx, systemd („nic się nie zmienia” po deployu)

Skrypt **`./scripts/deploy-fv-www.sh`** w repozytorium **nie zmienia portu** — tylko synchronizuje zbudowany frontend (`dist/`) do docroot. Backend bierze port z **`backend/.env`** (`PORT`, domyślnie **3000** w `config.ts`) i uruchamia go **`fv-control-backend.service`**.

Na VPS warto zweryfikować:

1. `grep '^PORT=' ~/fv-control/backend/.env` — oczekiwane `PORT=3000` (o ile nie zmienialiście świadomie).
2. `systemctl --user status fv-control-backend.service --no-pager` — `active (running)`; `WorkingDirectory` i `EnvironmentFile` wskazują na **`~/fv-control/backend`** (lub równoważną ścieżkę).
3. `curl -sS http://127.0.0.1:3000/api/v1/ready` — w odpowiedzi `database` i `redis` mają być **`ok`**.
4. Nginx dla `fv.resta.biz`: w `location /api/` powinno być **`proxy_pass http://127.0.0.1:3000;`** (bez sufiksu ścieżki w stylu `/api/v1/`), żeby do Fastify szła **pełna** ścieżka żądania (`/api/v1/...`). Inny port na hoście (np. osobna aplikacja na `:4000`) to **nie** ten backend — nginx musi wskazywać ten sam port co `PORT` w `.env` FV Control.

**Cache przeglądarki:** często włącza się długi cache na **`/assets/*.js`** (`immutable`). Jeśli hash w nazwie pliku nie zmienił się przy kolejnym `npm run build`, przeglądarka może trzymać **stary bundel** JS, mimo że **API** już pochodzi z nowego kodu na serwerze (żądania `fetch('/api/...')` zwykle nie są cache’owane jak statyczne JS). Przy podejrzeniu starego frontu: **twarde odświeżenie** (Ctrl+Shift+R) lub wyczyszczenie cache dla domeny.

Sam proces `**npm run start`** (Fastify) **tylko przyjmuje HTTP** (login, `POST .../sync`, itd.).  
**Nie wykonuje** synchronizacji IMAP ani kroków pipeline na kolejce BullMQ.

Te rzeczy robi **osobny proces**: `**npm run worker:start`** (`node dist/worker.js`) — musi działać **równolegle** z API, z **tym samym** `.env` (`DATABASE_URL`, `REDIS_URL`, `JWT_`*, `ENCRYPTION_KEY`, `BULLMQ_PREFIX`).

Bez workera typowy objaw: `**POST .../sync` zwraca `jobId`**, ale **faktury nie pojawiają się** w UI — joby czekają lub nie są w ogóle przetwarzane.

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
curl -sS http://127.0.0.1:3000/api/v1/ready
```

W JSON musi być `**"redis":"ok"**` (jeśli jest `"down"` — worker nie przetworzy kolejki).

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

### Po wdrożeniu poprawki „brak duplikatów KSeF↔KSeF”

Stare wiersze `invoice_duplicates` (utworzone **przed** poprawką w pipeline) **nie znikają same**. Jednorazowo na VPS, po `git pull` i buildzie backendu:

```bash
cd ~/fv-control/backend
npm run cleanup:ksef-ksef-dups
```

Usuwa tylko pary **OPEN**, gdzie **oba** końce to faktury z repozytorium KSeF (zgodnie z `duplicate-score.ts`). Następnie odświeża compliance dla dotkniętych faktur.

## Uwaga: `postgres` w `DATABASE_URL` na hoście

Jeśli API działa **na hoście** (systemd), a w `DATABASE_URL` jest host `**postgres`**, to zadziała tylko wtedy, gdy ten hostname jest rozwiązywany (np. wpis w `/etc/hosts` albo Docker network — rzadko domyślnie).  
Jeśli Postgres z Compose ma port na hoście, często używa się `127.0.0.1:5432`.

Skrypt diagnostyczny (VPS): `backend/scripts/diagnose-vps-mail-pipeline.sh`.

## Frontend pod **fv.resta.biz** (nginx — `/var/www/fv-control`)

Domena **fv.resta.biz** w nginx ma zwykle `root /var/www/fv-control` — **nie** czyta plików z `~/fv-control/dist`.  
Po **`git pull`** i buildzie frontu w katalogu głównym repozytorium:

```bash
cd ~/fv-control
npm ci
npm run build
chmod +x ./scripts/deploy-fv-www.sh   # raz, jeśli brak bitu wykonywania
./scripts/deploy-fv-www.sh
```

Domyślny cel to `/var/www/fv-control`. Inny katalog: `FV_WWW_ROOT=/ścieżka/do/www ./scripts/deploy-fv-www.sh`.

Powiązane: [runbooks.md](./runbooks.md) (Redis, worker).