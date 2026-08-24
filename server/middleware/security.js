const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config');

const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

// Wrapped as a per-request middleware (rather than a static `cors()` instance) so we can
// always allow the app's own origin — e.g. the exact host Render/Heroku/etc. assigns at
// deploy time — without requiring ALLOWED_ORIGINS to be manually kept in sync for the
// common case where the frontend and API are served from the same deployment.
function corsMiddleware(req, res, next) {
  const selfOrigin = `${req.protocol}://${req.get('host')}`;

  return cors({
    origin(origin, callback) {
      if (!origin || origin === selfOrigin || config.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS policy'));
    },
    methods: ['GET', 'POST'],
    credentials: false,
  })(req, res, next);
}

const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

const analyzeLimiter = rateLimit({
  windowMs: config.downloadRateLimit.windowMs,
  max: config.downloadRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many analysis requests. Please slow down and try again later.' },
});

const downloadLimiter = rateLimit({
  windowMs: config.downloadRateLimit.windowMs,
  max: config.downloadRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many download requests. Please slow down and try again later.' },
});

// Tracks how many downloads are actively processing to enforce a global concurrency cap.
let activeDownloads = 0;

function concurrencyGuard(req, res, next) {
  if (activeDownloads >= config.maxConcurrentDownloads) {
    return res.status(503).json({
      error: 'The server is at capacity. Please try again in a moment.',
    });
  }
  next();
}

function acquireSlot() {
  activeDownloads += 1;
}

function releaseSlot() {
  activeDownloads = Math.max(0, activeDownloads - 1);
}

module.exports = {
  helmetMiddleware,
  corsMiddleware,
  generalLimiter,
  analyzeLimiter,
  downloadLimiter,
  concurrencyGuard,
  acquireSlot,
  releaseSlot,
};
