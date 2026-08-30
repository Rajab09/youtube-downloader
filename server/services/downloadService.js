const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const config = require('../config');
const { updateJob, getJob } = require('./jobManager');
const { fetchVideoInfo, VideoServiceError } = require('./videoService');
const { runDownload, YtDlpError } = require('./ytdlpRunner');

function sanitizeFilenameFragment(name) {
  return (
    (name || 'video')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim()
      .slice(0, 80) || 'video'
  );
}

function withTimeout(jobId, ms) {
  return setTimeout(() => {
    updateJob(jobId, {
      status: 'error',
      error: 'Processing timed out. Please try again with a shorter video or lower quality.',
    });
  }, ms);
}

function mapDownloadError(err) {
  if (err instanceof VideoServiceError) return err.message;
  if (err instanceof YtDlpError) {
    return 'Unable to download this video due to a restriction on YouTube’s side. Please try again later.';
  }
  return 'An unexpected error occurred while processing your download.';
}

async function runDownloadJob(jobId, { url, format, quality }) {
  const timeoutHandle = withTimeout(jobId, config.downloadTimeoutMs);

  try {
    const info = await fetchVideoInfo(url);
    const safeTitle = sanitizeFilenameFragment(info.title);

    updateJob(jobId, { status: 'preparing', progress: 5 });

    const uuid = uuidv4();
    const outputTemplate = path.join(config.downloadsDir, `${uuid}.%(ext)s`);

    let formatSelector;
    let postArgs;
    let finalExt;
    let fileName;

    if (format === 'mp3') {
      formatSelector = 'bestaudio/best';
      postArgs = ['-x', '--audio-format', 'mp3', '--audio-quality', '192K'];
      finalExt = 'mp3';
      fileName = `${safeTitle}.mp3`;
    } else {
      const height = parseInt(quality, 10);
      if (!Number.isFinite(height)) {
        throw new VideoServiceError('Unsupported quality requested.', 'INVALID_QUALITY', 400);
      }
      // Prefer H.264/AAC streams (widely playable) over VP9/AV1+Opus, which
      // yt-dlp otherwise remuxes into an .mp4 container that many players
      // (QuickTime, Preview, etc.) cannot decode despite the valid extension.
      formatSelector = `bestvideo[height<=${height}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=${height}][ext=mp4]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`;
      postArgs = ['--merge-output-format', 'mp4'];
      finalExt = 'mp4';
      fileName = `${safeTitle}-${quality}.mp4`;
    }

    postArgs.push('--max-filesize', String(config.maxFileSizeBytes));

    // yt-dlp reports video and audio streams as separate download phases, each
    // restarting from 0% — clamp so the progress bar never visibly moves backward.
    await runDownload(url, { formatSelector, outputTemplate, postArgs }, (progress) => {
      const current = getJob(jobId);
      const candidate = Math.min(97, Math.round(progress.percent * 0.95));
      const nextProgress = Math.max(current ? current.progress : 0, candidate);

      updateJob(jobId, {
        status: 'downloading',
        progress: nextProgress,
        downloadedBytes: progress.downloadedBytes,
        totalBytes: progress.totalBytes,
      });
    });

    const outputPath = path.join(config.downloadsDir, `${uuid}.${finalExt}`);
    if (!fs.existsSync(outputPath)) {
      throw new VideoServiceError(
        'Download completed but the output file could not be located.',
        'PROCESSING_ERROR',
        500
      );
    }

    updateJob(jobId, {
      status: 'complete',
      progress: 100,
      filePath: outputPath,
      fileName,
      completedAt: Date.now(),
    });
  } catch (err) {
    updateJob(jobId, { status: 'error', error: mapDownloadError(err) });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = { runDownloadJob };
