# FVControl (FV control + Resta)

Monorepo: **React (Vite) dashboard** + **FVControl API** (Fastify) — platforma ingestion / deduplikacja / workflow pod Resta lub standalone.

## Backend + kolejka (lokalnie)

**Najszybciej (z katalogu głównego repozytorium):**

1. Skopiuj env (jeśli jeszcze nie masz): `cp backend/.env.example backend/.env` oraz w katalogu głównym utwórz `.env` z `FV_RESTA_API_URL=http://localhost:3000` i `VITE_USE_MOCK_INVOICES=false` (szablon: [`.env.example`](.env.example)).
2. Baza + Redis: `npm run infra:up` (używa [`docker-compose.yml`](docker-compose.yml) z roota).
3. Migracje i seed (raz): `cd backend && npx prisma migrate deploy && npx prisma db seed`
4. **API + worker + Vite jednym poleceniem:** `npm run dev:all`  
   Albo z podniesieniem Dockera przed startem: `npm run dev:stack`

Skrypty: `dev:backend`, `dev:worker`, `web` = `vite`; `infra:down` zatrzymuje kontenery.

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
