# Lokalny rozwój i workflow (→ Git → VPS)

## Zalecany sposób: pełny stack lokalny = jak bliżej produkcji

1. **Backend (sekrety):** `cp backend/.env.example backend/.env` — uzupełnij wymagane wartości (m.in. `JWT_*`, `ENCRYPTION_KEY` z przykładu; `DATABASE_URL` do Dockera poniżej).
2. **Baza + Redis (Docker z katalogu głównego repozytorium):**  
   `npm run infra:up`
3. **Schemat i dane demo:**  
   `cd backend && npx prisma migrate deploy && npx prisma db seed`
4. **Frontend wskazuje na lokalne API** — w katalogu głównym w `.env` (wzorzec: `.env.example`):  
   - `FV_RESTA_API_URL=http://localhost:3000`  
   - `VITE_USE_MOCK_INVOICES=false`
5. **Jednym poleceniem: API + worker + Vite:**  
   `npm run dev:local`  
   (albo: `npm run dev:stack` — najpierw `infra:up`, potem `dev:all`).

**Logowanie w tym trybie** idzie do Fastify, nie do „udawanego” Vite. Po seed: np. `admin@fvresta.local` / `Admin123!` (patrz `backend` seed).

## Gdy chcesz tylko szybko UI bez backendu

- `npm run dev:web` — ładuje m.in. `.env.web-only` (bez `FV_RESTA_API_URL`), logowanie przez dev middleware Vite + hasło z tego pliku. Dane list mogą być z mocka (`VITE_USE_MOCK_INVOICES`).

Nie łącz w jednym `.env` mylącego mixu: jeśli jest `FV_RESTA_API_URL` wskazujące API, a API nie stoi, dostaniesz 502 przy logowaniu — włącz `dev:local` albo tymczasem `dev:web`.

## Workflow wypuszczania

1. Zmiany w repo, test lokalny (`dev:local` + backend testy według potrzeb).
2. `git` na `main` (lub feature branch + merge, jak u Was przyjęte).  
3. Na **VPS:** w katalogu deployu `git pull`, `cd backend && npm ci && npm run build`, ewentualnie `npx prisma migrate deploy`, restart usług systemd (API + worker). Frontend statyczny: `npm run build` w root + `scripts/deploy-fv-www.sh` jeśli używacie nginx docroot.

Produkcyjne zmienne tylko na serwerze; **nigdy nie commituj** prawdziwych `.env` (są w `.gitignore`).
