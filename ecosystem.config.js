// PM2 process configuration for non-containerised (VM) deployments.
// Runs the web server in cluster mode and the queue worker as a fork.
module.exports = {
  apps: [
    {
      name: 'crm-web',
      script: 'src/server.js',
      instances: process.env.WEB_INSTANCES || 'max',
      exec_mode: 'cluster',
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production' },
      error_file: 'logs/web-error.log',
      out_file: 'logs/web-out.log',
      merge_logs: true,
    },
    {
      name: 'crm-worker',
      script: 'src/queues/worker.js',
      instances: process.env.WORKER_INSTANCES || 2,
      exec_mode: 'fork',
      max_memory_restart: '800M',
      env: { NODE_ENV: 'production' },
      error_file: 'logs/worker-error.log',
      out_file: 'logs/worker-out.log',
      merge_logs: true,
    },
  ],
};
