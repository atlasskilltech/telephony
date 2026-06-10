# REST API Reference

Base URL: `/api/v1` · Format: JSON · Auth: `Authorization: Bearer <accessToken>`
(web clients may instead rely on the httpOnly `access_token` cookie).

### Response envelope
```jsonc
// success
{ "success": true, "message": "Success", "data": {…}, "meta": {…} }
// error
{ "success": false, "message": "…", "errors": [{ "field": "…", "message": "…" }] }
```

### Pagination meta
`{ page, limit, total, totalPages, offset }` — query with `?page=&limit=` (max 100).

> Note: the web UI exposes **Dashboard, Leads, Calls** (and **Users** for
> super-admin / admission-manager). Pipeline/Follow-ups/Reports pages are
> hidden, but their API endpoints below remain available for API clients.

---

## Authentication — `/auth`
| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/auth/login` | – | `email, password, device_name?, device_id?` |
| POST | `/auth/google` | – | `id_token, device_name?` — **mobile Google Sign-In** |
| POST | `/auth/refresh` | – | `refresh_token` (or cookie) |
| POST | `/auth/logout` | – | `refresh_token` |
| POST | `/auth/forgot-password` | – | `email` |
| POST | `/auth/reset-password` | – | `token, new_password` |
| GET  | `/auth/me` | ✓ | – |
| GET  | `/auth/sessions` | ✓ | – |
| POST | `/auth/logout-all` | ✓ | – |
| POST | `/auth/change-password` | ✓ | `current_password, new_password` |

`login`/`refresh` return `{ user, accessToken, refreshToken }`. Refresh tokens
rotate on every use and are revocable server-side.

**Mobile sign-in (`POST /auth/google`).** The app does native Google Sign-In,
obtains a Google **ID token**, and posts `{ id_token }`. The server verifies the
token via Google (audience must be the configured web/Android/iOS client id,
email must be verified, domain must match `GOOGLE_HOSTED_DOMAIN`), matches an
existing active user by email, and returns `{ user, accessToken, refreshToken }`
— same tokens as password login. Set `GOOGLE_MOBILE_CLIENT_IDS` (comma-separated)
to the app's OAuth client id(s). There is **no** passwordless email login.

**Web sign-in is Google-only.** The browser app signs in via Google OAuth:
`GET /google` → Google consent → `GET /google/callback` (registered redirect
URI). Existing users only — the verified Google email must match an active
account; restricted to `GOOGLE_HOSTED_DOMAIN`. The password `POST /auth/login`
endpoint remains for API clients / admin break-glass but is not shown in the UI.

## Dashboard — `/dashboard`
| GET `/dashboard` | combined overview (stats + funnel + trend) |
| GET `/dashboard/stats` | KPI cards |
| GET `/dashboard/funnel` | leads per pipeline stage |
| GET `/dashboard/call-trend?days=14` | daily call volume |
| GET `/dashboard/call-analytics?days=30` | call-QA analytics: metrics (+deltas), weekly score trend & volume, sentiment split, QA-parameter radar, agent leaderboard, recent calls |

## Leads — `/leads`
| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| GET | `/leads` | `leads.view` | filters: `search` (name/phone), `assigned_to` (agent), `pipeline_stage`, `called` (`true`=Called / `false`=New Data), `min_interest` (AI interest ≥ n%), `course, city, source_id, status_id, priority, from, to` |
| POST | `/leads` | `leads.create` | `first_name, phone` required; `auto_assign, strategy` optional |
| GET | `/leads/:id` | `leads.view` | full lead incl. followups & calls |
| PUT | `/leads/:id` | `leads.update` | |
| DELETE | `/leads/:id` | `leads.delete` | soft delete |
| GET | `/leads/:id/timeline` | `leads.view` | activity timeline |
| POST | `/leads/:id/notes` | `leads.update` | `note` |
| GET | `/leads/assignees` | `leads.assign` | active counselors for the assign dropdown `[{id,name}]` |
| POST | `/leads/:id/assign` | `leads.assign` | single — `user_id` or `strategy` |
| POST | `/leads/assign-bulk` | `leads.assign` | bulk — `ids[]` + `user_id` (or `strategy`); returns `{total, assigned, failed, errors}` |
| POST | `/leads/:id/merge` | `leads.merge` | `duplicate_id` |
| POST | `/leads/import/preview` | `leads.import` | multipart `file` → mapping + sample |
| POST | `/leads/import` | `leads.import` | multipart `file, mapping(JSON), source_id, skip_duplicates` |

## Calls — `/calls`
| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| POST | `/calls/upload-recording` | `calls.create` | **mobile dialer** — multipart upload of a recorded call (see below) |
| POST | `/calls/click-to-call` | `calls.create` | `lead_id` and/or `to_number` (one required) — only if a cloud provider is configured |
| GET | `/calls` | `calls.view` | filters `agent_id, lead_id, status, search` (lead name/number) and `from, to` (ISO; **defaults to today**); paginated. Counselors see only their own calls |
| GET | `/calls/agents` | `calls.view` | active agents `[{id,name}]` for the agent filter |
| GET | `/calls/:id` | `calls.view` | full call incl. `recording`, `transcript`, `analysis`, `lead` |
| POST | `/calls/:id/retry-transcription` | `calls.create` | re-queue transcription + analysis for the stored recording (no re-upload) |
| GET | `/calls/:id/recording-url` | `calls.recording.view` | time-limited URL to the archived recording |
| GET | `/calls/recordings/stream?key=` | `calls.recording.view` | streams a local-storage recording (used when `STORAGE_DRIVER=local`) |

### `POST /calls/upload-recording` (mobile dialer flow)
There is no cloud telephony provider: agents place calls from their phone's
native dialer, and the mobile app uploads the recording afterwards. Send
`multipart/form-data` with the audio file in the **`recording`** field plus
metadata fields:

| Field | Required | Notes |
|-------|----------|-------|
| `recording` | ✓ | audio file (`mp3, m4a, aac, amr, wav, ogg, opus, webm, 3gp, flac`), ≤ 50 MB |
| `lead_id` | – | links the call to a lead (its student phone is used if `to_number` omitted) |
| `to_number` | required if no `lead_id` | number that was dialled |
| `from_number` | – | defaults to the agent's `phone` / `agent_extension` |
| `direction` | – | `outbound` (default) or `inbound` |
| `status` | – | defaults to `completed` |
| `duration_seconds` | – | total call seconds (drives the dashboard call-trend) |
| `talk_time_seconds` | – | billable talk time; defaults to `duration_seconds` |
| `started_at` / `ended_at` | – | ISO timestamps; `ended_at` derived from `started_at + duration` if omitted |
| `is_missed` | – | `true`/`false` |
| `client_call_id` | – | client-generated id; makes the upload **idempotent** (safe to retry) |

Auth is the normal `Authorization: Bearer <accessToken>`. The agent is taken
from the token (`agent_id`). The recording is archived immediately (so it is
`archived`, not `pending`), then transcription + AI analysis run in the
background. Returns `201 { data: <call incl. recording> }`. The call then
appears in `GET /calls`, `GET /calls/:id` and the dashboard like any other.

**`GET /calls/:id/recording-url`** returns `{ data: { url } }`. The recording
must be archived (have a `storage_key`) or it responds `404 Recording not
available`. For S3 the `url` is a presigned `GetObject` link valid for **15
minutes**; for local storage it is the `…/recordings/stream` route above.

### Call recording → storage lifecycle
**Mobile upload (primary):** `POST /calls/upload-recording` stores the audio
via `StorageService.putObject` under `recordings/YYYY/MM/DD/call-<id>.<ext>`,
creates the `call_logs` + `call_recordings` (`status: 'archived'`) rows, then
enqueues the transcription/analysis pipeline.

**Provider webhook (optional, if a cloud provider is wired up):**
1. A provider status callback hits `POST /telephony/webhook/:provider`.
2. On a `completed` call carrying a `recordingUrl`, a `call_recordings` row is
   created `status: 'pending'` and a transcription job is enqueued.
3. The worker (in-process by default — `INLINE_WORKERS=true`; or a separate
   `npm run worker`) downloads the provider audio, archives it and
   sets `storage_driver, storage_key, file_size_bytes, status: 'archived'`.
   Failures mark the row `failed`; the job retries (3 attempts, backoff).

In both cases transcription (Whisper) and AI analysis then run off the request
path. `call_recordings.status`: `pending` → `archived` (or `failed`).

### Storage configuration
| Env | Default | Notes |
|-----|---------|-------|
| `STORAGE_DRIVER` | `local` | `s3` or `local` |
| `LOCAL_STORAGE_PATH` | `./storage` | base dir for the local driver |
| `AWS_S3_BUCKET` | – | **required** when `STORAGE_DRIVER=s3` |
| `AWS_REGION` | `ap-south-1` | |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | – | optional — omit to use the instance's IAM role / default AWS credential provider chain |

## Telephony webhooks (public) — `/telephony`
| POST/GET `/telephony/webhook/:provider` | provider status callbacks (signature-verified; no auth) |

Unsigned/invalid requests get `401`. The handler is idempotent on
`provider_call_id` (find-or-create), so providers may retry safely. Always
responds `200 { received: true }` once accepted.

## Follow-ups — `/followups`
| GET `/followups?view=list\|kanban&status=&from=&to=` | list/board |
| POST `/followups` | `lead_id, title, scheduled_at, channel?, recurrence?` |
| PUT `/followups/:id` | update / complete |
| DELETE `/followups/:id` | |

## Notifications — `/notifications`
| GET `/notifications?unread=true` · POST `/notifications/:id/read` · POST `/notifications/read-all` |

## Reports — `/reports`
| GET `/reports/:type` | `counselor-performance \| lead-source \| course \| admission-funnel` |
| GET `/reports/:type/export?format=csv\|excel` | download |

## Users — `/users`
| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| GET | `/users` | `users.view` | list; filters `search, role, status`; paginated |
| GET | `/users/roles` | `users.view` | role list `[{id,name,slug}]` for the form |
| POST | `/users` | `users.create` | `name, email, role_slug` required; `phone, agent_extension, team_leader_id, status, password?` optional. Sign-in is Google-only, so password is optional (a random one is stored). |
| PUT | `/users/:id` | `users.update` | `name, phone, role_slug, agent_extension, team_leader_id, status, password?` (deactivate via `status: inactive`) |
| DELETE | `/users/:id` | `users.delete` | soft-delete the user (paranoid; cannot delete self) |

## Profile — `/profile`
| GET `/profile` · PUT `/profile` (`name, phone, avatar_url`) |

---

## Realtime (Socket.IO)
Connect with the access token (auth payload or cookie). Server emits:
`notification` → `{ id, type, title, body, data }`. Events: `new_lead`,
`missed_call`, `followup_due`, `admission_converted`.

## Errors
`400` bad request · `401` unauthenticated · `403` forbidden ·
`404` not found · `409` conflict · `422` validation · `429` rate limited.
