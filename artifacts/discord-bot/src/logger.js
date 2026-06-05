const fs = require('fs');

const MAX_LOGS = 100;
const logs = [];
const startTime = Date.now();
const STATUS_FILE = '/tmp/bot-status.json';

function addLog(msg) {
  const entry = { time: new Date().toLocaleTimeString(), msg };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  console.log(`${entry.time} ${msg}`);
  flushStatus();
}

function getLogs() {
  return [...logs];
}

function getUptime() {
  const ms = Date.now() - startTime;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function flushStatus(extra = {}) {
  try {
    // Lazy-load memory stats to avoid circular deps at module load time
    let memoryStats = { users: [], totalUsers: 0 };
    try {
      const { getMemoryStats } = require('./memory');
      memoryStats = getMemoryStats();
    } catch (_) {}

    fs.writeFileSync(STATUS_FILE, JSON.stringify({
      online: true,
      uptime: getUptime(),
      logs: logs.slice(-50),
      memory: memoryStats,
      ...extra,
    }));
  } catch (_) {}
}

function markOffline() {
  try {
    const current = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...current, online: false }));
  } catch (_) {}
}

module.exports = { addLog, getLogs, getUptime, flushStatus, markOffline };
