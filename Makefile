# FVControl monorepo — convenience targets (backend is source of truth for API).
.PHONY: dev up down migrate seed test lint typecheck

dev:
	cd backend && npm run dev

worker:
	cd backend && npm run worker

up:
	cd backend && docker compose up -d --build

down:
	cd backend && docker compose down

migrate:
	cd backend && npx prisma migrate deploy

migrate-dev:
	cd backend && npx prisma migrate dev

seed:
	cd backend && npx prisma db seed

test:
	cd backend && npm run test

lint:
	cd backend && npm run lint

typecheck:
	cd backend && npx tsc -p tsconfig.build.json --noEmit

prisma-validate:
	cd backend && npx prisma validate
