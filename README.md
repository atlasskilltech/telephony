# AI-Powered ATLAS Telephony & Cloud Telephony System

A production-grade admission management platform for university admission teams:
lead ingestion (Excel/CSV/API/website/Facebook), automatic counselor assignment,
cloud telephony (click-to-call + recording), AI transcription & call analysis
(Whisper + GPT), a real-time web dashboard and a versioned mobile REST API.

> **Status:** This repository contains a fully wired, runnable backend + web
> dashboard foundation. Every module in the architecture is implemented with
> real (non-placeholder) code following a clean **repository → service →
> controller** layering. See [Implementation status](#implementation-status)
> for exactly what is built end-to-end vs. stubbed for external providers.

---

## Tech stack

| Layer        | Technology |
|--------------|-----------|
| Runtime      | Node.js 22 LTS, Express.js |
| Database     | MySQL 8 + Sequelize ORM (migrations & seeders) |
| Cache/Queue  | Redis + BullMQ |
| Realtime     | Socket.IO |
| Auth         | JWT access + rotating refresh tokens, RBAC |
| Frontend     | EJS + Tailwind CSS + Alpine.js + Chart.js |
| AI           | OpenAI Whisper (transcription) + GPT (analysis/QA) |
| Storage      | AWS S3 with local-disk fallback |
| Telephony    | Exotel adapter (+ pluggable Knowlarity/MyOperator/Ozonetel) |
| DevOps       | Docker, Docker Compose, Nginx, PM2, GitHub Actions |

---

## Architecture

```
src/
├── config/          App config, Sequelize, Redis connections
├── models/          25 Sequelize models + associations (auto-loaded)
├── migrations/      Full schema migration
├── seeders/         Roles, permission matrix, statuses, sources, super admin
├── middlewares/     auth, RBAC, rate-limit, validation, audit, errors
├── repositories/    Data-access layer (repository pattern)
├── services/        Business logic (auth, leads, telephony, AI, reports…)
│   └── telephony/   Provider abstraction (BaseProvider + Exotel)
├── controllers/     HTTP handlers (thin)
├── routes/
│   ├── api/v1/       Versioned mobile/web REST API
│   └── web/          Server-rendered dashboard routes
├── queues/          BullMQ producers, worker process, job processors, scheduler
├── sockets/         JWT-authenticated Socket.IO server
├── utils/           logger, ApiError, token, constants, helpers
├── app.js           Express app (security, parsing, routing)
└── server.js        HTTP + Socket.IO bootstrap
views/               EJS pages, layouts, partials (Tailwind UI)
public/              Client JS (API client, Alpine components, charts)
```

The **call AI pipeline** is fully event-driven:

```
Telephony webhook ──▶ CallLog updated ──▶ CallRecording created
        │
        └─▶ transcription queue ─▶ download + archive to S3/local
                                  ─▶ Whisper transcript saved
                                  ─▶ analysis queue ─▶ GPT analysis + QA scorecard
                                                     ─▶ AI scores rolled up onto the Lead
```

---

## Quick start (local, no Docker)

Docker is entirely optional — the app runs directly on any host with Node,
MySQL and Redis installed. Every table is namespaced with the `telephony_`
prefix (configurable via `DB_TABLE_PREFIX`), so the schema can safely live in a
shared/existing database.

### Prerequisites
- Node.js ≥ 20 (22 recommended), MySQL 8, Redis 7
  (install these natively — e.g. `apt install mysql-server redis-server`,
  Homebrew, or managed services; no containers required)

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env        # then edit DB/Redis/secrets

# 3. Create the database (once)
mysql -u root -p -e "CREATE DATABASE admission_crm CHARACTER SET utf8mb4;"

# 4. Migrate + seed
npm run db:migrate
npm run db:seed

# 5. Run (two terminals)
npm run dev                 # web + API on http://localhost:3000
npm run worker:dev          # BullMQ worker (AI/email/whatsapp jobs)
```

**Default login:** `admin@admissioncrm.local` / `Admin@12345`

### With Docker (optional)

```bash
cp .env.example .env
docker compose up --build           # mysql, redis, web, worker, nginx
# App: http://localhost (via nginx) or http://localhost:3000 (direct)
```
The `web` container runs migrations + seeds automatically on first boot.

---

## Configuration

All configuration is environment-driven (see `.env.example`). Key groups:
`DB_*`, `REDIS_*`, `JWT_*`, `OPENAI_*`, `STORAGE_*` (`local`/`s3`),
`TELEPHONY_*` (provider + Exotel keys), `SMTP_*`, `WHATSAPP_*`.

- **AI:** Without `OPENAI_API_KEY` the AI service runs in deterministic **stub
  mode** so the full pipeline stays runnable in dev.
- **Storage:** `STORAGE_DRIVER=local` writes recordings under `./storage`;
  set `s3` + AWS creds for production.
- **Table prefix:** `DB_TABLE_PREFIX` (default `telephony_`) namespaces every
  table — migrations, seeders and runtime models all read from it, so they stay
  in sync. Set it to an empty string to use bare table names.

---

## User roles & RBAC

Six roles seeded with a granular `module.action` permission matrix
(`leads.create`, `calls.recording.view`, `reports.export`, …):
**Super Admin, Admission Manager, Team Leader, Counselor, QA, Management**.
Permissions are role-derived with optional per-user allow/deny overrides.
Counselors are automatically scoped to only their own leads/calls.

---

## Documentation

- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — full developer guide (architecture, modules, pipeline, conventions, extending)
- [`docs/DATABASE.md`](docs/DATABASE.md) — schema & ER overview
- [`docs/API.md`](docs/API.md) — REST endpoint reference
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — VM (PM2) & Docker deployment
- [`docs/openapi.yaml`](docs/openapi.yaml) — OpenAPI 3 spec (import into Swagger UI)
- [`docs/postman_collection.json`](docs/postman_collection.json) — Postman collection

---

## Testing

```bash
npm test                # unit + API smoke tests (jest + supertest)
npm run test:coverage
```
CI (GitHub Actions) spins up MySQL + Redis, runs migrations and the test suite,
and builds the Docker image on `main`.

---

## Implementation status

**Fully implemented end-to-end**
- Auth: login/logout, JWT + rotating refresh tokens, device/session tracking,
  change/forgot/reset password, RBAC middleware
- Database: 25-table schema, models, associations, migration, seeders
- Leads: CRUD, student de-duplication, scoped listing & filters, timeline/notes,
  duplicate merge, Excel/CSV import (preview → column mapping → commit + report)
- Assignment engine: round-robin (Redis cursor), course/city/team-wise,
  least-loaded balancing, manual
- Telephony: provider abstraction, Exotel click-to-call, webhook ingestion,
  recording capture
- AI pipeline: BullMQ transcription (Whisper) → analysis (GPT) → QA scorecard,
  rolled up onto leads
- Recordings: S3/local archival with date-partitioned keys + signed URLs/streaming
- Follow-ups: CRUD, recurrence, overdue scheduler, list/kanban views
- Dashboard & reports: counselor KPIs, funnel, call trend, exportable reports (CSV/Excel)
- Realtime: Socket.IO notifications (new lead, missed call, follow-up due)
- Web UI: responsive Tailwind dashboard with dark mode, leads table, Kanban
  pipeline, calls + recording player, follow-ups, reports
- Security: Helmet, CORS, Redis rate limiting, validation, audit logging, soft deletes
- DevOps: Docker (multi-stage), Compose, Nginx, PM2, CI

**Stubbed / integration points** (logged + DB-tracked, swap in provider creds)
- NoPaperForms (NPF) lead CRM: after each call is analysed the lead is looked
  up by mobile and a **Dynamic Activity** is pushed (create, or update on
  retry) carrying a public transcript URL + call scores, assigned to the
  counselor's NPF owner id. Runs in stub mode without `NPF_SECRET_KEY` /
  `NPF_ACCESS_KEY`. See [NoPaperForms integration](#nopaperforms-npf-integration).
- Email (SMTP/nodemailer) and WhatsApp Business API senders run in stub mode
  without credentials
- Knowlarity/MyOperator/Ozonetel telephony adapters follow the Exotel reference
  and can be added to the provider registry
- Whisper speaker diarisation uses a segment-order heuristic

---

## NoPaperForms (NPF) integration

After the AI pipeline finishes analysing a call, the system pushes the result
back to the NoPaperForms lead CRM so counselors see it on the lead timeline.

**Flow** (`src/services/npfService.js`, fired from the analysis job):

1. Look the lead up by mobile — `POST /lead/v1/getDetailsByMobileNumber`.
2. Build a **public, login-free report URL**: `${APP_URL}/r/<call-uuid>`
   (served by `GET /r/:uuid` → `GET /api/v1/public/calls/:uuid`). Access is
   gated by the unguessable call uuid; the dialled number is masked.
3. Push a **Dynamic Activity** with the transcript URL + scores:
   - first time → `POST /lead/v1/postDynamicActivity/`
   - on a re-analysis/retry → `POST /lead/v1/updateDynamicActivity/`
     (the returned activity id is stored on `call.meta.npf`).
   - `dynamic_fields` = `{ cf_call_transcript_url, cf_call_scores }`;
     `activity_assign` = the counselor's NPF owner id.

**Owner ids.** The admission team's Level-2 export (name → owner id) is seeded
into `npf_owner_map`. A user's `npf_owner_id` is resolved from that mapping by
name when the account is created/updated, or set explicitly in the Users page.
No accounts are created from the export — it is purely a name → owner-id table.

Configure via `NPF_*` in `.env` (see `.env.example`). Without
`NPF_SECRET_KEY`/`NPF_ACCESS_KEY` the integration runs in stub mode (logged +
skipped) and never blocks or fails the analysis job.

---

## License

UNLICENSED — internal university project.
