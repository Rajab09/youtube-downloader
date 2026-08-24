// Ensures a working yt-dlp binary is available. On Linux (e.g. Render's build
// environment) it downloads the standalone, dependency-free release binary into
// ./bin/yt-dlp. On other platforms it assumes yt-dlp is already installed and
// reachable on PATH (e.g. via `pip install yt-dlp` or `brew install yt-dlp`),
// since developer machines commonly already have it and re-downloading an
// unsigned binary can trigger OS gatekeeping prompts.

const fs = require('fs');
const path = require('path');
const https = require('https');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const BIN_PATH = path.join(BIN_DIR, 'yt-dlp');
const DOWNLOAD_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

function download(url, destination, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    https
      .get(url, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          file.close();
          fs.unlinkSync(destination);
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
          return resolve(download(res.headers.location, destination, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destination);
          return reject(new Error(`Download failed with status ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', (err) => {
        file.close();
        fs.rmSync(destination, { force: true });
        reject(err);
      });
  });
}

async function main() {
  if (process.platform !== 'linux') {
    console.log('[install-ytdlp] Non-Linux platform detected — skipping binary download.');
    console.log('[install-ytdlp] Make sure yt-dlp is installed and on PATH (e.g. `pip install yt-dlp`).');
    return;
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });

  if (fs.existsSync(BIN_PATH)) {
    console.log('[install-ytdlp] yt-dlp binary already present, skipping download.');
    return;
  }

  console.log('[install-ytdlp] Downloading yt-dlp standalone Linux binary...');
  try {
    await download(DOWNLOAD_URL, BIN_PATH);
    fs.chmodSync(BIN_PATH, 0o755);
    console.log('[install-ytdlp] Done.');
  } catch (err) {
    console.warn('[install-ytdlp] Failed to download yt-dlp:', err.message);
    console.warn('[install-ytdlp] The app will attempt to use a system-installed yt-dlp on PATH instead.');
  }
}

main();
