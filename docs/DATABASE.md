# Database Documentation

MySQL 8 (utf8mb4), Sequelize ORM. All tables use `BIGINT UNSIGNED` PKs,
`snake_case` columns, audit timestamps (`created_at`, `updated_at`) and — where
appropriate — soft deletes (`deleted_at`, paranoid mode).

> **Table prefix:** every table is created with the **`telephony_`** prefix
> (e.g. `telephony_users`, `telephony_leads`, `telephony_call_logs`). The names
> below are shown without the prefix for readability; the actual table is
> `telephony_<name>`. The prefix is applied centrally in the migration
> (a wrapped `queryInterface`) and in each model's `tableName`, so application
> code keeps using the logical model names (`User`, `Lead`, …).

## Entity overview

```
roles ─┬─< users >─┬─< leads >─┬─< followups
       │           │           ├─< call_logs >─┬─ call_recordings
permissions        │           │               ├─ call_transcripts
   │               │           │               └─ call_analysis
role_permissions   │           ├─< lead_assignments
user_permissions   │           └─< applications >── admissions
refresh_tokens     │
                students ──< student_documents
lead_sources ──< leads >── lead_statuses
notifications, activity_logs, audit_logs, whatsapp_logs, email_logs,
settings, system_configs
```

## Tables

| Table | Purpose | Key relations |
|-------|---------|---------------|
| `roles` | Six system roles | hasMany users; M:N permissions |
| `permissions` | `module.action` permission catalog | M:N roles & users |
| `role_permissions` | Role → permission matrix | join |
| `user_permissions` | Per-user allow/deny overrides | user, permission |
| `users` | Staff accounts; `team_leader_id` self-ref; `agent_extension` for dialler | role |
| `refresh_tokens` | Hashed refresh tokens for session/device mgmt | user |
| `lead_sources` | Channels (website, facebook, excel, csv, api…) | hasMany leads |
| `lead_statuses` | Statuses mapped to pipeline stages | hasMany leads |
| `students` | Person behind a lead (deduped by phone) | hasMany leads, documents |
| `student_documents` | Uploaded docs (S3/local) | student |
| `leads` | Core lead; AI scores, pipeline stage, priority | student, source, status, counselor |
| `lead_assignments` | Immutable assignment history + strategy | lead, counselor |
| `followups` | Scheduled follow-ups; recurrence; status | lead, user |
| `call_logs` | Every call; direction, duration, talk time, status | lead, agent |
| `call_recordings` | Archived audio (storage key, driver) | call_log |
| `call_transcripts` | Whisper output: text, segments, speakers, confidence | call_log |
| `call_analysis` | GPT analysis + QA scorecard | call_log |
| `notifications` | In-app/realtime notifications | user |
| `activity_logs` | User-facing lead/call timeline | user |
| `audit_logs` | Append-only security audit (who/what/IP) | user |
| `whatsapp_logs` | WhatsApp send log + status | lead |
| `email_logs` | Email send log + open/click tracking | lead |
| `applications` | Admission application records | lead, student |
| `admissions` | Confirmed/enrolled admissions | application, student, counselor |
| `settings` | User-scoped preferences | user |
| `system_configs` | Global config (provider keys, toggles) | — |

## Indexing strategy

- FK columns indexed on every table.
- Composite indexes for hot queries:
  `leads(assigned_to, pipeline_stage)`, `leads(course, city)`,
  `call_logs(agent_id, started_at)`, `notifications(user_id, read_at)`.
- Unique constraints: `users.email`, `leads.reference_no`,
  `call_logs.provider_call_id`, `applications.application_no`,
  `admissions.admission_no`, `(user_id, permission_id)`, `(user_id, key)`.

## Migrations & seeders

```bash
npm run db:migrate          # apply schema
npm run db:seed             # roles, permissions, statuses, sources, admin
npm run db:reset            # undo all → migrate → seed (dev only)
```

The seeder provisions the full RBAC matrix and a Super Admin
(`admin@admissioncrm.local` / `Admin@12345`).
