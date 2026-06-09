'use strict';

/**
 * Standalone worker process (run via `npm run worker` or its own PM2 app).
 * Hosts all BullMQ consumers so heavy AI/IO work runs off the web dynos.
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

async function start() {
  await connectDatabase();
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

  logger.info(`Worker started — listening on: ${Object.keys(processors).join(', ')}`);

  const shutdown = async () => {
    logger.info('Worker shutting down...');
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  logger.error(`Worker failed to start: ${err.message}`);
  process.exit(1);
});
