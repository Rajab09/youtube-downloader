require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const morgan = require('morgan');

const config = require('./config');
const { helmetMiddleware, corsMiddleware, generalLimiter } = require('./middleware/security');
const downloadRoutes = require('./routes/download');
const { startCleanupScheduler } = require('./utils/cleanup');

fs.mkdirSync(config.downloadsDir, { recursive: true });

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10kb' }));

app.use('/api', generalLimiter, downloadRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Centralized error handler: never leak internals to the client.
app.use((err, req, res, next) => {
  if (config.nodeEnv !== 'production') {
    console.error(err);
  }
  if (err.message === 'Not allowed by CORS policy') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  res.status(500).json({ error: 'An unexpected server error occurred. Please try again later.' });
});

const server = app.listen(config.port, () => {
  console.log(`YouTube Downloader server running on http://localhost:${config.port}`);
});

const cleanupTimer = startCleanupScheduler();

function shutdown() {
  clearInterval(cleanupTimer);
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
