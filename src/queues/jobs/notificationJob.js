'use strict';

const notificationService = require('../../services/notificationService');

/**
 * Persists and pushes a notification. Runs in the worker so the request path
 * never waits on socket delivery or DB writes for notifications.
 */
module.exports = async function notificationJob(job) {
  const { userId, type, title, body, data } = job.data;
  await notificationService.notify({ userId, type, title, body, data });
  return { delivered: true };
};
