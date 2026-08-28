# Engineering Resource Planner

Production-grade planning platform for engineering teams: projects, task pyramids with dependencies, skills, availability, automatic scheduling, conflict detection and version snapshots.

## Stack

| Layer    | Tech |
|----------|------|
| Frontend | React 18 + TypeScript + Vite (single-page app) |
| Backend  | Node.js + Fastify 5 + TypeScript |
| Database | PostgreSQL 16 + Prisma 5 |
| Auth     | Session cookie (`erp_session`, httpOnly) + Argon2id, rate-limited login |
| Tests    | Vitest (unit + integration), Playwright (e2e) |
| Deploy   | Docker + docker-compose, optional nginx TLS reverse proxy |

## Architecture

```
apps/web     React SPA (builds to apps/web/dist)
apps/server  Fastify API + static file server (serves apps/web/dist in production)
             Prisma models + seed (prisma/seed.ts) + migration (prisma/migrations)
infra        nginx TLS config + cert scripts, docker entrypoint helpers
```

The API is served under the `/api` prefix (`/api/auth/login`, `/api/planner/generate`, ...) and the health check lives at `/health`. In development Vite proxies `/api` to the backend; in production the backend serves both the API and the built SPA on one origin.

## Quick start (development)

Requirements: Node.js 20+, PostgreSQL 16 running locally.

```bash
npm install

# create the erp database, then:
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/erp?schema=public"   # PowerShell
npm run db:push
npm run db:seed

npm run dev          # backend on :4000, web app on :5173
```

Open http://localhost:5173 and sign in (credentials below).

## Demo credentials

Password for every account: `<login>-Erp-2026!`

| Login | Role |
|-------|------|
| `pm` | Project Manager |
| `a1`, `a2` | Specialist A |
| `b1` | Specialist B |
| `c1` | Specialist C |
| `e1` | Specialist E |
| `s1`, `s2`, `s3` | Specialist S |
| `p1`, `p2`, `p3` | Specialist P |

## Features

**Project Manager (`pm`)**
- Dashboard with project/task/conflict statistics, team-load table (incl. planned utilization) and one-click plan generation.
- Projects: create, edit, soft-delete, budget vs. estimated hours.
- Task pyramid: rows describe dependency order; dependencies are derived from the pyramid (sole source of truth). Task codes `XX-XX-X.XXXXXX` auto-maintain row/segment codes and a stable number per project.
- Tasks: CRUD, skill requirement, hours, status transitions (incl. PM-only reopen of `DONE`), assignments to specialists, task deadline.
- Team: manage specialists (add/modify/delete), competence selection.
- Planner: automatic scheduling across specialists by daily free capacity (only working days, weekend-free, Polish holidays). Manual (locked) entries are never modified; regeneration is idempotent (replaces auto entries, keeps locked ones).
- Kanban: per-project boards (To do / On hold / Work in progress / Done) with drag & drop; each specialist manages their own task status independently; specialists can only move their own boxes.
- Gantt: task bars per specialist with per-day boxes; box thickness reflects hours, orange = manual, blue = auto.
- Workload: per-specialist rows with per-project subrows and per-day boxes (same colors as Gantt).
- Conflicts: project deadline, project budget, unused budget, project schedule not satisfied, no available employee, dependency violation, employee overload, task deadline, pyramid row order.
- Versions: one immutable snapshot per business day (Europe/Warsaw), updated in place; view snapshots and print to PDF.
- Admin: reset database to seed, wipe all business data.

**Specialists (`a1`…`p3`)**
- My Tasks: own assignments only, status transitions (with hours worked), hours estimated/planned/available.
- Availability: edit own availability; missing days default to 8h.
- Kanban, Gantt and Workload views available (read-only or restricted to own boxes).

## Rules implemented

- Missing availability for a day = 8 hours; weekends/holidays have 0.
- A project must finish **exactly 3 working days before its deadline**; the workload is stretched to fill the window and specialists work at least 3 hours per day (the project start is postponed if needed).
- An **unused budget** conflict is reported when a project's planned hours are below its budget.
- A **project schedule not satisfied** conflict is reported when a project has no work planned up to 3 working days before its deadline.
- `DONE` and `ON_HOLD` tasks are excluded from automatic planning.
- Manual (locked) assignments are shown in **orange**; auto-generated assignments in **blue** (Planner, Gantt, Workload).
- Soft delete everywhere; audit log records key changes.

## Tests

```bash
npm run test            # server unit tests (72)
npm run test:integration # server integration tests (20) - uses erp_test database
npm run test:e2e        # Playwright smoke tests (5) - builds server, provisions erp_test, starts test servers
npm run typecheck
```

## Docker (single container, server + web)

```bash
docker compose up --build
```

The entrypoint waits for Postgres, applies `prisma migrate deploy`, seeds the database if it is empty, and starts the server. The app is available at http://localhost:4000.

Create a fresh database and reset to seed data:

```bash
docker compose exec server sh /seed-if-empty.js   # reseed only when empty
```

## HTTPS with nginx

The compose file exposes the app over HTTP on `:4000`. To serve it behind TLS:

1. Generate a self-signed certificate (or use certbot for a real domain):
   - Linux/macOS: `bash infra/nginx/generate-certs.sh`
   - Windows: `powershell -File infra/nginx/generate-certs.ps1`
2. Run an nginx container with `infra/nginx/nginx.conf` mounted at `/etc/nginx/nginx.conf` and `infra/nginx/certs` at `/etc/nginx/certs`, attached to the compose network.
3. Set `COOKIE_SECURE=true` on the `server` service so the session cookie is only sent over HTTPS.

## Environment variables (server)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/erp?schema=public` | PostgreSQL connection string |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Listen address |
| `COOKIE_SECRET` | `insecure-local-secret` | Cookie signing secret (set a strong value in production) |
| `COOKIE_SECURE` | auto (true in production) | Mark session cookie Secure |
| `SESSION_TTL_HOURS` | `12` | Session lifetime |
| `AUTH_RATE_LIMIT_MAX` | `20` | Max login attempts per IP per window |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window |
| `TRUST_PROXY` | `1` | Trust proxy hops (needed behind nginx) |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |