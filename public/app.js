(() => {
  'use strict';

  const YOUTUBE_URL_PATTERN =
    /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{6,}/i;

  const els = {
    navToggle: document.getElementById('navToggle'),
    mainNav: document.getElementById('mainNav'),
    form: document.getElementById('analyzeForm'),
    urlInput: document.getElementById('urlInput'),
    authCheckbox: document.getElementById('authCheckbox'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    formHint: document.getElementById('formHint'),
    resultsSection: document.getElementById('resultsSection'),
    loadingState: document.getElementById('loadingState'),
    videoCard: document.getElementById('videoCard'),
    videoThumbnail: document.getElementById('videoThumbnail'),
    videoDuration: document.getElementById('videoDuration'),
    videoTitle: document.getElementById('videoTitle'),
    videoChannel: document.getElementById('videoChannel'),
    formatPills: document.getElementById('formatPills'),
    qualityPills: document.getElementById('qualityPills'),
    qualityGroup: document.getElementById('qualityGroup'),
    downloadBtn: document.getElementById('downloadBtn'),
    downloadPanel: document.getElementById('downloadPanel'),
    downloadStatusTitle: document.getElementById('downloadStatusTitle'),
    downloadStatusSub: document.getElementById('downloadStatusSub'),
    progressFill: document.getElementById('progressFill'),
    progressPercent: document.getElementById('progressPercent'),
    progressBytes: document.getElementById('progressBytes'),
    progressEta: document.getElementById('progressEta'),
    readyDownloadLink: document.getElementById('readyDownloadLink'),
    toastContainer: document.getElementById('toastContainer'),
  };

  let currentVideo = null;
  let selectedFormat = null;
  let selectedQuality = null;
  let isDownloading = false;
  let pollHandle = null;
  let downloadStartTime = null;

  // ---------- Utilities ----------

  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }

  function formatBytes(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i += 1;
    }
    return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    els.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4200);
  }

  function setFormHint(message) {
    els.formHint.textContent = message || '';
  }

  function setAnalyzing(active) {
    els.analyzeBtn.disabled = active;
    els.analyzeBtn.querySelector('.btn-spinner').hidden = !active;
    els.analyzeBtn.querySelector('.btn-label').textContent = active ? 'Analyzing…' : 'Analyze Video';
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  // ---------- Navigation ----------

  els.navToggle.addEventListener('click', () => {
    const open = els.mainNav.classList.toggle('open');
    els.navToggle.classList.toggle('open', open);
    els.navToggle.setAttribute('aria-expanded', String(open));
  });

  els.mainNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      els.mainNav.classList.remove('open');
      els.navToggle.classList.remove('open');
    });
  });

  // ---------- Analyze flow ----------

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormHint('');

    const url = els.urlInput.value.trim();

    if (!YOUTUBE_URL_PATTERN.test(url)) {
      setFormHint('Please enter a valid YouTube URL.');
      return;
    }

    if (!els.authCheckbox.checked) {
      setFormHint('Please confirm you own this content or are authorized to download it.');
      return;
    }

    resetResults();
    els.resultsSection.hidden = false;
    els.loadingState.hidden = false;
    setAnalyzing(true);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, authorizationConfirmed: true }),
      });

      const data = await safeJson(response);

      if (!response.ok) {
        throw new Error(data.error || 'Unable to analyze this video.');
      }

      currentVideo = data.video;
      renderVideoCard(currentVideo);
    } catch (err) {
      showToast(err.message, 'error');
      els.resultsSection.hidden = true;
    } finally {
      els.loadingState.hidden = true;
      setAnalyzing(false);
    }
  });

  function resetResults() {
    els.videoCard.hidden = true;
    els.downloadPanel.hidden = true;
    els.readyDownloadLink.hidden = true;
    els.downloadBtn.disabled = true;
    selectedFormat = null;
    selectedQuality = null;
    stopPolling();
  }

  function renderVideoCard(video) {
    els.videoThumbnail.src = video.thumbnail || '';
    els.videoThumbnail.alt = video.title;
    els.videoDuration.textContent = formatDuration(video.durationSeconds);
    els.videoTitle.textContent = video.title;
    els.videoChannel.textContent = video.channel;

    els.formatPills.innerHTML = '';
    video.formats.forEach((f, idx) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill';
      pill.textContent = f.label;
      pill.dataset.format = f.type;
      if (idx === 0) pill.classList.add('active');
      pill.addEventListener('click', () => selectFormat(f.type));
      els.formatPills.appendChild(pill);
    });

    renderQualityPills(video.qualities);

    if (video.formats.length) {
      selectFormat(video.formats[0].type);
    }

    els.videoCard.hidden = false;
  }

  function renderQualityPills(qualities) {
    els.qualityPills.innerHTML = '';
    qualities.forEach((q, idx) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill';
      pill.textContent = q.label;
      pill.dataset.quality = q.label;
      if (idx === 0) pill.classList.add('active');
      pill.addEventListener('click', () => selectQuality(q.label));
      els.qualityPills.appendChild(pill);
    });
    if (qualities.length) selectedQuality = qualities[0].label;
  }

  function selectFormat(type) {
    selectedFormat = type;
    els.formatPills.querySelectorAll('.pill').forEach((p) => {
      p.classList.toggle('active', p.dataset.format === type);
    });
    els.qualityGroup.hidden = type !== 'mp4';
    els.downloadBtn.disabled = false;
  }

  function selectQuality(label) {
    selectedQuality = label;
    els.qualityPills.querySelectorAll('.pill').forEach((p) => {
      p.classList.toggle('active', p.dataset.quality === label);
    });
  }

  // ---------- Download flow ----------

  els.downloadBtn.addEventListener('click', startDownload);

  async function startDownload() {
    if (isDownloading || !currentVideo || !selectedFormat) return;

    isDownloading = true;
    els.downloadBtn.disabled = true;
    els.downloadPanel.hidden = false;
    els.readyDownloadLink.hidden = true;
    els.progressFill.style.width = '0%';
    els.progressPercent.textContent = '0%';
    els.progressBytes.textContent = '';
    els.progressEta.textContent = '';
    setDownloadStatus('Preparing your download…', 'Setting things up');
    downloadStartTime = Date.now();

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: els.urlInput.value.trim(),
          format: selectedFormat,
          quality: selectedFormat === 'mp4' ? selectedQuality : undefined,
          authorizationConfirmed: true,
        }),
      });

      const data = await safeJson(response);

      if (!response.ok) {
        throw new Error(data.error || 'Unable to start the download.');
      }

      pollStatus(data.jobId);
    } catch (err) {
      showToast(err.message, 'error');
      setDownloadStatus('Download failed', err.message);
      finishDownloadAttempt();
    }
  }

  function pollStatus(jobId) {
    pollHandle = setInterval(async () => {
      try {
        const response = await fetch(`/api/download/${jobId}/status`);
        const data = await safeJson(response);

        if (!response.ok) {
          throw new Error(data.error || 'Lost track of this download.');
        }

        updateProgressUi(data);

        if (data.status === 'complete') {
          stopPolling();
          setDownloadStatus('Download Ready', 'Your file is ready to save.');
          els.readyDownloadLink.href = `/api/download/${jobId}/file`;
          els.readyDownloadLink.setAttribute('download', '');
          els.readyDownloadLink.hidden = false;
          finishDownloadAttempt();
          showToast('Your download is ready.', 'success');
        } else if (data.status === 'error') {
          stopPolling();
          setDownloadStatus('Download failed', data.error || 'Something went wrong.');
          showToast(data.error || 'The download failed.', 'error');
          finishDownloadAttempt();
        }
      } catch (err) {
        stopPolling();
        setDownloadStatus('Download failed', err.message);
        showToast(err.message, 'error');
        finishDownloadAttempt();
      }
    }, 900);
  }

  function stopPolling() {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  function updateProgressUi(data) {
    const pct = Math.max(0, Math.min(100, data.progress || 0));
    els.progressFill.style.width = `${pct}%`;
    els.progressPercent.textContent = `${pct}%`;

    if (data.totalBytes) {
      els.progressBytes.textContent = `${formatBytes(data.downloadedBytes)} / ${formatBytes(data.totalBytes)}`;
    }

    if (data.downloadedBytes && data.totalBytes && downloadStartTime) {
      const elapsedSec = (Date.now() - downloadStartTime) / 1000;
      const rate = data.downloadedBytes / Math.max(elapsedSec, 0.5);
      const remainingBytes = data.totalBytes - data.downloadedBytes;
      const etaSec = rate > 0 ? Math.round(remainingBytes / rate) : null;
      els.progressEta.textContent = etaSec && etaSec > 0 ? `~${etaSec}s remaining` : '';
    }

    if (data.status === 'downloading') {
      setDownloadStatus('Downloading…', 'Fetching authorized stream data');
    } else if (data.status === 'converting') {
      setDownloadStatus('Processing…', 'Finalizing your file');
    } else if (data.status === 'preparing') {
      setDownloadStatus('Preparing your download…', 'Setting things up');
    }
  }

  function setDownloadStatus(title, sub) {
    els.downloadStatusTitle.textContent = title;
    els.downloadStatusSub.textContent = sub;
  }

  function finishDownloadAttempt() {
    isDownloading = false;
    els.downloadBtn.disabled = false;
  }
})();
