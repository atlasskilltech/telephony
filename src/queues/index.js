'use strict';

const { Queue } = require('bullmq');
const { bullConnection } = require('../config/redis');
const { QUEUES } = require('../utils/constants');

/**
 * Central registry of BullMQ producer queues. Workers consuming these live
 * in ./worker.js and ./jobs/*. Default job options give every queue
 * retry-with-backoff and automatic cleanup of completed jobs.
 */
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 },
};

function makeQueue(name) {
  return new Queue(name, { connection: bullConnection, defaultJobOptions });
}

const transcriptionQueue = makeQueue(QUEUES.TRANSCRIPTION);
const analysisQueue = makeQueue(QUEUES.ANALYSIS);
const qaAuditQueue = makeQueue(QUEUES.QA_AUDIT);
const notificationQueue = makeQueue(QUEUES.NOTIFICATION);
const importQueue = makeQueue(QUEUES.IMPORT);
const whatsappQueue = makeQueue(QUEUES.WHATSAPP);
const emailQueue = makeQueue(QUEUES.EMAIL);

module.exports = {
  transcriptionQueue,
  analysisQueue,
  qaAuditQueue,
  notificationQueue,
  importQueue,
  whatsappQueue,
  emailQueue,
  queues: {
    transcriptionQueue,
    analysisQueue,
    qaAuditQueue,
    notificationQueue,
    importQueue,
    whatsappQueue,
    emailQueue,
  },
};
