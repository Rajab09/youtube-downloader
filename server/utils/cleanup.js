const fs = require('fs');
const path = require('path');
const config = require('../config');
const { jobs, pruneStaleJobs } = require('../services/jobManager');

function deleteFileQuietly(filePath) {
  fs.promises.unlink(filePath).catch(() => {});
}

async function sweepOrphanedFiles() {
  let entries;
  try {
    entries = await fs.promises.readdir(config.downloadsDir);
  } catch {
    return;
  }

  const activeFiles = new Set(
    Array.from(jobs.values())
      .filter((j) => j.filePath)
      .map((j) => path.basename(j.filePath))
  );

  const now = Date.now();
  for (const entry of entries) {
    if (entry === '.gitkeep') continue;
    const fullPath = path.join(config.downloadsDir, entry);
    if (activeFiles.has(entry)) continue;
    try {
      const stat = await fs.promises.stat(fullPath);
      if (now - stat.mtimeMs > config.fileRetentionMs) {
        deleteFileQuietly(fullPath);
      }
    } catch {
      // file may have already been removed; ignore
    }
  }
}

function sweepExpiredCompletedJobs() {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (job.status === 'complete' && job.completedAt && now - job.completedAt > config.fileRetentionMs) {
      if (job.filePath) deleteFileQuietly(job.filePath);
      jobs.delete(job.id);
    }
    if (job.status === 'error') {
      // Errored jobs can be pruned promptly; nothing on disk to keep.
    }
  }
}

function startCleanupScheduler() {
  const run = async () => {
    await sweepOrphanedFiles();
    sweepExpiredCompletedJobs();
    pruneStaleJobs();
  };
  run();
  return setInterval(run, config.cleanupIntervalMs);
}

module.exports = { startCleanupScheduler, sweepOrphanedFiles, deleteFileQuietly };
