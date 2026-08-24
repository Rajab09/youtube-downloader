const ytdl = require('@distube/ytdl-core');
const config = require('../config');

const YOUTUBE_URL_PATTERN =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{6,}/i;

const QUALITY_LADDER = ['1080p', '720p', '480p', '360p'];

class VideoServiceError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'VideoServiceError';
    this.code = code;
    this.status = status;
  }
}

function isSyntacticallyValidUrl(url) {
  return typeof url === 'string' && YOUTUBE_URL_PATTERN.test(url.trim());
}

function normalizeUrl(url) {
  return url.trim();
}

function mapKnownError(err) {
  const message = (err && err.message) || '';

  if (/private video/i.test(message)) {
    return new VideoServiceError(
      'This video is private and cannot be processed.',
      'PRIVATE_VIDEO',
      403
    );
  }
  if (/video unavailable|no longer available/i.test(message)) {
    return new VideoServiceError(
      'This video is unavailable. It may have been removed.',
      'VIDEO_UNAVAILABLE',
      404
    );
  }
  if (/sign in to confirm your age|age[- ]restrict/i.test(message)) {
    return new VideoServiceError(
      'This video is age-restricted and cannot be processed without authentication, which this service does not perform.',
      'AGE_RESTRICTED',
      403
    );
  }
  if (/region|not available in your country/i.test(message)) {
    return new VideoServiceError(
      'This video is region-restricted and is not available for processing.',
      'REGION_RESTRICTED',
      403
    );
  }
  if (/copyright|blocked/i.test(message)) {
    return new VideoServiceError(
      'This video is not authorized for download due to content restrictions.',
      'NOT_AUTHORIZED',
      403
    );
  }
  if (
    /Could not extract functions|status code: 410|Status code: 429|Failed to find any playable formats|Status code: 400/i.test(
      message
    )
  ) {
    return new VideoServiceError(
      'YouTube is temporarily blocking automated access to this video’s streams. This is a known, evolving restriction on YouTube’s side (not something this app bypasses) — please try again later.',
      'UPSTREAM_UNAVAILABLE',
      502
    );
  }
  return new VideoServiceError(
    'Unable to process this video. Please verify the URL and try again.',
    'PROCESSING_ERROR',
    422
  );
}

async function fetchVideoInfo(rawUrl) {
  if (!isSyntacticallyValidUrl(rawUrl)) {
    throw new VideoServiceError('Please provide a valid YouTube video URL.', 'INVALID_URL', 400);
  }

  const url = normalizeUrl(rawUrl);

  if (!ytdl.validateURL(url)) {
    throw new VideoServiceError('Please provide a valid YouTube video URL.', 'INVALID_URL', 400);
  }

  let info;
  try {
    info = await ytdl.getBasicInfo(url);
  } catch (err) {
    throw mapKnownError(err);
  }

  if (info.videoDetails.isPrivate) {
    throw new VideoServiceError('This video is private and cannot be processed.', 'PRIVATE_VIDEO', 403);
  }
  if (info.videoDetails.isLiveContent) {
    throw new VideoServiceError(
      'Live streams cannot be processed by this service.',
      'LIVE_UNSUPPORTED',
      422
    );
  }

  let fullInfo;
  try {
    fullInfo = await ytdl.getInfo(url);
  } catch (err) {
    throw mapKnownError(err);
  }

  return fullInfo;
}

function buildAvailableFormats(info) {
  const formats = info.formats || [];

  const progressive = formats.filter(
    (f) => f.hasVideo && f.hasAudio && f.container === 'mp4' && f.qualityLabel
  );
  const adaptiveVideo = formats.filter(
    (f) => f.hasVideo && !f.hasAudio && f.container === 'mp4' && f.qualityLabel
  );
  const audioOnly = formats
    .filter((f) => f.hasAudio && !f.hasVideo)
    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));

  const qualities = [];
  for (const label of QUALITY_LADDER) {
    const prog = progressive.find((f) => f.qualityLabel === label);
    const adaptive = !prog && adaptiveVideo.find((f) => f.qualityLabel === label);
    if (prog) {
      qualities.push({
        label,
        mode: 'progressive',
        itag: prog.itag,
        approxSizeBytes: prog.contentLength ? Number(prog.contentLength) : null,
      });
    } else if (adaptive && audioOnly[0]) {
      qualities.push({
        label,
        mode: 'adaptive',
        videoItag: adaptive.itag,
        audioItag: audioOnly[0].itag,
        approxSizeBytes:
          (adaptive.contentLength ? Number(adaptive.contentLength) : 0) +
          (audioOnly[0].contentLength ? Number(audioOnly[0].contentLength) : 0) || null,
      });
    }
  }

  const audioAvailable = audioOnly.length > 0;

  return { qualities, audioAvailable, bestAudioItag: audioOnly[0] ? audioOnly[0].itag : null };
}

function toPublicMetadata(info) {
  const details = info.videoDetails;
  const { qualities, audioAvailable } = buildAvailableFormats(info);

  if (qualities.length === 0 && !audioAvailable) {
    throw new VideoServiceError(
      'No authorized downloadable formats were found for this video.',
      'NO_FORMATS',
      422
    );
  }

  return {
    id: details.videoId,
    title: details.title,
    channel: details.author ? details.author.name : 'Unknown channel',
    thumbnail:
      details.thumbnails && details.thumbnails.length
        ? details.thumbnails[details.thumbnails.length - 1].url
        : null,
    durationSeconds: Number(details.lengthSeconds) || 0,
    qualities: qualities.map((q) => ({
      label: q.label,
      approxSizeBytes: q.approxSizeBytes,
    })),
    formats: [
      { type: 'mp4', label: 'MP4 (Video)', available: qualities.length > 0 },
      { type: 'mp3', label: 'MP3 (Audio)', available: audioAvailable },
    ].filter((f) => f.available),
  };
}

module.exports = {
  VideoServiceError,
  isSyntacticallyValidUrl,
  fetchVideoInfo,
  buildAvailableFormats,
  toPublicMetadata,
};
