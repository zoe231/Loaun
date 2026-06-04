const MAX_LOGS = 100;
const logs = [];
const startTime = Date.now();

function addLog(msg) {
  const entry = { time: new Date().toLocaleTimeString(), msg };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  console.log(`${entry.time} ${msg}`);
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

module.exports = { addLog, getLogs, getUptime, startTime };
