# Development Guide

A complete, end-to-end developer reference for the **AI-Powered ATLAS Telephony
& Cloud Telephony System** — the admission-management platform that ingests
leads, assigns counselors, captures calls, transcribes & analyses them with AI,
and surfaces everything on a realtime dashboard, REST API and the NoPaperForms
(NPF) lead CRM.

This document is the one-stop map of the codebase: how it is structured, how a
request flows through it, how each subsystem works, and how to develop, test and
extend it safely. For narrower references see:

- [`README.md`](../README.md) — product overview & quick start
- [`docs/DATABASE.md`](DATABASE.md) — schema & ER overview
- [`docs/API.md`](API.md) — REST endpoint reference
- [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) — VM (PM2) & Docker deployment
- [`docs/openapi.yaml`](openapi.yaml) / [`docs/postman_collection.json`](postman_collection.json)

---

## Table of contents

1. [System overview](#1-system-overview)
2. [Tech stack](#2-tech-stack)
3. [Architecture & layering](#3-architecture--layering)
4. [Directory structure](#4-directory-structure)
5. [Application bootstrap & runtime topology](#5-application-bootstrap--runtime-topology)
6. [Request lifecycle](#6-request-lifecycle)
7. [Configuration](#7-configuration)
8. [Domain modules](#8-domain-modules)
9. [The call AI pipeline](#9-the-call-ai-pipeline)
10. [Background jobs & queues](#10-background-jobs--queues)
11. [Data model](#11-data-model)
12. [Authentication, authorization & security](#12-authentication-authorization--security)
13. [Realtime (Socket.IO)](#13-realtime-socketio)
14. [Web UI](#14-web-ui)
15. [External integrations](#15-external-integrations)
16. [Local development setup](#16-local-development-setup)
17. [Coding conventions & patterns](#17-coding-conventions--patterns)
18. [Testing](#18-testing)
19. [Database migrations & seeders](#19-database-migrations--seeders)
20. [Deployment & operations](#20-deployment--operations)
21. [Git workflow & CI](#21-git-workflow--ci)
22. [Extending the system](#22-extending-the-system)
23. [Troubleshooting](#23-troubleshooting)

---

## 1. System overview

The platform is a **production-grade admission CRM** for university admission
teams. End to end it covers:

- **Lead ingestion** — Excel/CSV import (preview → column mapping → commit),
  API, website and Facebook channels, with student de-duplication by phone.
- **Assignment engine** — round-robin (Redis cursor), course/city/team-wise,
  least-loaded balancing, and manual assignment, all recorded immutably.
- **Cloud telephony** — a pluggable provider abstraction (Exotel reference;
  Knowlarity/MyOperator/Ozonetel slot in), click-to-call, webhook ingestion and
  recording capture. A **mobile-dialer** flow also lets agents upload call
  recordings directly from the app.
- **AI pipeline** — event-driven transcription (OpenAI Whisper) → analysis
  (GPT) → QA scorecard, with the key signals rolled up onto the lead.
- **Dashboard & reports** — counselor KPIs, pipeline funnel, call trend, call-QA
  analytics, and exportable reports (CSV/Excel).
- **Realtime** — Socket.IO notifications for new leads, missed calls and due
  follow-ups.
- **Integrations** — NoPaperForms (push call results back to the lead CRM),
  Email (SMTP), WhatsApp Business API, Google Sign-In, AWS S3.

The codebase is a single Node.js/Express application with a clean
**repository → service → controller** layering, a versioned REST API
(`/api/v1`), a server-rendered EJS dashboard, and a BullMQ worker tier that can
run in-process or standalone.

---

## 2. Tech stack

| Layer        | Technology |
|--------------|-----------|
| Runtime      | Node.js ≥ 20 (22 LTS recommended), Express.js 4 |
| Database     | MySQL 8 (utf8mb4) + Sequelize ORM (migrations & seeders) |
| Cache/Queue  | Redis 7 + BullMQ |
| Realtime     | Socket.IO |
| Auth         | JWT access + rotating refresh tokens, Google OAuth, RBAC |
| Frontend     | EJS + express-ejs-layouts + Tailwind CSS + Alpine.js + Chart.js |
| AI           | OpenAI Whisper (transcription) + GPT (analysis/QA) |
| Storage      | AWS S3 (`@aws-sdk/client-s3`) with local-disk fallback |
| Telephony    | Exotel adapter (+ pluggable Knowlarity/MyOperator/Ozonetel) |
| Logging      | Winston + daily-rotate-file |
| DevOps       | Docker, Docker Compose, Nginx, PM2, GitHub Actions |
| Tooling      | ESLint, Jest + Supertest, nodemon, module-alias |

Key dependencies are pinned in [`package.json`](../package.json).

---

## 3. Architecture & layering

The app follows a strict, one-directional dependency flow. Each layer has a
single responsibility and only talks to the layer directly beneath it:

```
HTTP / Socket.IO
      │
   routes/            ── URL → middleware chain → controller
      │
 middlewares/         ── authenticate, authorize, validate, rateLimit, audit
      │
 controllers/         ── thin: parse request, call a service, format response
      │
 services/            ── business logic, orchestration, transactions
      │
 repositories/        ── data access (Sequelize); query construction
      │
 models/              ── Sequelize models + associations
      │
   MySQL / Redis / S3 / OpenAI / Exotel / NPF (external)
```

Cross-cutting helpers live in `utils/` (logger, `ApiError`, `apiResponse`,
`asyncHandler`, `token`, `constants`). Background work is handed off from
services to **BullMQ queues** (`queues/`) and consumed by **jobs**
(`queues/jobs/`) running in the worker tier.

**Design principles**

- **Thin controllers, fat services.** Controllers never contain business rules;
  they delegate to services and return a normalized envelope.
- **Repository pattern.** Data access is isolated behind repositories (see
  `BaseRepository` + `leadRepository`) so query logic is reusable and testable.
- **Provider abstraction.** External providers (telephony) implement a common
  `BaseProvider` interface and register in an index, so swapping vendors is a
  config change, not a rewrite.
- **Config in one place.** Everything reads from `src/config` — no scattered
  `process.env` access.
- **Graceful degradation.** Missing credentials (OpenAI, NPF, SMTP, WhatsApp,
  telephony) put that subsystem into **stub mode** (logged + skipped) so the
  whole pipeline stays runnable in dev.

---

## 4. Directory structure

```
src/
├── app.js                  Express app: security, parsing, view engine, routing
├── server.js               HTTP + Socket.IO bootstrap, scheduler, inline workers
├── config/
│   ├── index.js            Centralised typed config (reads process.env once)
│   ├── database.js         Sequelize connection + connectDatabase()
│   ├── redis.js            ioredis client + BullMQ connection
│   ├── tablePrefix.js      DB_TABLE_PREFIX resolution (default telephony_)
│   └── sequelize-cli.js    Config consumed by sequelize-cli (.sequelizerc)
├── models/                 25+ Sequelize models + associations (index.js auto-loads)
├── migrations/             Schema migrations (timestamp-ordered)
├── seeders/                Roles, permission matrix, statuses, sources, admin, NPF map
├── middlewares/
│   ├── authenticate.js     JWT (header or cookie) → req.user
│   ├── authorize.js        RBAC: requires module.action permission
│   ├── validate.js         express-validator result handling
│   ├── rateLimiter.js      Redis-backed rate limiting
│   ├── auditLogger.js      Append-only audit log for mutating requests
│   └── errorHandler.js     notFound + central errorHandler
├── repositories/
│   ├── BaseRepository.js   Generic CRUD/pagination over a model
│   └── leadRepository.js   Lead-specific queries (scoping, filters)
├── services/               Business logic (see §8)
│   └── telephony/          Provider abstraction: BaseProvider, ExotelProvider, index
├── controllers/            HTTP handlers (one per resource + webController, publicController)
├── routes/
│   ├── api/v1/             Versioned REST API (index.js mounts the resource routers)
│   └── web/                Server-rendered dashboard routes
├── queues/
│   ├── index.js            Producer queue registry + default job options
│   ├── worker.js           BullMQ consumers (inline or standalone)
│   ├── scheduler.js        Recurring jobs (overdue follow-ups, etc.)
│   └── jobs/               transcription, analysis, notification, email, whatsapp
├── sockets/                JWT-authenticated Socket.IO server
├── validators/             express-validator chains (auth, lead)
└── utils/                  logger, ApiError, apiResponse, asyncHandler, token,
                            constants, audioTranscode, mime

views/                      EJS pages, layouts, partials (Tailwind UI)
public/                     Client JS (app.js), compiled CSS, sample CSV
tests/                      Jest unit + API smoke tests
docs/                       This guide + DB/API/Deployment/OpenAPI/Postman
```

**Module aliases** (configured in `package.json` `_moduleAliases` and registered
via `module-alias/register` at the top of `app.js`/`server.js`):
`@root, @src, @config, @models, @services, @repositories, @controllers,
@middlewares, @utils`. Prefer these over long relative paths in new code.

---

## 5. Application bootstrap & runtime topology

There are **two entry points** sharing the same code:

### Web process — `src/server.js`
1. `connectDatabase()` — opens the Sequelize pool and verifies connectivity.
2. Creates the HTTP server around the Express app (`src/app.js`).
3. `initSocket(server)` — attaches the JWT-authenticated Socket.IO server.
4. `startScheduler()` — registers recurring jobs (e.g. overdue follow-ups).
5. If `INLINE_WORKERS=true` (default), `startWorkers()` runs the BullMQ
   consumers **in-process**, so a single `npm start` handles the AI pipeline
   with no separate worker.
6. `server.listen(PORT)` and registers `SIGTERM`/`SIGINT` graceful-shutdown
   handlers (drains in-flight requests, 10s hard timeout).

### Worker process — `src/queues/worker.js`
- When run directly (`node src/queues/worker.js` / `npm run worker`) it connects
  the DB, starts the BullMQ workers and installs its own shutdown handlers.
- When required by the web process, `startWorkers()` only creates the workers
  (the caller already owns the DB connection and signals).

**Scaling model.** The web tier is stateless (sessions/refresh tokens in DB,
rate limits & cursors in Redis), so it scales horizontally behind Nginx/a load
balancer. For higher throughput set `INLINE_WORKERS=false` on the web app and
run dedicated worker replicas; tune per-queue concurrency in `worker.js`.

```
              ┌──────────────┐      ┌─────────┐
  Browser ───▶│  Nginx / LB  │─────▶│ web (N) │──┐
  Mobile  ───▶│              │      └─────────┘  │
              └──────────────┘                   ├──▶ MySQL
                                  ┌────────────┐  ├──▶ Redis (cache/queues/cursors)
  BullMQ jobs ───────────────────▶│ worker (M) │──┘──▶ S3 / OpenAI / Exotel / NPF
                                  └────────────┘
```

---

## 6. Request lifecycle

A typical authenticated API request:

```
Client
  │  Authorization: Bearer <accessToken>  (or httpOnly access_token cookie)
  ▼
app.js          trust proxy, helmet, cors, compression, body parsers, morgan
  ▼
/api/v1         apiLimiter (Redis rate limit)
  ▼
routes/api/v1   public routers (auth, telephony, public) mounted first;
                then authenticate() + auditLogger guard everything else
  ▼
resource router validate(chain)  → authorize('module.action')
  ▼
controller      asyncHandler(fn): parse req → call service → apiResponse(res, …)
  ▼
service         business logic, transactions, enqueue background jobs
  ▼
repository      Sequelize queries (scoped to the caller where applicable)
  ▼
response        { success, message, data, meta }   (or normalized error)
```

**Response envelope** (`utils/apiResponse.js`):

```jsonc
// success
{ "success": true, "message": "Success", "data": {…}, "meta": {…} }
// error (from errorHandler / ApiError)
{ "success": false, "message": "…", "errors": [{ "field": "…", "message": "…" }] }
```

**Error handling.** Throw an `ApiError` (with an HTTP status) anywhere; the
central `errorHandler` normalizes it into the envelope. Wrap async controllers in
`asyncHandler` so rejected promises reach the error handler. Unknown routes hit
`notFound` → `404`.

**Status codes:** `400` bad request · `401` unauthenticated · `403` forbidden ·
`404` not found · `409` conflict · `422` validation · `429` rate limited.

---

## 7. Configuration

All configuration is **environment-driven** and centralised in
[`src/config/index.js`](../src/config/index.js), which parses `process.env`
once into a typed object with helpers (`toBool`, `toInt`, `toList`). Modules
import `config` rather than reading `process.env` directly.

Copy [`.env.example`](../.env.example) → `.env` and fill in values. Key groups:

| Group | Vars | Notes |
|-------|------|-------|
| App | `NODE_ENV, APP_NAME, APP_URL, PORT, CORS_ORIGINS` | `APP_URL` is used in webhooks, public links & emails |
| Database | `DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_DIALECT, DB_TABLE_PREFIX, DB_POOL_*, DB_LOGGING` | `DB_TABLE_PREFIX` (default `telephony_`) namespaces every table |
| Redis | `REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB` | cache, sessions, BullMQ, rate limits, RR cursor |
| Queue | `INLINE_WORKERS` | `true` (default) runs workers in the web process |
| Auth | `JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_*_EXPIRES_IN, SESSION_SECRET, BCRYPT_ROUNDS` | use long random secrets in prod |
| Google | `GOOGLE_CLIENT_ID/SECRET, GOOGLE_CALLBACK_URL, GOOGLE_HOSTED_DOMAIN, GOOGLE_MOBILE_CLIENT_IDS` | web OAuth + mobile ID-token audiences |
| AI | `OPENAI_API_KEY, OPENAI_TRANSCRIBE_MODEL, OPENAI_ANALYSIS_MODEL, AI_ENABLED, AI_TRANSLATE_TO_ENGLISH` | no key ⇒ deterministic **stub mode** |
| Storage | `STORAGE_DRIVER (local/s3), LOCAL_STORAGE_PATH, AWS_REGION, AWS_*, AWS_S3_BUCKET` | omit AWS keys to use the instance IAM role |
| Telephony | `TELEPHONY_PROVIDER, TELEPHONY_WEBHOOK_SECRET, EXOTEL_*` | provider + Exotel keys |
| NPF | `NPF_ENABLED, NPF_BASE_URL, NPF_SECRET_KEY, NPF_ACCESS_KEY, NPF_ACTIVITY_CONFIG_ID, NPF_TIMEZONE, NPF_PUBLIC_BASE_URL` | no keys ⇒ stub mode; public URL must be a real https domain |
| Email/WhatsApp | `SMTP_*, MAIL_FROM, WHATSAPP_API_URL, WHATSAPP_API_TOKEN` | optional integrations; stub without creds |
| Rate limit | `RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX` | per-window request cap |

> **Stub mode is intentional.** Without `OPENAI_API_KEY`, `NPF_*`, `SMTP_*`,
> `WHATSAPP_*` or telephony creds, those subsystems log and skip rather than
> fail, keeping the full flow runnable locally. Never commit a real `.env`.

---

## 8. Domain modules

Each resource follows the same vertical slice: **route → validator → controller
→ service → repository/model**. The services (`src/services/`) hold the logic.

| Service | Responsibility |
|---------|----------------|
| `authService` | Login, Google sign-in (web OAuth + mobile ID-token), JWT issue/verify, rotating refresh tokens, session/device tracking, password change/forgot/reset |
| `userService` | Staff CRUD, role assignment, `agent_extension`, `team_leader_id`, NPF owner-id resolution by name |
| `leadService` | Lead CRUD, student de-dup, scoped listing & filters, timeline/notes, duplicate merge |
| `assignmentService` | Round-robin (Redis cursor), course/city/team-wise, least-loaded, manual; writes immutable `lead_assignments` |
| `importService` | Excel/CSV import: preview → column mapping → commit + import report; duplicate handling |
| `telephonyService` | Click-to-call, webhook ingestion, mobile recording upload, call lifecycle, recording capture |
| `aiService` | OpenAI wrapper: Whisper transcription + GPT analysis/QA; deterministic stub mode when no key |
| `storageService` | `putObject`/`getObject`/signed URLs over S3 or local disk; date-partitioned keys |
| `followupService` | Follow-up CRUD, recurrence, overdue scheduling, list/kanban views |
| `notificationService` | Persist + emit realtime notifications |
| `dashboardService` | KPI cards, funnel, call trend, call-QA analytics (with deltas) |
| `reportService` | Counselor-performance, lead-source, course, admission-funnel reports + CSV/Excel export |
| `npfService` | Look up lead by mobile, build public report URL, push/update NPF Dynamic Activity |

Controllers in `src/controllers/` are thin wrappers per resource. Two are
special: `webController` renders the EJS dashboard pages, and `publicController`
serves the login-free public call report (`GET /r/:uuid`).

The **constants** that tie modules together live in
[`src/utils/constants.js`](../src/utils/constants.js): `ROLES`,
`PIPELINE_STAGES` (9-stage admission funnel), `CALL_DIRECTIONS`,
`CALL_STATUSES`, `ASSIGNMENT_STRATEGIES`, `QUEUES`, `NOTIFICATION_EVENTS`.

---

## 9. The call AI pipeline

The heart of the system is an **event-driven pipeline** that turns a raw call
into structured intelligence on the lead. There are two ways a call enters:

**A. Mobile-dialer upload (primary).** Agents call from their phone's native
dialer and the app uploads the recording afterwards via
`POST /api/v1/calls/upload-recording` (multipart, file in the `recording`
field). The handler archives the audio immediately, creates the `call_logs` +
`call_recordings` (`status: archived`) rows, then enqueues transcription. Missed
calls (`is_missed=true`) are logged with no audio. `client_call_id` makes the
upload idempotent.

**B. Provider webhook (optional).** A cloud provider's status callback hits
`POST /api/v1/telephony/webhook/:provider` (signature-verified, idempotent on
`provider_call_id`). On a `completed` call with a `recordingUrl`, a
`call_recordings` row is created `status: pending` and a transcription job is
enqueued; the worker downloads + archives the audio.

Then, off the request path:

```
recording archived ──▶ [transcription queue]
   └─ download/locate audio, transcode if needed (audioTranscode + ffmpeg-static)
   └─ Whisper transcript (text, segments, speakers, confidence)  → call_transcripts
   └─ reconcile reported duration/talk-time to measured length
          │
          └──────────▶ [analysis queue]
              └─ GPT over the transcript with lead context (course, city)
              └─ interest_score, admission_probability, sentiment(+score),
                 risk_score, summary, next_action, followup_recommendation,
                 objections, keywords, intent, QA scorecard, agent_score,
                 call_quality_score, improvement/positive/negative points,
                 recommendations, sentiment_arc                  → call_analysis
              └─ roll key signals up onto the Lead
              └─ enforce one report per call (unique call_analysis.call_id)
              └─ push result to NoPaperForms (npfService)
```

- **Transcription language.** `AI_TRANSLATE_TO_ENGLISH=true` (default) uses
  Whisper's translation task so transcripts are always English regardless of the
  spoken language.
- **Stub mode.** Without `OPENAI_API_KEY` the `aiService` returns deterministic
  placeholder transcripts/analyses so the pipeline still completes in dev.
- **Idempotency / retries.** `call_analysis.call_id` is unique (one AI report
  per call). Jobs retry 3× with exponential backoff; failures mark the row and
  are logged without blocking other work.
- **Re-analysis.** `POST /api/v1/calls/:id/retry-transcription` re-queues the
  pipeline for the stored recording (no re-upload).

The analysed result becomes visible in `GET /calls/:id`, the dashboard call-QA
analytics, the public report page, and is pushed to NPF (see §15).

---

## 10. Background jobs & queues

BullMQ (Redis-backed) decouples slow/IO work from the request path.

**Producers** — `src/queues/index.js` registers one `Queue` per name with shared
`defaultJobOptions`: `attempts: 3`, exponential backoff (5s), auto-cleanup of
completed (1h/1000) and failed (24h) jobs.

**Consumers** — `src/queues/worker.js` creates a `Worker` per queue with tuned
concurrency:

| Queue (`QUEUES.*`) | Handler | Concurrency | Purpose |
|--------------------|---------|------------|---------|
| `transcription` | `transcriptionJob` | 3 | download/transcode + Whisper |
| `analysis` | `analysisJob` | 5 | GPT analysis + QA + roll-up + NPF push |
| `qa_audit` | `analysisJob` | 3 | QA re-scoring |
| `notification` | `notificationJob` | 20 | persist + emit notifications |
| `email` | `emailJob` | 10 | SMTP send (stub without creds) |
| `whatsapp` | `whatsappJob` | 10 | WhatsApp Business API send (stub without creds) |

There is also an `import` queue for large lead imports.

**Scheduler** — `src/queues/scheduler.js` (`startScheduler()`) registers
recurring jobs such as scanning for overdue follow-ups and emitting
`followup_due` notifications.

To add a job: define the queue name in `constants.QUEUES`, register a producer in
`queues/index.js`, add a handler in `queues/jobs/`, and wire it into the
`processors` map in `worker.js`.

---

## 11. Data model

MySQL 8 (utf8mb4), Sequelize. All tables use `BIGINT UNSIGNED` PKs, `snake_case`
columns, audit timestamps (`created_at`, `updated_at`) and — where appropriate —
soft deletes (`deleted_at`, paranoid mode). Models live in `src/models/` and are
auto-loaded with their associations by `src/models/index.js`.

> **Table prefix.** Every physical table is namespaced with `DB_TABLE_PREFIX`
> (default `telephony_`), resolved once in `src/config/tablePrefix.js` and
> applied to models, migrations and seeders alike — so the schema can live in a
> shared database. Set `DB_TABLE_PREFIX=` (empty) to disable.

Core entities (see [`docs/DATABASE.md`](DATABASE.md) for the full table-by-table
reference and indexing strategy):

- **Identity & RBAC:** `roles`, `permissions`, `role_permissions`,
  `user_permissions`, `users` (self-ref `team_leader_id`, `agent_extension`,
  `npf_owner_id`), `refresh_tokens`.
- **Leads:** `students` (deduped by phone) → `student_documents`; `leads`
  (AI scores, pipeline stage, priority) with `lead_sources`, `lead_statuses`,
  `lead_assignments` (immutable history), `followups`.
- **Calls:** `call_logs` → `call_recordings`, `call_transcripts`,
  `call_analysis` (unique `call_id`).
- **Admissions:** `applications` → `admissions`.
- **Ops & audit:** `notifications`, `activity_logs` (user-facing timeline),
  `audit_logs` (append-only security trail), `whatsapp_logs`, `email_logs`,
  `settings`, `system_configs`, `npf_owner_map`.

**Conventions for new models:** use the table prefix, `BIGINT UNSIGNED` PK,
`snake_case` columns, declare associations in the model, index FK columns and
hot-query composites, and add unique constraints where business identity demands
it (e.g. `call_logs.provider_call_id`, `applications.application_no`).

---

## 12. Authentication, authorization & security

### Authentication
- **API / mobile:** `POST /auth/login` (email+password) and
  `POST /auth/google` (native Google Sign-In ID token; audience must match a
  configured client id, email verified, domain = `GOOGLE_HOSTED_DOMAIN`) both
  return `{ user, accessToken, refreshToken }`.
- **Web:** Google-only OAuth — `GET /google` → consent → `GET /google/callback`.
  Existing active users only; restricted to the hosted domain. The password
  endpoint remains for API clients / admin break-glass.
- **Tokens:** short-lived JWT access tokens + **rotating** refresh tokens
  (hashed in `refresh_tokens`, rotated on every use, revocable, device/session
  tracked). `authenticate()` reads the bearer header or the httpOnly
  `access_token` cookie → `req.user`.

### Authorization (RBAC)
Six seeded roles — **Super Admin, Admission Manager, Team Leader, Counselor, QA,
Management** — with a granular `module.action` permission matrix
(`leads.create`, `calls.recording.view`, `reports.export`, …). Permissions are
role-derived with optional per-user allow/deny overrides (`user_permissions`).
`authorize('module.action')` guards routes; **counselors are automatically
scoped** to only their own leads/calls in the repositories.

### Security middleware & practices
- Helmet, CORS (allow-list via `CORS_ORIGINS`), compression, body-size limits.
- Redis-backed rate limiting (`apiLimiter` on `/api/v1`, plus stricter limits on
  auth where applicable).
- `express-validator` chains + `validate` middleware (→ `422` with field errors).
- `auditLogger` records every mutating authenticated request (who/what/IP) to
  `audit_logs`.
- Soft deletes (paranoid) on sensitive tables; passwords hashed with bcrypt.
- Webhooks are signature-verified and idempotent.
- Public call reports are gated by an unguessable call UUID with the dialled
  number masked — no auth, but unlisted.

---

## 13. Realtime (Socket.IO)

`src/sockets/index.js` attaches a JWT-authenticated Socket.IO server to the HTTP
server. Clients connect with the access token (auth payload or cookie). The
server emits a `notification` event `{ id, type, title, body, data }` for the
event types in `NOTIFICATION_EVENTS`: `new_lead`, `missed_call`, `followup_due`,
`admission_converted`. Notifications are persisted via `notificationService`
(and the `notification` queue) and pushed to the relevant user's sockets.

---

## 14. Web UI

Server-rendered with **EJS + express-ejs-layouts** and styled with Tailwind;
interactivity via **Alpine.js** and charts via **Chart.js** (CDN in dev; run
`npm run build:css` to compile `public/css/app.css` for production).

- **Layouts:** `views/layouts/app.ejs` (authenticated shell with
  `partials/header` + `partials/sidebar`), `layouts/blank.ejs`,
  `layouts/public.ejs`.
- **Pages:** `dashboard`, `leads`, `calls`, `followups`, `pipeline` (Kanban),
  `reports`, `users`, `publicReport`, `error`, plus `auth/login`.
- **Call report partials:** `partials/callReport.ejs` + `callReportBody.ejs`
  render the AI scorecard/transcript (reused by the public report).
- **Client JS:** `public/js/app.js` (API client, Alpine components, charts).

> The visible nav exposes **Dashboard, Leads, Calls** (and **Users** for
> super-admin / admission-manager). Pipeline/Follow-ups/Reports pages are
> hidden in the UI but their API endpoints remain available.

Web routes live in `src/routes/web/` and render through `webController`.

---

## 15. External integrations

### NoPaperForms (NPF) — `npfService`
After the analysis job completes, the result is pushed back to the NPF lead CRM:
1. Look up the lead by mobile — `POST /lead/v1/getDetailsByMobileNumber`.
2. Build a **public, login-free report URL**: `${NPF_PUBLIC_BASE_URL}/r/<call-uuid>`
   (served by `GET /r/:uuid` → `GET /api/v1/public/calls/:uuid`).
3. Push a **Dynamic Activity** with `dynamic_fields`
   `{ cf_call_transcript_url, cf_call_scores }` and `activity_assign` = the
   counselor's NPF owner id: `postDynamicActivity` first time,
   `updateDynamicActivity` on retry (activity id stored on `call.meta.npf`).

Owner ids come from the seeded `npf_owner_map` (name → owner id); a user's
`npf_owner_id` is resolved by name. The public URL **must be a real https
domain** — NPF's WAF 403s a raw IP:port URL. Without `NPF_SECRET_KEY` /
`NPF_ACCESS_KEY` the integration runs in stub mode and never blocks the job.

### Telephony — `services/telephony/`
`BaseProvider` defines the interface (click-to-call, webhook parsing, recording
fetch); `ExotelProvider` is the reference implementation; `index.js` is the
registry resolved from `TELEPHONY_PROVIDER`. Add Knowlarity/MyOperator/Ozonetel
by implementing `BaseProvider` and registering them.

### Storage — `storageService`
`STORAGE_DRIVER=s3` archives recordings to S3 under date-partitioned keys
(`recordings/YYYY/MM/DD/call-<id>.<ext>`) with 15-minute presigned `GetObject`
URLs; `local` writes under `LOCAL_STORAGE_PATH` and streams via
`/calls/recordings/stream`. Omit AWS keys to use the instance IAM role.

### Email & WhatsApp
`emailJob` (SMTP/nodemailer) and `whatsappJob` (WhatsApp Business API) run in
stub mode without credentials.

### Google Sign-In
Web OAuth + mobile ID-token verification (see §12), restricted to
`GOOGLE_HOSTED_DOMAIN`.

---

## 16. Local development setup

Docker is optional — the app runs directly on any host with Node, MySQL and
Redis.

### Prerequisites
- Node.js ≥ 20 (22 recommended), MySQL 8, Redis 7.

### Steps
```bash
# 1. Install dependencies
npm install

# 2. Configure
cp .env.example .env        # edit DB/Redis/secrets (leave provider keys blank for stub mode)

# 3. Create the database (once)
mysql -u root -p -e "CREATE DATABASE admission_crm CHARACTER SET utf8mb4;"

# 4. Migrate + seed
npm run db:migrate
npm run db:seed

# 5. Run
npm run dev                 # web + API on http://localhost:3000 (inline workers on by default)
# optional, for a dedicated worker tier:
#   set INLINE_WORKERS=false in .env, then:
npm run worker:dev          # BullMQ worker (AI/email/whatsapp jobs)
```

**Default login (password break-glass):** `admin@admissioncrm.local` /
`Admin@12345`. In normal use, sign in via Google.

### With Docker (optional)
```bash
cp .env.example .env
docker compose up --build    # mysql, redis, web, worker, nginx
```
The `web` container runs migrations + seeds automatically on first boot.

### Useful npm scripts
| Script | Purpose |
|--------|---------|
| `npm run dev` / `npm start` | web + API (nodemon / node) |
| `npm run worker:dev` / `npm run worker` | BullMQ worker tier |
| `npm run db:migrate` / `:undo` | apply / roll back migrations |
| `npm run db:seed` | run all seeders |
| `npm run db:reset` | undo-all → migrate → seed (dev only) |
| `npm run lint` / `lint:fix` | ESLint |
| `npm test` / `test:coverage` | Jest unit + API smoke tests |
| `npm run build:css` | compile Tailwind → `public/css/app.css` |

---

## 17. Coding conventions & patterns

- **Style:** `'use strict';` at the top of every module; CommonJS `require`;
  ESLint (`.eslintrc.json`) enforced — run `npm run lint:fix` before committing.
- **Imports:** prefer module aliases (`@services/…`) over deep relative paths.
- **Layering:** keep controllers thin; put logic in services; keep data access in
  repositories/models. Don't reach across layers (e.g. controllers must not query
  models directly).
- **Errors:** throw `ApiError(status, message)`; wrap async controllers in
  `asyncHandler`; let the central `errorHandler` format the response.
- **Responses:** always use `apiResponse` so the envelope stays consistent.
- **Config:** read from `src/config`, never `process.env` directly.
- **Constants:** use `utils/constants.js` for roles, stages, statuses, queue
  names and notification events — don't hardcode strings.
- **Background work:** anything slow or IO-bound (AI, email, WhatsApp, large
  imports, provider downloads) goes through a queue, not the request path.
- **Graceful degradation:** new integrations should detect missing credentials
  and fall back to a logged stub rather than throwing.
- **Validation:** add an `express-validator` chain in `validators/` and apply it
  via `validate` on the route.
- **Logging:** use the Winston `logger` (`utils/logger.js`); never `console.log`
  in committed code.

---

## 18. Testing

Jest + Supertest. Config in [`jest.config.js`](../jest.config.js); tests in
`tests/`:

- `tests/unit/` — pure-logic units (`apiResponse`, `token`, `importService`,
  `npfService`).
- `tests/api/` — Supertest smoke tests against the Express app (`health.test.js`).

```bash
npm test                # runs in-band, force-exits (open handles from Redis/DB)
npm run test:coverage   # coverage report
npm run test:watch      # watch mode
```

Guidelines: unit-test services/utilities in isolation (mock repositories and
external clients); keep API tests at the route level; rely on stub mode so tests
don't need live OpenAI/NPF/telephony credentials. CI runs the suite against real
MySQL + Redis services (see §21).

---

## 19. Database migrations & seeders

Sequelize CLI, configured via `.sequelizerc` → `src/config/sequelize-cli.js`.
Migrations and seeders are timestamp-ordered and **respect the table prefix**.

```bash
npm run db:migrate          # apply pending migrations
npm run db:migrate:undo     # roll back the last migration
npm run db:seed             # run all seeders
npm run db:reset            # undo-all → migrate → seed (DESTRUCTIVE; dev only)
```

Current migrations: initial schema, users meta, call-analysis report fields, NPF
integration, and the unique `call_analysis.call_id` constraint. Seeders provision
the RBAC matrix + Super Admin and the NPF owner map.

**Writing a migration:** create a timestamped file in `src/migrations/`,
implement both `up` and `down`, reference table names through the prefix helper,
and keep it idempotent/reversible. Add a matching model change in `src/models/`.

---

## 20. Deployment & operations

See [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) for the full guide. In short:

- **VM (PM2 + Nginx):** `npm ci --omit=dev`, `npm run build:css`,
  `npm run db:migrate && npm run db:seed` (first deploy), then
  `pm2 start ecosystem.config.js` (web cluster + worker). Nginx terminates TLS
  and proxies HTTP + the Socket.IO upgrade; `/public` is cached.
- **Docker Compose:** `docker compose up -d --build` brings up `mysql`, `redis`,
  `web` (auto-migrate+seed), `worker`, `nginx`.
- **Webhooks:** point the provider's status callback at
  `https://<host>/api/v1/telephony/webhook/exotel?token=<TELEPHONY_WEBHOOK_SECRET>`.
- **Health:** `GET /api/v1/health`. **Logs:** Winston → stdout (JSON in prod) +
  daily-rotated files under `logs/`. **Audit:** every mutating authenticated
  request in `audit_logs`.
- **Scaling:** web scales horizontally (stateless); set `INLINE_WORKERS=false`
  and run dedicated workers for heavy Whisper/GPT load; enable MySQL read
  replicas for reporting; make Redis HA.

---

## 21. Git workflow & CI

- **Branching:** develop on a feature branch; open a PR into the default branch.
  Do not push directly to protected branches.
- **Commits:** clear, imperative subject lines describing the change.
- **CI:** [`.github/workflows/tele.yaml`](../.github/workflows/tele.yaml) spins
  up MySQL + Redis, runs lint + migrations + the test suite, and builds the
  Docker image on the main branch. Keep the build green before merging.
- Before pushing: `npm run lint && npm test`.

---

## 22. Extending the system

Common extension points, each isolated by the architecture:

| Goal | Where |
|------|-------|
| New telephony provider | Implement `BaseProvider` in `services/telephony/`, register in `index.js`, set `TELEPHONY_PROVIDER` |
| New REST resource | Add router in `routes/api/v1/`, controller, service, (repository), validator; mount in `routes/api/v1/index.js` |
| New background job | Add queue name to `constants.QUEUES`, producer in `queues/index.js`, handler in `queues/jobs/`, register in `worker.js` |
| New assignment strategy | Extend `ASSIGNMENT_STRATEGIES` + `assignmentService` |
| New report | Add a type in `reportService` (used by `/reports/:type` + export) |
| New notification event | Add to `NOTIFICATION_EVENTS`, emit via `notificationService` |
| New AI signal | Extend `aiService.analyzeTranscript` output + `call_analysis` columns (migration) + roll-up in `analysisJob` |
| New web page | Add an EJS view + a web route via `webController` |

Always: read from `config`, use constants, keep logic in services, add a
validator, write a test, and provide a graceful stub when an integration's
credentials are absent.

---

## 23. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| AI analysis never completes | Worker not running. With `INLINE_WORKERS=false` you must run `npm run worker`. Check Redis connectivity and the `transcription`/`analysis` queues. |
| Transcripts are placeholder text | `OPENAI_API_KEY` unset ⇒ stub mode. Set the key (and `AI_ENABLED=true`). |
| NPF push skipped | `NPF_SECRET_KEY`/`NPF_ACCESS_KEY` blank ⇒ stub mode. NPF `403` ⇒ `NPF_PUBLIC_BASE_URL` must be a real https domain, not an IP:port. |
| Webhook returns `401` | Missing/invalid `?token=` vs `TELEPHONY_WEBHOOK_SECRET`, or failed signature verification. |
| Recording URL `404` | Recording not yet archived (`status` not `archived`/no `storage_key`). |
| Tables not found / wrong names | `DB_TABLE_PREFIX` mismatch between runtime and migrations. Keep it consistent. |
| `429 Too Many Requests` | Rate limit hit — tune `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`, or check Redis. |
| Google sign-in rejected | Email domain ≠ `GOOGLE_HOSTED_DOMAIN`, audience not in allowed client ids, or user inactive/absent (existing users only). |
| Jest hangs | Open Redis/DB handles — the suite runs with `--forceExit`; ensure connections close in teardown. |
| Socket.IO not connecting | Behind Nginx, ensure the WebSocket upgrade is proxied; client must send a valid access token. |

---

*This guide reflects the codebase layout under `src/`. When you change
structure, behaviour or configuration, update the relevant section here and the
companion docs so this stays the source of truth.*
