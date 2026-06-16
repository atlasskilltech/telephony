# Porting Guide: Call Capture + Transcription → Analysis

A self-contained recipe for adding **call recording capture** and the
**transcription → AI analysis pipeline** from this project into **another
existing Node.js project** on the **same stack** (Express + Sequelize/MySQL +
BullMQ/Redis).

This is an extraction guide — copy the listed files into the target repo, add
the dependencies, run one migration, and wire four small touch-points. The
pipeline is deliberately decoupled here from the rest of the CRM (leads,
counselors, NPF, dashboard) so you can take just the call/AI slice.

> Scope of this guide
> - **In:** capturing a call + its recording, archiving the audio, Whisper
>   transcription (with diarisation), GPT analysis + QA scorecard, the BullMQ
>   queues/jobs that run it, and the storage/transcode helpers.
> - **Out (optional, noted inline):** lead roll-up, NoPaperForms push,
>   click-to-call dialling, dashboard/reporting, web UI, RBAC. Stubs/removals
>   are shown so the slice compiles without them.

---

## 1. What the pipeline does

```
[A] mobile upload  POST /calls/upload-recording ─┐
                                                  ├─▶ CallLog + CallRecording(archived)
[B] provider webhook POST /telephony/webhook/:p ─┘        │
                                                          ▼
                                          [transcription queue]
       download/read audio ─▶ transcode to mp3 (ffmpeg) ─▶ Whisper
       ─▶ diarise segments (GPT or heuristic) ─▶ save CallTranscript
       ─▶ reconcile call duration to real audio length
                                                          │
                                                          ▼
                                              [analysis queue]
       GPT over transcript ─▶ interest/sentiment/objections/summary
       + QA scorecard ─▶ save CallAnalysis
```

Two entry points create the call + recording rows; everything after that runs
**off the request path** in BullMQ workers. Without an `OPENAI_API_KEY` the AI
service returns deterministic **stub** output so the whole flow still runs.

---

## 2. Dependencies to add

Add to the target project's `package.json` (versions match this repo; newer
patch releases are fine):

```bash
npm install openai@^4.68.4 \
            @aws-sdk/client-s3@^3.682.0 \
            @aws-sdk/s3-request-presigner@^3.682.0 \
            ffmpeg-static@^5.3.0 \
            axios@^1.7.7 \
            multer@^1.4.5-lts.1 \
            bullmq@^5.21.0 \
            ioredis@^5.4.1
```

Almost certainly already present on the same stack: `sequelize`, `mysql2`,
`express`. `@aws-sdk/*` is only needed if you use `STORAGE_DRIVER=s3`
(it is lazy-`require`d) — you can skip it for local-disk storage. `ffmpeg-static`
ships a static ffmpeg binary, so no system ffmpeg is required.

---

## 3. Files to copy

