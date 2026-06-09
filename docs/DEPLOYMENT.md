# Deployment Guide

Target: Ubuntu 24.04 VM running the app under **PM2** behind **Nginx** (no
Docker). Three environments (development / staging / production) share the same
codebase; behaviour is driven by `NODE_ENV` + env vars.

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
Point Nginx at the app — copy `deploy/nginx.conf` to
`/etc/nginx/sites-available/crm`, symlink into `sites-enabled`, then
`nginx -t && systemctl reload nginx`. It already handles the Socket.IO upgrade
and `/public` caching. Terminate TLS with certbot/Let's Encrypt.

Install MySQL 8 and Redis 7 directly on the VM (or use managed services), then
create the database once:
```bash
sudo apt install -y mysql-server redis-server
mysql -u root -p -e "CREATE DATABASE admission_crm CHARACTER SET utf8mb4;"
```

## 4. Telephony webhooks
Configure your provider's status-callback / passthru URL to:
```
https://crm.your-domain.edu/api/v1/telephony/webhook/exotel?token=<TELEPHONY_WEBHOOK_SECRET>
```
The webhook updates `telephony_call_logs`, stores the recording reference and
enqueues the transcription → analysis pipeline.

## 5. Scaling notes
- **Web** scales horizontally (stateless; sessions/refresh tokens in DB, rate
  limits in Redis). Run behind the Nginx upstream / a load balancer.
- **Worker** scales independently; tune per-queue `concurrency` in
  `src/queues/worker.js`. Heavy Whisper/GPT load → add worker replicas.
- **MySQL**: enable read replicas for reporting; the schema is indexed for
  100k+ leads/month.
- **Redis**: used for cache, BullMQ and distributed rate limiting — make it HA.

## 6. Health & observability
- Liveness: `GET /api/v1/health`
- Logs: Winston → stdout (JSON in prod) + daily-rotated files under `logs/`
- Audit: every mutating authenticated request recorded in `telephony_audit_logs`

## 7. CI/CD
`.github/workflows/ci.yml` runs lint + migrations + tests against MySQL/Redis
services on every push/PR. For deploys, add a step that SSHes to the VM,
pulls the branch, runs `npm ci --omit=dev`, `npm run db:migrate`, and
`pm2 reload ecosystem.config.js`.
