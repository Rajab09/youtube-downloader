const { v4: uuidv4 } = require('uuid');

const JOB_TTL_MS = 30 * 60 * 1000;

const jobs = new Map();

function createJob() {
  const id = uuidv4();
  const job = {
    id,
    status: 'preparing', // preparing | downloading | converting | complete | error
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    etaSeconds: null,
    error: null,
    filePath: null,
    fileName: null,
    createdAt: Date.now(),
    completedAt: null,
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
}

function deleteJob(id) {
  jobs.delete(id);
}

function pruneStaleJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

module.exports = { createJob, getJob, updateJob, deleteJob, pruneStaleJobs, jobs };
