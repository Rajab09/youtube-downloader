const path = require('path');

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  port: toInt(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  rateLimit: {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: toInt(process.env.RATE_LIMIT_MAX, 100),
  },
  downloadRateLimit: {
    windowMs: toInt(process.env.DOWNLOAD_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: toInt(process.env.DOWNLOAD_RATE_LIMIT_MAX, 10),
  },
  downloadsDir: path.resolve(__dirname, '..', process.env.DOWNLOADS_DIR || 'downloads'),
  maxFileSizeBytes: toInt(process.env.MAX_FILE_SIZE_BYTES, 500 * 1024 * 1024),
  maxConcurrentDownloads: toInt(process.env.MAX_CONCURRENT_DOWNLOADS, 3),
  downloadTimeoutMs: toInt(process.env.DOWNLOAD_TIMEOUT_MS, 10 * 60 * 1000),
  fileRetentionMs: toInt(process.env.FILE_RETENTION_MS, 15 * 60 * 1000),
  cleanupIntervalMs: toInt(process.env.CLEANUP_INTERVAL_MS, 5 * 60 * 1000),
};
