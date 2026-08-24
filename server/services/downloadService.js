const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

const config = require('../config');
const { updateJob } = require('./jobManager');
const { fetchVideoInfo, buildAvailableFormats, VideoServiceError } = require('./videoService');

ffmpeg.setFfmpegPath(ffmpegPath);

function sanitizeFilenameFragment(name) {
  return (name || 'video')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 80) || 'video';
}

function tempFilePath(ext) {
  return path.join(config.downloadsDir, `${uuidv4()}.${ext}`);
}

function withTimeout(jobId, ms) {
  return setTimeout(() => {
    updateJob(jobId, {
      status: 'error',
      error: 'Processing timed out. Please try again with a shorter video or lower quality.',
    });
  }, ms);
}

function pipeWithProgress(readable, writable, jobId, weightStart, weightEnd) {
  return new Promise((resolve, reject) => {
    let downloaded = 0;
    let total = 0;

    readable.on('progress', (chunkLength, downloadedBytes, totalBytes) => {
      downloaded = downloadedBytes;
      total = totalBytes;
      const pct = total ? downloaded / total : 0;
      const overall = weightStart + pct * (weightEnd - weightStart);
      updateJob(jobId, {
        status: 'downloading',
        progress: Math.round(overall * 100),
        downloadedBytes: downloaded,
        totalBytes: total,
      });
    });

    readable.on('error', reject);
    writable.on('error', reject);
    writable.on('finish', resolve);

    readable.pipe(writable);
  });
}

async function assertWithinSizeLimit(bytes) {
  if (bytes && bytes > config.maxFileSizeBytes) {
    throw new VideoServiceError(
      'The requested file exceeds the maximum allowed download size.',
      'FILE_TOO_LARGE',
      413
    );
  }
}

async function runDownloadJob(jobId, { url, format, quality }) {
  const timeoutHandle = withTimeout(jobId, config.downloadTimeoutMs);
  const cleanupPaths = [];

  try {
    const info = await fetchVideoInfo(url);
    const { qualities, bestAudioItag } = buildAvailableFormats(info);
    const safeTitle = sanitizeFilenameFragment(info.videoDetails.title);

    updateJob(jobId, { status: 'preparing', progress: 5 });

    if (format === 'mp3') {
      if (!bestAudioItag) {
        throw new VideoServiceError('No authorized audio track is available.', 'NO_AUDIO', 422);
      }
      const audioFormat = info.formats.find((f) => f.itag === bestAudioItag);
      await assertWithinSizeLimit(audioFormat ? Number(audioFormat.contentLength) : 0);

      const rawAudioPath = tempFilePath('audio-src');
      cleanupPaths.push(rawAudioPath);
      const audioStream = ytdl.downloadFromInfo(info, { quality: bestAudioItag });
      await pipeWithProgress(audioStream, fs.createWriteStream(rawAudioPath), jobId, 0.05, 0.55);

      const outputPath = tempFilePath('mp3');
      updateJob(jobId, { status: 'converting', progress: 60 });
      await convertToMp3(rawAudioPath, outputPath, jobId);

      updateJob(jobId, {
        status: 'complete',
        progress: 100,
        filePath: outputPath,
        fileName: `${safeTitle}.mp3`,
        completedAt: Date.now(),
      });
      return;
    }

    // MP4 video path
    const target = qualities.find((q) => q.label === quality) || qualities[0];
    if (!target) {
      throw new VideoServiceError('No authorized video formats are available.', 'NO_FORMATS', 422);
    }

    if (target.mode === 'progressive') {
      await assertWithinSizeLimit(target.approxSizeBytes);
      const outputPath = tempFilePath('mp4');
      const stream = ytdl.downloadFromInfo(info, { quality: target.itag });
      await pipeWithProgress(stream, fs.createWriteStream(outputPath), jobId, 0.05, 0.95);

      updateJob(jobId, {
        status: 'complete',
        progress: 100,
        filePath: outputPath,
        fileName: `${safeTitle}-${quality}.mp4`,
        completedAt: Date.now(),
      });
      return;
    }

    // Adaptive: separate video-only and audio-only streams, merged via ffmpeg
    await assertWithinSizeLimit(target.approxSizeBytes);

    const rawVideoPath = tempFilePath('video-src');
    const rawAudioPath = tempFilePath('audio-src');
    cleanupPaths.push(rawVideoPath, rawAudioPath);

    const videoStream = ytdl.downloadFromInfo(info, { quality: target.videoItag });
    await pipeWithProgress(videoStream, fs.createWriteStream(rawVideoPath), jobId, 0.05, 0.5);

    const audioStream = ytdl.downloadFromInfo(info, { quality: target.audioItag });
    await pipeWithProgress(audioStream, fs.createWriteStream(rawAudioPath), jobId, 0.5, 0.75);

    const outputPath = tempFilePath('mp4');
    updateJob(jobId, { status: 'converting', progress: 80 });
    await muxAudioVideo(rawVideoPath, rawAudioPath, outputPath, jobId);

    updateJob(jobId, {
      status: 'complete',
      progress: 100,
      filePath: outputPath,
      fileName: `${safeTitle}-${quality}.mp4`,
      completedAt: Date.now(),
    });
  } catch (err) {
    const friendly =
      err instanceof VideoServiceError
        ? err.message
        : 'An unexpected error occurred while processing your download.';
    updateJob(jobId, { status: 'error', error: friendly });
  } finally {
    clearTimeout(timeoutHandle);
    for (const p of cleanupPaths) {
      fs.promises.unlink(p).catch(() => {});
    }
  }
}

function convertToMp3(inputPath, outputPath, jobId) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('libmp3lame')
      .audioBitrate(192)
      .format('mp3')
      .on('progress', (p) => {
        const pct = Math.min(99, Math.round(60 + (p.percent || 0) * 0.4));
        updateJob(jobId, { status: 'converting', progress: pct });
      })
      .on('error', reject)
      .on('end', resolve)
      .save(outputPath);
  });
}

function muxAudioVideo(videoPath, audioPath, outputPath, jobId) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .videoCodec('copy')
      .audioCodec('aac')
      .outputOptions('-shortest')
      .on('progress', (p) => {
        const pct = Math.min(99, Math.round(80 + (p.percent || 0) * 0.19));
        updateJob(jobId, { status: 'converting', progress: pct });
      })
      .on('error', reject)
      .on('end', resolve)
      .save(outputPath);
  });
}

module.exports = { runDownloadJob };
