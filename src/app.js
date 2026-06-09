'use strict';

require('module-alias/register');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const expressLayouts = require('express-ejs-layouts');

const config = require('./config');
const logger = require('./utils/logger');
const { apiLimiter } = require('./middlewares/rateLimiter');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const apiV1 = require('./routes/api/v1');
const webRoutes = require('./routes/web');

const app = express();

// Trust the reverse proxy (Nginx) so req.ip / secure cookies work.
app.set('trust proxy', 1);

// ---- View engine (EJS + layouts) ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/app');

// ---- Security & parsing ----
app.use(
  helmet({
    contentSecurityPolicy: false, // relaxed for CDN Tailwind/Alpine/Chart.js in dev
    crossOriginEmbedderPolicy: false,
  })
);
app.use(
  cors({
    origin: config.app.corsOrigins.includes('*') ? true : config.app.corsOrigins,
    credentials: true,
  })
);
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(morgan(config.isProd ? 'combined' : 'dev', { stream: { write: (m) => logger.http && logger.http(m.trim()) } }));

// ---- Static assets ----
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

// ---- API ----
app.use('/api/v1', apiLimiter, apiV1);

// ---- Server-rendered web app ----
app.use('/', webRoutes);

// ---- Error handling ----
app.use(notFound);
app.use(errorHandler);

module.exports = app;
