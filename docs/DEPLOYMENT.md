# Deployment Guide

Targets: Ubuntu 24.04 VM (PM2 + Nginx) or container platform (Docker Compose /
Kubernetes). Three environments share the same image; behaviour is driven by
`NODE_ENV` + env vars.

## 1. Prerequisites
- Node.js 22 LTS, MySQL 8, Redis 7
- An OpenAI API key (optional — stub mode otherwise)
- AWS S3 bucket + IAM creds (optional — local storage otherwise)
- Cloud telephony account (Exotel by default)

## 2. Environment
Copy `.env.example` → `.env` and set strong secrets:
```
NODE_ENV=production
JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / SESSION_SECRET   # long random strings
DB_* , REDIS_* , OPENAI_API_KEY , STORAGE_DRIVER=s3 , AWS_* , TELEPHONY_* , SMTP_*
APP_URL=https://crm.your-domain.edu                       # used in webhooks & emails
```

## 3a. VM deployment (PM2 + Nginx)
```bash
git clone <repo> && cd telephony
npm ci --omit=dev
npm run build:css                       # compile Tailwind (optional; CDN fallback)
npm run db:migrate && npm run db:seed   # first deploy only
npm i -g pm2
pm2 start ecosystem.config.js           # crm-web (cluster) + crm-worker
pm2 save && pm2 startup                  # restart on reboot
```
Point Nginx at the app (see `docker/nginx.conf` for a reference vhost incl.
Socket.IO upgrade + `/public` caching). Terminate TLS with certbot/Let's Encrypt.

## 3b. Docker Compose
```bash
cp .env.example .env        # set secrets; DB_HOST/REDIS_HOST overridden in compose
docker compose up -d --build
```
Brings up `mysql`, `redis`, `web` (auto-migrates+seeds), `worker`, `nginx`.
Recordings persist in the `storage_data` volume (or S3 if configured).

## 4. Telephony webhooks
Configure your provider's status-callback / passthru URL to:
```
https://crm.your-domain.edu/api/v1/telephony/webhook/exotel?token=<TELEPHONY_WEBHOOK_SECRET>
```
The webhook updates `call_logs`, stores the recording reference and enqueues the
transcription → analysis pipeline.

## 5. Scaling notes
- **Workers**: by default (`INLINE_WORKERS=true`) the web process also runs the
  BullMQ consumers, so a single `npm start` handles transcription/analysis with
  **no separate worker process**. For higher throughput set
  `INLINE_WORKERS=false` on the web app and run a dedicated `npm run worker`
  (the `crm-worker` PM2 app / Compose `worker` service).
- **Web** scales horizontally (stateless; sessions/refresh tokens in DB, rate
  limits in Redis). Run behind the Nginx upstream / a load balancer. When
  running multiple web replicas with inline workers, prefer a dedicated worker
  and `INLINE_WORKERS=false` so job concurrency stays predictable.
- **Worker** scales independently; tune per-queue `concurrency` in
  `src/queues/worker.js`. Heavy Whisper/GPT load → add worker replicas.
- **MySQL**: enable read replicas for reporting; the schema is indexed for
  100k+ leads/month.
- **Redis**: used for cache, BullMQ and distributed rate limiting — make it HA.

## 6. Health & observability
- Liveness: `GET /api/v1/health`
- Logs: Winston → stdout (JSON in prod) + daily-rotated files under `logs/`
- Audit: every mutating authenticated request recorded in `audit_logs`

## 7. CI/CD
`.github/workflows/ci.yml` runs lint + migrations + tests against MySQL/Redis
services and builds the Docker image on `main`. Extend the `docker` job to push
to your registry and trigger a rollout.
