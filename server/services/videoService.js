const { getVideoInfo, YtDlpError } = require('./ytdlpRunner');

const YOUTUBE_URL_PATTERN =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{6,}/i;

const QUALITY_LADDER = [1080, 720, 480, 360];

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
  const text = `${(err && err.message) || ''} ${(err && err.stderr) || ''}`;

  if (/private video/i.test(text)) {
    return new VideoServiceError(
      'This video is private and cannot be processed.',
      'PRIVATE_VIDEO',
      403
    );
  }
  if (/video (is )?unavailable|no longer available|has been removed/i.test(text)) {
    return new VideoServiceError(
      'This video is unavailable. It may have been removed.',
      'VIDEO_UNAVAILABLE',
      404
    );
  }
  if (/sign in to confirm your age|age[- ]restrict/i.test(text)) {
    return new VideoServiceError(
      'This video is age-restricted and cannot be processed without authentication, which this service does not perform.',
      'AGE_RESTRICTED',
      403
    );
  }
  if (/not available in your country|blocked it in your country|geo.?restrict/i.test(text)) {
    return new VideoServiceError(
      'This video is region-restricted and is not available for processing.',
      'REGION_RESTRICTED',
      403
    );
  }
  if (/copyright|blocked/i.test(text)) {
    return new VideoServiceError(
      'This video is not authorized for download due to content restrictions.',
      'NOT_AUTHORIZED',
      403
    );
  }
  if (/premieres in|live event will begin|is live/i.test(text)) {
    return new VideoServiceError(
      'Live streams cannot be processed by this service.',
      'LIVE_UNSUPPORTED',
      422
    );
  }
  if (/not installed or not found/i.test(text)) {
    return new VideoServiceError(
      'The video processing engine is not available on the server. Please contact the administrator.',
      'ENGINE_MISSING',
      500
    );
  }
  return new VideoServiceError(
    'YouTube is temporarily blocking automated access to this video’s streams. This is a known, evolving restriction on YouTube’s side (not something this app bypasses) — please try again later.',
    'UPSTREAM_UNAVAILABLE',
    502
  );
}

async function fetchVideoInfo(rawUrl) {
  if (!isSyntacticallyValidUrl(rawUrl)) {
    throw new VideoServiceError('Please provide a valid YouTube video URL.', 'INVALID_URL', 400);
  }

  const url = normalizeUrl(rawUrl);

  let info;
  try {
    info = await getVideoInfo(url);
  } catch (err) {
    if (err instanceof YtDlpError) throw mapKnownError(err);
    throw err;
  }

  if (info.is_live) {
    throw new VideoServiceError(
      'Live streams cannot be processed by this service.',
      'LIVE_UNSUPPORTED',
      422
    );
  }
  if (info.availability === 'private') {
    throw new VideoServiceError('This video is private and cannot be processed.', 'PRIVATE_VIDEO', 403);
  }
  if (info.availability && ['needs_auth', 'premium_only', 'subscriber_only'].includes(info.availability)) {
    throw new VideoServiceError(
      'This video requires authentication and cannot be processed without bypassing access controls, which this service does not do.',
      'NOT_AUTHORIZED',
      403
    );
  }

  return info;
}

function usableFormats(info) {
  return (info.formats || []).filter(
    (f) => f.protocol !== 'mhtml' && (f.vcodec !== 'none' || f.acodec !== 'none')
  );
}

function buildAvailableFormats(info) {
  const formats = usableFormats(info);

  const videoFormats = formats.filter((f) => f.vcodec && f.vcodec !== 'none' && f.height);
  const audioFormats = formats
    .filter((f) => (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none')
    .sort((a, b) => (b.abr || 0) - (a.abr || 0));

  const qualities = [];
  for (const height of QUALITY_LADDER) {
    const hasHeight = videoFormats.some((f) => f.height === height);
    if (hasHeight) {
      qualities.push({ label: `${height}p`, height });
    }
  }

  const audioAvailable = audioFormats.length > 0 || videoFormats.length > 0;

  return { qualities, audioAvailable };
}

function toPublicMetadata(info) {
  const { qualities, audioAvailable } = buildAvailableFormats(info);

  if (qualities.length === 0 && !audioAvailable) {
    throw new VideoServiceError(
      'No authorized downloadable formats were found for this video.',
      'NO_FORMATS',
      422
    );
  }

  return {
    id: info.id,
    title: info.title,
    channel: info.uploader || info.channel || 'Unknown channel',
    thumbnail: info.thumbnail || null,
    durationSeconds: Math.round(info.duration || 0),
    qualities: qualities.map((q) => ({ label: q.label, approxSizeBytes: null })),
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
