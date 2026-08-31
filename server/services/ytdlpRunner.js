const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const config = require('../config');

const LOCAL_BINARY = path.join(__dirname, '..', '..', 'bin', 'yt-dlp');

function cookiesArgs() {
  return config.cookiesPath ? ['--cookies', config.cookiesPath] : [];
}

function resolveBinaryPath() {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  if (fs.existsSync(LOCAL_BINARY)) return LOCAL_BINARY;
  return 'yt-dlp';
}

class YtDlpError extends Error {
  constructor(message, stderr) {
    super(message);
    this.name = 'YtDlpError';
    this.stderr = stderr || '';
  }
}

function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const bin = resolveBinaryPath();
    const child = spawn(bin, [
      '-j',
      '--no-warnings',
      '--no-playlist',
      '--no-call-home',
      '--socket-timeout',
      '20',
      '--ffmpeg-location',
      ffmpegPath,
      ...cookiesArgs(),
      '--',
      url,
    ]);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      reject(
        new YtDlpError(
          err.code === 'ENOENT'
            ? 'yt-dlp is not installed or not found on the server.'
            : err.message,
          stderr
        )
      );
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new YtDlpError('yt-dlp exited with an error.', stderr));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new YtDlpError('Failed to parse video information.', stderr));
      }
    });
  });
}

// Runs a download (and any ffmpeg merge/convert yt-dlp performs internally),
// invoking onProgress(percent) as lines are parsed from yt-dlp's stderr.
function runDownload(url, { formatSelector, outputTemplate, postArgs = [] }, onProgress) {
  return new Promise((resolve, reject) => {
    const bin = resolveBinaryPath();
    const args = [
      '--no-warnings',
      '--no-playlist',
      '--no-call-home',
      '--newline',
      '--socket-timeout',
      '20',
      '--ffmpeg-location',
      ffmpegPath,
      '-f',
      formatSelector,
      '-o',
      outputTemplate,
      ...postArgs,
      ...cookiesArgs(),
      '--',
      url,
    ];

    const child = spawn(bin, args);
    let stderr = '';

    const UNIT_MULTIPLIERS = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };
    const progressPattern = /\[download\]\s+([\d.]+)% of\s+~?([\d.]+)(KiB|MiB|GiB|B)/;

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const match = text.match(progressPattern);
      if (match) {
        const percent = parseFloat(match[1]);
        const totalBytes = parseFloat(match[2]) * (UNIT_MULTIPLIERS[match[3]] || 1);
        onProgress({ percent, totalBytes, downloadedBytes: Math.round((percent / 100) * totalBytes) });
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      reject(
        new YtDlpError(
          err.code === 'ENOENT'
            ? 'yt-dlp is not installed or not found on the server.'
            : err.message,
          stderr
        )
      );
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new YtDlpError('yt-dlp exited with an error.', stderr));
      }
      resolve();
    });
  });
}

module.exports = { getVideoInfo, runDownload, resolveBinaryPath, YtDlpError };
