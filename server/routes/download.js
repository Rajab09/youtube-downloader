const express = require('express');
const fs = require('fs');

const {
  analyzeLimiter,
  downloadLimiter,
  concurrencyGuard,
  acquireSlot,
  releaseSlot,
} = require('../middleware/security');
const { fetchVideoInfo, toPublicMetadata, VideoServiceError } = require('../services/videoService');
const { createJob, getJob, deleteJob } = require('../services/jobManager');
const { runDownloadJob } = require('../services/downloadService');
const { deleteFileQuietly } = require('../utils/cleanup');

const router = express.Router();

const ALLOWED_FORMATS = new Set(['mp4', 'mp3']);
const ALLOWED_QUALITIES = new Set(['1080p', '720p', '480p', '360p']);

function requireAuthorization(req, res, next) {
  if (req.body.authorizationConfirmed !== true) {
    return res.status(400).json({
      error:
        'You must confirm that you own this content or are authorized to download it before continuing.',
    });
  }
  next();
}

function handleServiceError(err, res, next) {
  if (err instanceof VideoServiceError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  return next(err);
}

router.post('/analyze', analyzeLimiter, requireAuthorization, async (req, res, next) => {
  try {
    const { url } = req.body;
    if (typeof url !== 'string' || url.length > 2048) {
      return res.status(400).json({ error: 'A valid YouTube URL is required.' });
    }

    const info = await fetchVideoInfo(url);
    const metadata = toPublicMetadata(info);
    res.json({ video: metadata });
  } catch (err) {
    handleServiceError(err, res, next);
  }
});

router.post(
  '/download',
  downloadLimiter,
  concurrencyGuard,
  requireAuthorization,
  async (req, res, next) => {
    try {
      const { url, format, quality } = req.body;

      if (typeof url !== 'string' || url.length > 2048) {
        return res.status(400).json({ error: 'A valid YouTube URL is required.' });
      }
      if (!ALLOWED_FORMATS.has(format)) {
        return res.status(400).json({ error: 'Unsupported format requested.' });
      }
      if (format === 'mp4' && !ALLOWED_QUALITIES.has(quality)) {
        return res.status(400).json({ error: 'Unsupported quality requested.' });
      }

      const job = createJob();
      acquireSlot();

      runDownloadJob(job.id, { url, format, quality }).finally(() => {
        releaseSlot();
      });

      res.status(202).json({ jobId: job.id });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/download/:jobId/status', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Download job not found or has expired.' });
  }

  res.json({
    status: job.status,
    progress: job.progress,
    downloadedBytes: job.downloadedBytes,
    totalBytes: job.totalBytes,
    error: job.error,
    ready: job.status === 'complete',
  });
});

router.get('/download/:jobId/file', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.status !== 'complete' || !job.filePath) {
    return res.status(404).json({ error: 'File is not ready or the job has expired.' });
  }

  res.download(job.filePath, job.fileName, (err) => {
    deleteFileQuietly(job.filePath);
    deleteJob(job.id);
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Failed to send the file.' });
    }
  });
});

module.exports = router;