Copy these from this repo into the target (paths assume a `src/` root; adjust to
the target's layout and fix the relative `require(...)` paths accordingly).

| Copy from this repo | Role | Adapt? |
|---------------------|------|--------|
| `src/models/callLog.js` | `call_logs` model | rename FK targets if your Lead/User models differ (§6) |
| `src/models/callRecording.js` | `call_recordings` model | — |
| `src/models/callTranscript.js` | `call_transcripts` model | — |
| `src/models/callAnalysis.js` | `call_analysis` model | — |
| `src/services/aiService.js` | OpenAI Whisper + GPT wrapper (+stub) | — |
| `src/services/storageService.js` | S3 / local-disk archival | — |
| `src/utils/mime.js` | audio MIME / extension helpers | — |
| `src/utils/audioTranscode.js` | ffmpeg transcode to Whisper-safe mp3 | — |
| `src/queues/index.js` | BullMQ producer registry | trim to the queues you keep (§5) |
| `src/queues/worker.js` | BullMQ consumers | trim `processors` to transcription+analysis |
| `src/queues/jobs/transcriptionJob.js` | download/transcode/Whisper job | — |
| `src/queues/jobs/analysisJob.js` | GPT analysis job | **strip NPF + lead roll-up** (§7) |
| `src/services/telephonyService.js` | call capture (upload/webhook) | trim to `recordMobileCall` + `retryTranscription` (§6) |
| `src/controllers/callController.js` | HTTP handlers | keep upload/show/retry/recording-url; drop NPF + click-to-call (§6) |
| `src/routes/api/v1/calls.routes.js` | routes + multer config | drop NPF + click-to-call routes (§6) |
| `src/config/redis.js` | ioredis + `bullConnection` | merge into your config |

**Shared helpers** the above import — copy if the target doesn't already have
equivalents, otherwise point the requires at the target's versions:

- `src/config/index.js` — needs at least the `ai`, `storage`, `redis` blocks
  (see §4). Merge these keys into your existing config object.
- `src/utils/logger.js` — Winston logger (or swap for the target's logger).
- `src/utils/ApiError.js` — typed HTTP errors (`badRequest`, `notFound`, …).
- `src/utils/asyncHandler.js` — async route wrapper.
- `src/utils/apiResponse.js` — `success` / `created` / `paginate` helpers.
- `src/utils/constants.js` — copy the `QUEUES`, `CALL_DIRECTIONS`,
  `CALL_STATUSES` blocks (drop the rest).

> If the target uses a **table-name prefix** scheme like this repo
> (`src/config/tablePrefix.js` + a Sequelize `beforeDefine` hook in
> `config/database.js`), keep it consistent. Otherwise delete the prefix usage —
> the models above declare bare `tableName`s already, so they work without it.

---

## 4. Environment variables

Add to the target's `.env` (only these groups are required for the slice):

```ini
# ---- AI (OpenAI) ----
OPENAI_API_KEY=                      # blank ⇒ deterministic stub mode
OPENAI_TRANSCRIBE_MODEL=whisper-1
OPENAI_ANALYSIS_MODEL=gpt-4o-mini
AI_ENABLED=true
AI_TRANSLATE_TO_ENGLISH=true         # Whisper translation task ⇒ English transcripts

# ---- Storage (S3 with local fallback) ----
STORAGE_DRIVER=local                 # local | s3
LOCAL_STORAGE_PATH=./storage
AWS_REGION=ap-south-1
AWS_S3_BUCKET=                        # required only when STORAGE_DRIVER=s3
AWS_ACCESS_KEY_ID=                    # omit to use the instance IAM role
AWS_SECRET_ACCESS_KEY=

# ---- Redis (BullMQ) ----
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# ---- Queue topology ----
INLINE_WORKERS=true                  # run workers in the web process (see §8)
```

The corresponding `config` shape consumed by the copied code (from
`src/config/index.js`) — merge into your config object:

```js
ai: {
  enabled: toBool(process.env.AI_ENABLED, true),
  apiKey: process.env.OPENAI_API_KEY || '',
  transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1',
  analysisModel: process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini',
  translateToEnglish: toBool(process.env.AI_TRANSLATE_TO_ENGLISH, true),
},
storage: {
  driver: process.env.STORAGE_DRIVER || 'local',
  localPath: process.env.LOCAL_STORAGE_PATH || './storage',
  aws: {
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    bucket: process.env.AWS_S3_BUCKET || '',
  },
},
redis: {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: toInt(process.env.REDIS_PORT, 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: toInt(process.env.REDIS_DB, 0),
},
queue: { inlineWorkers: toBool(process.env.INLINE_WORKERS, true) },
```

(`toBool`/`toInt` helpers are defined at the top of `src/config/index.js`.)

---

## 5. Database schema

The slice needs **four tables**. Their definitions live in the copied models
(`callLog.js`, `callRecording.js`, `callTranscript.js`, `callAnalysis.js`).
Generate a migration for the target from those models — a minimal hand-written
version:

```js
'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    // call_logs
    await queryInterface.createTable('call_logs', {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      uuid: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, unique: true },
      provider: { type: DataTypes.STRING(40) },
      provider_call_id: { type: DataTypes.STRING(120), unique: true },
      lead_id: { type: DataTypes.BIGINT.UNSIGNED },        // drop if no leads
      agent_id: { type: DataTypes.BIGINT.UNSIGNED },        // your users PK
      direction: { type: DataTypes.ENUM('inbound', 'outbound'), defaultValue: 'outbound' },
      from_number: { type: DataTypes.STRING(20) },
      to_number: { type: DataTypes.STRING(20) },
      status: { type: DataTypes.STRING(30), defaultValue: 'initiated' },
      duration_seconds: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
      talk_time_seconds: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
      is_missed: { type: DataTypes.BOOLEAN, defaultValue: false },
      recording_url: { type: DataTypes.STRING(512) },
      started_at: { type: DataTypes.DATE },
      ended_at: { type: DataTypes.DATE },
      meta: { type: DataTypes.JSON },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    // call_recordings
    await queryInterface.createTable('call_recordings', {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      call_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      source_url: { type: DataTypes.STRING(512) },
      storage_driver: { type: DataTypes.ENUM('local', 's3'), defaultValue: 'local' },
      storage_key: { type: DataTypes.STRING(512) },
      file_size_bytes: { type: DataTypes.INTEGER.UNSIGNED },
      duration_seconds: { type: DataTypes.INTEGER.UNSIGNED },
      format: { type: DataTypes.STRING(20), defaultValue: 'mp3' },
      status: { type: DataTypes.ENUM('pending', 'archived', 'failed'), defaultValue: 'pending' },
      archived_at: { type: DataTypes.DATE },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    // call_transcripts
    await queryInterface.createTable('call_transcripts', {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      call_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      language: { type: DataTypes.STRING(20) },
      text: { type: DataTypes.TEXT('long') },
      segments: { type: DataTypes.JSON },
      speaker_map: { type: DataTypes.JSON },
      confidence: { type: DataTypes.DECIMAL(5, 4) },
      model: { type: DataTypes.STRING(60) },
      processing_ms: { type: DataTypes.INTEGER.UNSIGNED },
      status: { type: DataTypes.ENUM('queued', 'processing', 'completed', 'failed'), defaultValue: 'queued' },
      error: { type: DataTypes.STRING(512) },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    // call_analysis  (call_id UNIQUE ⇒ exactly one report per call)
    await queryInterface.createTable('call_analysis', {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      call_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, unique: true },
      interest_score: { type: DataTypes.DECIMAL(5, 2) },
      admission_probability: { type: DataTypes.DECIMAL(5, 2) },
      sentiment: { type: DataTypes.ENUM('positive', 'neutral', 'negative') },
      sentiment_score: { type: DataTypes.DECIMAL(5, 2) },
      risk_score: { type: DataTypes.DECIMAL(5, 2) },
      summary: { type: DataTypes.TEXT },
      next_action: { type: DataTypes.STRING(255) },
      followup_recommendation: { type: DataTypes.TEXT },
      objections: { type: DataTypes.JSON },
      keywords: { type: DataTypes.JSON },
      intent: { type: DataTypes.STRING(120) },
      positive_points: { type: DataTypes.JSON },
      negative_points: { type: DataTypes.JSON },
      recommendations: { type: DataTypes.JSON },
      sentiment_arc: { type: DataTypes.JSON },
      qa_scores: { type: DataTypes.JSON },
      call_quality_score: { type: DataTypes.DECIMAL(5, 2) },
      agent_score: { type: DataTypes.DECIMAL(5, 2) },
      improvement_suggestions: { type: DataTypes.JSON },
      model: { type: DataTypes.STRING(60) },
      status: { type: DataTypes.ENUM('queued', 'processing', 'completed', 'failed'), defaultValue: 'queued' },
      error: { type: DataTypes.STRING(512) },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.addIndex('call_logs', ['agent_id', 'started_at']);
    await queryInterface.addIndex('call_recordings', ['call_id']);
    await queryInterface.addIndex('call_transcripts', ['call_id']);
    // unique already declared on call_analysis.call_id
  },
  async down(queryInterface) {
    await queryInterface.dropTable('call_analysis');
    await queryInterface.dropTable('call_transcripts');
    await queryInterface.dropTable('call_recordings');
    await queryInterface.dropTable('call_logs');
  },
};
```

> If the target prefixes table names, wrap each name with your prefix helper.
> The many score columns on `call_analysis` are admission-domain flavoured
> (`interest_score`, `admission_probability`); keep them as-is (they're just
> nullable JSON/decimals) or rename to suit your domain and update `analysisJob`
> + the `aiService` prompt schema to match.

---

## 6. Wiring the call-capture layer (touch-points to adapt)

The copied code references a few host-project entities. Resolve each:

**(a) Model associations** — `callLog.js` declares `belongsTo(Lead)` and
`belongsTo(User)` plus `hasOne` to the three child tables. Keep the child
`hasOne`s; for the parents, point them at the target's user model (rename `Lead`
→ your entity, or remove the `lead` association and the `lead_id` column if you
have no lead concept). Make sure all four models are registered in the target's
`models/index.js` so `db.CallLog` etc. resolve.

**(b) `telephonyService.js`** — keep `recordMobileCall` (the primary upload
flow) and `retryTranscription`. Remove or stub:
- `clickToCall` and `handleWebhook` → these pull in `./telephony` provider
  abstraction (`getProvider`) and `notificationQueue`. Drop them unless you want
  the optional provider-webhook path (then also copy `src/services/telephony/`
  and the `telephony.routes.js`).
- `db.ActivityLog.create(...)` calls → point at the target's activity/audit log
  or delete them.
- The "mark lead Called / advance pipeline" block → delete if you have no leads.

The essential part of `recordMobileCall` is: validate the upload, find-or-create
`CallLog` (idempotent on `provider_call_id = mobile-<client_call_id>`), archive
the audio via `storageService.putObject` under a date-partitioned key, create
`CallRecording(status:'archived')`, then
`transcriptionQueue.add('transcribe', { callId, recordingId })`.

**(c) `callController.js` + `calls.routes.js`** — keep:
`uploadRecording`, `show`, `retryTranscription`, `recordingUrl`,
`streamRecording`. Drop the NPF handlers (`npfStatus/npfTest/setNpfConfig/
postNpf/npfLeadDetails`), `clickToCall`, and the `webhook` route unless you keep
the provider path. Replace `requirePermission('calls.*')` with the target's auth
middleware (or remove for an internal endpoint). The multer config (memory
storage, 50 MB cap, audio fileFilter) is self-contained — keep it.

Minimal route set after trimming:

```js
router.post('/upload-recording', upload.single('recording'), callController.uploadRecording);
router.get('/:id', callController.show);
router.post('/:id/retry-transcription', callController.retryTranscription);
router.get('/:id/recording-url', callController.recordingUrl);
router.get('/recordings/stream', callController.streamRecording); // local storage only
```

**(d) `req.user`** — `uploadRecording` reads the agent from `req.user`
(`agent.id`, `agent.phone`, `agent.agent_extension`). Ensure the target's auth
middleware populates `req.user`, or pass an explicit agent id in the body.

---

## 7. Decoupling the analysis job

`analysisJob.js` as shipped also (1) rolls AI scores onto the `Lead` and
(2) pushes to NoPaperForms. For a clean call-only slice, replace its body with
this NPF-free, lead-optional version:

```js
'use strict';
const db = require('../../models');
const aiService = require('../../services/aiService');
const logger = require('../../utils/logger');

module.exports = async function analysisJob(job) {
  const { callId, transcriptId } = job.data;
  const transcript = await db.CallTranscript.findByPk(transcriptId);
  if (!transcript || !transcript.text) throw new Error('Transcript not available for analysis');

  const call = await db.CallLog.findByPk(callId, {
    include: [{ model: db.Lead, as: 'lead' }], // remove this include if no leads
  });
  const context = { course: call?.lead?.course, city: call?.lead?.city }; // or {}

  const [analysisRow] = await db.CallAnalysis.findOrCreate({
    where: { call_id: callId },
    defaults: { call_id: callId, status: 'processing' },
  });

  try {
    const a = await aiService.analyzeTranscript(transcript.text, context);
    await analysisRow.update({
      interest_score: a.interest_score, admission_probability: a.admission_probability,
      sentiment: a.sentiment, sentiment_score: a.sentiment_score, risk_score: a.risk_score,
      summary: a.summary, next_action: a.next_action,
      followup_recommendation: a.followup_recommendation,
      objections: a.objections, keywords: a.keywords, intent: a.intent,
      qa_scores: a.qa_scores || {}, call_quality_score: a.call_quality_score,
      agent_score: a.agent_score, improvement_suggestions: a.improvement_suggestions,
      positive_points: a.positive_points, negative_points: a.negative_points,
      recommendations: a.recommendations, sentiment_arc: a.sentiment_arc,
      model: a.model, status: 'completed',
    });
    logger.info(`Analysed call ${callId}: interest ${a.interest_score}, sentiment ${a.sentiment}`);
  } catch (err) {
    await analysisRow.update({ status: 'failed', error: err.message.slice(0, 500) });
    throw err;
  }
  return { callId };
};
```

`transcriptionJob.js` needs **no** changes for the slice — it only touches
`CallRecording`, `CallTranscript`, `CallLog`, `aiService`, `storageService` and
enqueues `analysisQueue`.

---

## 8. Queues & worker

`src/queues/index.js` registers all producers — trim it to the two you need:

```js
const transcriptionQueue = makeQueue('transcription');
const analysisQueue = makeQueue('analysis');
module.exports = { transcriptionQueue, analysisQueue };
```

`src/queues/worker.js` — trim `processors` to:

```js
const processors = {
  transcription: { handler: transcriptionJob, concurrency: 3 },
  analysis:      { handler: analysisJob,      concurrency: 5 },
};
```

`bullConnection` (from `src/config/redis.js`) must use
`maxRetriesPerRequest: null` — BullMQ requires it; keep that file's options.
Default job options give every queue 3 attempts with exponential backoff and
auto-cleanup (see `defaultJobOptions` in `queues/index.js`).

**Running the workers.** Either run a dedicated process
(`node src/queues/worker.js`) or call `startWorkers()` from your server bootstrap
when `INLINE_WORKERS=true`, exactly like this repo's `server.js`:

```js
const { startWorkers } = require('./queues/worker');
if (config.queue.inlineWorkers) startWorkers();
```

---

## 9. Integration checklist

1. `npm install` the §2 dependencies.
2. Copy the §3 files; fix `require(...)` paths to the target's layout.
3. Merge the §4 config blocks and `.env` keys.
4. Register the four models in the target's `models/index.js`; fix the
   `Lead`/`User` associations (§6a).
5. Add and run the §5 migration.
6. Replace `analysisJob.js` with the §7 version (drops NPF + lead coupling).
7. Trim `queues/index.js` and `worker.js` to transcription+analysis (§8).
8. Mount the trimmed `calls.routes.js`; swap in the target's auth middleware.
9. Start the worker (inline or standalone) and confirm Redis connectivity.
10. Smoke-test (§10).

---

## 10. Testing the integration

**Without an OpenAI key (stub mode)** — verifies wiring end-to-end:

```bash
# upload a small audio file as a "mobile" call
curl -X POST http://localhost:3000/api/v1/calls/upload-recording \
  -H "Authorization: Bearer <token>" \
  -F "recording=@sample.m4a" \
  -F "to_number=+919999999999" \
  -F "duration_seconds=42" \
  -F "client_call_id=test-001"
# → 201 { data: { id, recording: { status: 'archived' } } }

# poll the call until transcript+analysis complete
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/calls/<id>
# → analysis.status: 'completed', transcript.status: 'completed' (stub text/scores)
```

You should see `call_logs`, `call_recordings (archived)`, `call_transcripts
(completed)` and one `call_analysis (completed)` row. Re-running the same
`client_call_id` must **not** create a duplicate (idempotency). Set a real
`OPENAI_API_KEY` to get genuine Whisper transcripts + GPT analysis.

`retry-transcription` re-runs the pipeline on the stored audio with no
re-upload:

```bash
curl -X POST http://localhost:3000/api/v1/calls/<id>/retry-transcription \
  -H "Authorization: Bearer <token>"
```

---

## 11. Gotchas

- **BullMQ Redis option.** `maxRetriesPerRequest: null` on the queue connection
  is mandatory — without it BullMQ throws on startup.
- **ffmpeg.** `ensureWhisperCompatible` always transcodes to mono 16 kHz mp3
  because mobile uploads often carry a misleading extension (real bytes are
  opus/amr/aac). It relies on the bundled `ffmpeg-static` binary — ensure it's
  installed and executable in the deploy image.
- **Audio formats.** Whisper rejects amr/3gp/aac/opus; the transcode step fixes
  this. Keep `audioTranscode.js` even if you "only get mp3s".
- **Duration reconciliation.** The transcription job overwrites
  `duration_seconds`/`talk_time_seconds` from the measured audio length when the
  client-reported value is off by >2s — expected behaviour.
- **One report per call.** `call_analysis.call_id` is UNIQUE; the jobs use
  `findOrCreate`, so retries update rather than duplicate.
- **Stub mode is silent.** No `OPENAI_API_KEY` ⇒ placeholder transcript/scores
  with `model: 'stub'`. Good for CI; don't mistake it for real output.
- **S3 credentials.** Leave `AWS_ACCESS_KEY_ID`/`SECRET` empty to use the
  instance IAM role — passing empty strings breaks the AWS default credential
  chain (the code already guards this).

---

*Source of truth for the full system is [`docs/DEVELOPMENT.md`](DEVELOPMENT.md);
the call AI pipeline section there explains the in-place architecture.*
