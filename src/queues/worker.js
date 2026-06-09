'use strict';

/**
 * BullMQ consumers for the heavy AI/IO work (transcription, analysis,
 * notifications, email, whatsapp). These can run either:
 *   - in their own process via `npm run worker` (this file's main entry), or
 *   - inside the web process (server.js calls `startWorkers`) when
 *     INLINE_WORKERS=true (the default) so no separate worker is required.
 */
require('module-alias/register');
const { Worker, QueueScheduler } = require('bullmq');
const { bullConnection } = require('../config/redis');
const { connectDatabase } = require('../config/database');
const { QUEUES } = require('../utils/constants');
const logger = require('../utils/logger');

const transcriptionJob = require('./jobs/transcriptionJob');
const analysisJob = require('./jobs/analysisJob');
const notificationJob = require('./jobs/notificationJob');
const emailJob = require('./jobs/emailJob');
const whatsappJob = require('./jobs/whatsappJob');

const processors = {
  [QUEUES.TRANSCRIPTION]: { handler: transcriptionJob, concurrency: 3 },
  [QUEUES.ANALYSIS]: { handler: analysisJob, concurrency: 5 },
  [QUEUES.QA_AUDIT]: { handler: analysisJob, concurrency: 3 },
  [QUEUES.NOTIFICATION]: { handler: notificationJob, concurrency: 20 },
  [QUEUES.EMAIL]: { handler: emailJob, concurrency: 10 },
  [QUEUES.WHATSAPP]: { handler: whatsappJob, concurrency: 10 },
};

/**
 * Create and return the BullMQ workers. Safe to call from the web process:
 * it does NOT connect the database (the caller already has) or register
 * process signal handlers.
 */
function startWorkers() {
  const workers = [];

  for (const [name, { handler, concurrency }] of Object.entries(processors)) {
    // QueueScheduler manages delayed/retried jobs (no-op on newer BullMQ, kept for safety).
    if (typeof QueueScheduler === 'function') {
      try {
        // eslint-disable-next-line no-new
        new QueueScheduler(name, { connection: bullConnection });
      } catch (e) {
        /* QueueScheduler removed in BullMQ v5+ — retries handled by Worker */
      }
    }

    const worker = new Worker(name, async (job) => handler(job), {
      connection: bullConnection,
      concurrency,
    });
    worker.on('completed', (job) => logger.debug(`[${name}] job ${job.id} completed`));
    worker.on('failed', (job, err) =>
      logger.error(`[${name}] job ${job?.id} failed: ${err.message}`)
    );
    workers.push(worker);
  }

  logger.info(`Queue workers listening on: ${Object.keys(processors).join(', ')}`);
  return workers;
}

/** Standalone entry: connect the DB, start workers, handle shutdown signals. */
async function startStandalone() {
  await connectDatabase();
  const workers = startWorkers();

  const shutdown = async () => {
    logger.info('Worker shutting down...');
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { startWorkers, processors };

// Auto-start only when run directly (`node src/queues/worker.js`), not when
// required by the web process for inline workers.
if (require.main === module) {
  startStandalone().catch((err) => {
    logger.error(`Worker failed to start: ${err.message}`);
    process.exit(1);
  });
}
