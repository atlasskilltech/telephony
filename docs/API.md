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
| POST `/calls/click-to-call` | `calls.create` | `lead_id` or `to_number` |
| GET `/calls` | `calls.view` | filter `lead_id, status` |
| GET `/calls/:id` | `calls.view` | incl. recording, transcript, analysis |
| GET `/calls/:id/recording-url` | `calls.recording.view` | signed/stream URL |

## Telephony webhooks (public) — `/telephony`
| POST/GET `/telephony/webhook/:provider` | provider status callbacks (signature-verified) |

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
