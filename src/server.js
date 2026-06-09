'use strict';

require('module-alias/register');
const http = require('http');
const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { connectDatabase } = require('./config/database');
const { initSocket } = require('./sockets');
const { startScheduler } = require('./queues/scheduler');
const { startWorkers } = require('./queues/worker');

async function bootstrap() {
  await connectDatabase();

  const server = http.createServer(app);
  initSocket(server);
  startScheduler();

  // Run the queue consumers in-process unless a dedicated worker is used, so a
  // single `npm start` handles transcription/analysis with no separate worker.
  if (config.queue.inlineWorkers) {
    startWorkers();
    logger.info('Inline queue workers enabled (INLINE_WORKERS=true).');
  }

  server.listen(config.app.port, () => {
    logger.info(`${config.app.name} running on port ${config.app.port} [${config.env}]`);
  });

  // Graceful shutdown so in-flight requests finish and connections close.
  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error(`Unhandled rejection: ${reason}`));
}

bootstrap().catch((err) => {
  logger.error(`Failed to start server: ${err.message}\n${err.stack}`);
  process.exit(1);
});
