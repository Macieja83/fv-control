# FVControl (FV control + Resta)

Monorepo: **React (Vite) dashboard** + **FVControl API** (Fastify) — platforma ingestion / deduplikacja / workflow pod Resta lub standalone.

**Workflow:** zmiany lokalnie (zalecane `npm run dev:local` — pełny stack) → commit / push → na VPS `git pull`, `backend` build + ewent. migracje + restart usług; szczegóły: [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md), deploy: [docs/VPS-DEPLOY.md](docs/VPS-DEPLOY.md).

## Backend + kolejka (lokalnie)

**Najszybciej (z katalogu głównego repozytorium):**

1. Skopiuj env: `cp backend/.env.example backend/.env` oraz w katalogu głównym `cp .env.example .env` (dopasuj; szablon: [`.env.example`](.env.example)).
2. Baza + Redis: `npm run infra:up` (katalog główny, [`docker-compose.yml`](docker-compose.yml)).
3. Migracje i seed (raz): `cd backend && npx prisma migrate deploy && npx prisma db seed`
4. **API + worker + Vite:** `npm run dev:local` (albo: `npm run dev:all` gdy DB już działa) — to samo, co dawny `dev:stack`, krótsza nazwa.

**Gdy masz w `.env` wpis `FV_RESTA_API_URL=http://localhost:3000`, ale API nie działa, logowanie zwróci 502** — włącz `npm run dev:local` albo tymczasowo tylko front: `npm run dev:web` (dodaje tryb [`.env.web-only`](.env.web-only) z logowaniem Vite, domyślne hasło w tym pliku: `Admin123!`).

Skrypty: `dev:backend`, `dev:worker`, `web` = `vite`, `dev:web` = front bez API; `infra:down` zatrzymuje kontenery.  
**VPS — pełna instrukcja:** [`docs/VPS-DEPLOY.md`](docs/VPS-DEPLOY.md) (Docker stack, `.env`, nginx, Stripe webhook, checklisty).  
**Pierwsze uruchomienie na VPS:** [`scripts/vps-first-boot.sh`](scripts/vps-first-boot.sh) (tworzy `backend/.env` z szablonu, potem `docker compose`).  
**VPS (nginx + `/var/www/fv-control`):** po `npm run build` uruchom [`./scripts/deploy-fv-www.sh`](./scripts/deploy-fv-www.sh); przykład vhost: [`deploy/nginx-fv-control.example.conf`](deploy/nginx-fv-control.example.conf). Szczegóły systemd: [`backend/docs/deploy-systemd-api-and-worker.md`](backend/docs/deploy-systemd-api-and-worker.md).

Alternatywa — ręcznie z `backend/`:

```bash
cd backend
docker compose up -d postgres redis
npx prisma migrate deploy
npx prisma db seed
```

W dwóch terminalach: `npm run dev` (API :3000) oraz `npm run worker`.

Szczegóły: [`backend/README.md`](backend/README.md), produkcja: [`backend/README-PRODUCTION.md`](backend/README-PRODUCTION.md).

Makefile (z katalogu głównego): `make dev`, `make worker`, `make up`, `make test`, …

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
