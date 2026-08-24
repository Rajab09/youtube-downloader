# YouTube Downloader (Downly)

A premium, dark-themed web app for analyzing and downloading YouTube videos that you own or are explicitly authorized to download. Built with vanilla HTML/CSS/JS on the frontend and Node.js + Express on the backend.

> **Legal notice:** This tool does not bypass DRM, authentication, paywalls, or any YouTube access controls. It only processes publicly accessible video streams and requires the user to confirm they own or are authorized to download the content before every analysis and download request. You are solely responsible for ensuring you have the right to download any content you process with this tool.

## Features

- Paste a YouTube URL and analyze it for authorized formats and qualities
- Download MP4 (multiple qualities) and MP3 (audio) where available
- Live progress tracking (percentage, bytes transferred, ETA)
- Automatic temporary file cleanup after every download
- Rate limiting, CORS, Helmet security headers, input validation, concurrency limits
- Fully responsive, accessible, glassmorphism UI

## Project Structure

```text
youtube-downloader/
├── public/               # Frontend (HTML/CSS/JS)
├── server/
│   ├── server.js         # App entry point
│   ├── config.js         # Centralized env-driven configuration
│   ├── routes/            # Express routes
│   ├── services/          # Video analysis, download, job tracking
│   ├── middleware/         # Security (helmet, cors, rate limiting)
│   └── utils/             # Temp file cleanup
├── downloads/            # Temporary file storage (auto-cleaned)
├── .env.example
└── package.json
```

## 1. Install dependencies

```bash
npm install
```

This installs Express, `@distube/ytdl-core`, `fluent-ffmpeg` + `ffmpeg-static` (bundled ffmpeg binary, no system install required), Helmet, CORS, rate limiting, and dev tooling (`nodemon`).

## 2. Configure environment variables

Copy the example file and adjust as needed:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | `development` or `production` | `development` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | `http://localhost:3000` |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | General API rate limiting | 15 min / 100 |
| `DOWNLOAD_RATE_LIMIT_WINDOW_MS` / `DOWNLOAD_RATE_LIMIT_MAX` | Analyze/download rate limiting | 15 min / 10 |
| `DOWNLOADS_DIR` | Temp file directory | `downloads` |
| `MAX_FILE_SIZE_BYTES` | Max allowed file size | `500MB` |
| `MAX_CONCURRENT_DOWNLOADS` | Global concurrent download cap | `3` |
| `DOWNLOAD_TIMEOUT_MS` | Max time per download job | `10 min` |
| `FILE_RETENTION_MS` | How long a finished file may sit before forced cleanup | `15 min` |
| `CLEANUP_INTERVAL_MS` | How often the cleanup sweep runs | `5 min` |

## 3. Run in development

```bash
npm run dev
```

Uses `nodemon` to restart on file changes.

## 4. Run in production

```bash
npm start
```

Set `NODE_ENV=production` and a real `ALLOWED_ORIGINS` value in `.env` first.

## 5. Changing the port

Set `PORT` in `.env`, or run with an inline override:

```bash
PORT=4000 npm start
```

## 6. Open the app

```
http://localhost:3000
```

## How temporary files are cleaned up

- Every completed download is streamed to the browser via `res.download()`; the temp file is deleted from disk immediately after the transfer finishes (success or failure).
- A background sweep (`CLEANUP_INTERVAL_MS`) removes any orphaned files in `downloads/` older than `FILE_RETENTION_MS`, and prunes stale in-memory job records.
- Intermediate files created for audio/video muxing (adaptive quality merges, MP3 conversion) are deleted right after processing, regardless of success or failure.

## Limitations

- Only public, non-live, non-age-restricted, non-private YouTube videos can be analyzed. Private, region-restricted, or age-gated videos are rejected with a clear error — this app does not attempt to authenticate as a user or bypass any restriction.
- 1080p (and any quality without a combined audio+video stream) is produced by merging YouTube's separate video-only and audio-only streams with ffmpeg — both streams are still fetched from the same publicly served, unauthenticated endpoints as the video player itself, no protections are circumvented.
- MP3 export is a local ffmpeg re-encode of the best available public audio stream, not a "hidden" format extracted from YouTube.
- The app cannot verify real-world ownership/authorization of content — it relies on the user's explicit confirmation checkbox, which is required on every analyze and download request. You must have the legal right to download any content you process.
- Availability of specific formats/qualities depends entirely on what YouTube publicly serves for a given video at request time.

## Tech Stack

- **Frontend:** HTML5, CSS3 (custom, no framework), vanilla JavaScript
- **Backend:** Node.js, Express
- **Video processing:** `@distube/ytdl-core`, `fluent-ffmpeg` + `ffmpeg-static`
- **Security:** Helmet, CORS allowlist, `express-rate-limit`, strict input validation, request size limits, concurrency guard
