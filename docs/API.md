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

---

## Authentication — `/auth`
| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/auth/login` | – | `email, password, device_name?, device_id?` |
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

## Dashboard — `/dashboard`
| GET `/dashboard` | combined overview (stats + funnel + trend) |
| GET `/dashboard/stats` | KPI cards |
| GET `/dashboard/funnel` | leads per pipeline stage |
| GET `/dashboard/call-trend?days=14` | daily call volume |

## Leads — `/leads`
| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| GET | `/leads` | `leads.view` | filters: `search, course, city, source_id, status_id, assigned_to, pipeline_stage, priority, from, to` |
| POST | `/leads` | `leads.create` | `first_name, phone` required; `auto_assign, strategy` optional |
| GET | `/leads/:id` | `leads.view` | full lead incl. followups & calls |
| PUT | `/leads/:id` | `leads.update` | |
| DELETE | `/leads/:id` | `leads.delete` | soft delete |
| GET | `/leads/:id/timeline` | `leads.view` | activity timeline |
| POST | `/leads/:id/notes` | `leads.update` | `note` |
| POST | `/leads/:id/assign` | `leads.assign` | `user_id` or `strategy` |
| POST | `/leads/:id/merge` | `leads.merge` | `duplicate_id` |
| POST | `/leads/import/preview` | `leads.import` | multipart `file` → mapping + sample |
| POST | `/leads/import` | `leads.import` | multipart `file, mapping(JSON), source_id, skip_duplicates` |

## Calls — `/calls`
| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| POST | `/calls/click-to-call` | `calls.create` | `lead_id` and/or `to_number` (one required) |
| GET | `/calls` | `calls.view` | filters `lead_id, status`; paginated. Counselors see only their own calls |
| GET | `/calls/:id` | `calls.view` | full call incl. `recording`, `transcript`, `analysis`, `lead` |
| GET | `/calls/:id/recording-url` | `calls.recording.view` | time-limited URL to the archived recording |
| GET | `/calls/recordings/stream?key=` | `calls.recording.view` | streams a local-storage recording (used when `STORAGE_DRIVER=local`) |

**`POST /calls/click-to-call`** dials the agent's `agent_extension`/`phone`,
bridges to the lead's number, creates a `call_logs` row (`status` from the
provider) and returns `201 { data: <call> }`.

**`GET /calls/:id/recording-url`** returns `{ data: { url } }`. The recording
must be archived (have a `storage_key`) or it responds `404 Recording not
available`. For S3 the `url` is a presigned `GetObject` link valid for **15
minutes**; for local storage it is the `…/recordings/stream` route above.

### Call recording → storage lifecycle
1. A provider status callback hits `POST /telephony/webhook/:provider`.
2. On a `completed` call that carries a `recordingUrl`, a `call_recordings`
   row is created with `status: 'pending'` and a **transcription** job is
   enqueued.
3. The worker (`npm run worker`) downloads the provider audio and archives it
   via `StorageService.putObject` under a date-partitioned key
   `recordings/YYYY/MM/DD/call-<id>.mp3`, then sets
   `storage_driver`, `storage_key`, `file_size_bytes`, `status: 'archived'`,
   `archived_at`. Download/upload failures mark the row `status: 'failed'`
   and the job retries (3 attempts, exponential backoff).
4. Transcription (Whisper) and AI analysis run next, off the request path.

`call_recordings.status`: `pending` → `archived` (or `failed`).

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
