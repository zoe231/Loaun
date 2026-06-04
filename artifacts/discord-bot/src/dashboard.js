const http = require('http');
const { getLogs, getUptime } = require('./logger');

const PORT = process.env.PORT || 3000;
const BASE = process.env.BASE_PATH || '';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Loaun Bot Dashboard</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0d0d0d;color:#e2e2e2;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px}
  .card{background:#161616;border:1px solid #2a2a2a;border-radius:16px;padding:32px;width:100%;max-width:640px;margin-bottom:24px}
  h1{font-size:1.8rem;font-weight:700;letter-spacing:-0.5px;margin-bottom:4px}
  .tag{font-size:0.8rem;color:#666;margin-bottom:24px}
  .status-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
  .dot{width:10px;height:10px;border-radius:50%;background:#2ecc71;box-shadow:0 0 8px #2ecc71;animation:pulse 2s infinite}
  .dot.offline{background:#e74c3c;box-shadow:0 0 8px #e74c3c;animation:none}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
  .status-label{font-weight:600;font-size:1rem}
  .meta{font-size:0.82rem;color:#777;margin-top:4px}
  .btn-row{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}
  button{padding:10px 22px;border-radius:10px;border:none;font-size:0.9rem;font-weight:600;cursor:pointer;transition:all .15s}
  .btn-restart{background:#5865f2;color:#fff}
  .btn-restart:hover{background:#4752c4}
  .btn-restart:disabled{background:#2a2a2a;color:#555;cursor:not-allowed}
  h2{font-size:1rem;font-weight:600;color:#aaa;margin-bottom:14px;text-transform:uppercase;letter-spacing:.5px}
  .log-box{background:#0d0d0d;border-radius:10px;padding:14px;font-family:'Courier New',monospace;font-size:0.78rem;line-height:1.7;max-height:320px;overflow-y:auto;border:1px solid #222}
  .log-line{display:flex;gap:8px}
  .log-time{color:#555;flex-shrink:0}
  .log-msg{color:#ccc;word-break:break-word}
  .log-msg.err{color:#e74c3c}
  .log-msg.loaun{color:#5865f2}
  .log-msg.cmd{color:#f0b429}
  .empty{color:#444;font-style:italic}
  .uptime-val{font-size:1.1rem;font-weight:700;color:#5865f2}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
  .info-item{background:#0d0d0d;border-radius:10px;padding:14px;border:1px solid #222}
  .info-item label{font-size:0.72rem;color:#666;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px}
  .info-item span{font-size:1rem;font-weight:600}
</style>
</head>
<body>
<div class="card">
  <h1>Loaun</h1>
  <div class="tag">Discord Voice Bot Dashboard</div>
  <div class="status-row">
    <div class="dot" id="dot"></div>
    <span class="status-label" id="statusLabel">Checking...</span>
  </div>
  <div class="meta" id="meta">Loading...</div>
  <div class="info-grid">
    <div class="info-item">
      <label>Uptime</label>
      <span id="uptime">—</span>
    </div>
    <div class="info-item">
      <label>Commands</label>
      <span>!joinvc &nbsp; !leavevc</span>
    </div>
  </div>
  <div class="btn-row">
    <button class="btn-restart" id="restartBtn" onclick="restartBot()">Restart Bot</button>
  </div>
</div>

<div class="card">
  <h2>Live Activity</h2>
  <div class="log-box" id="logBox"><span class="empty">No activity yet...</span></div>
</div>

<script>
async function poll() {
  try {
    const r = await fetch('${BASE}/api/status');
    const d = await r.json();
    document.getElementById('dot').className = 'dot' + (d.online ? '' : ' offline');
    document.getElementById('statusLabel').textContent = d.online ? 'Online — ' + d.tag : 'Offline';
    document.getElementById('meta').textContent = d.online ? 'Bot is running and ready' : 'Bot is not connected';
    document.getElementById('uptime').textContent = d.uptime;
    renderLogs(d.logs);
  } catch(e) {
    document.getElementById('statusLabel').textContent = 'Unreachable';
    document.getElementById('dot').className = 'dot offline';
  }
}

function renderLogs(logs) {
  const box = document.getElementById('logBox');
  if (!logs || !logs.length) { box.innerHTML = '<span class="empty">No activity yet...</span>'; return; }
  const wasBottom = box.scrollHeight - box.scrollTop <= box.clientHeight + 20;
  box.innerHTML = [...logs].reverse().map(l => {
    let cls = 'log-msg';
    if (l.msg.startsWith('[Error]')) cls += ' err';
    else if (l.msg.startsWith('[Loaun]')) cls += ' loaun';
    else if (l.msg.startsWith('[CMD]')) cls += ' cmd';
    return '<div class="log-line"><span class="log-time">' + l.time + '</span><span class="' + cls + '">' + escHtml(l.msg) + '</span></div>';
  }).join('');
  if (wasBottom) box.scrollTop = 0;
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function restartBot() {
  const btn = document.getElementById('restartBtn');
  btn.disabled = true;
  btn.textContent = 'Restarting...';
  try {
    await fetch('${BASE}/api/restart', { method: 'POST' });
  } catch(_) {}
  setTimeout(() => { btn.disabled = false; btn.textContent = 'Restart Bot'; poll(); }, 4000);
}

poll();
setInterval(poll, 2000);
</script>
</body>
</html>`;

function startDashboard(client) {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const basedUrl = url.startsWith(BASE) ? url.slice(BASE.length) : url;

    if (basedUrl === '/api/status' || url === '/api/status') {
      const online = client.isReady();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        online,
        tag: client.user?.tag || null,
        uptime: getUptime(),
        logs: getLogs().slice(-50),
      }));
      return;
    }

    if ((basedUrl === '/api/restart' || url === '/api/restart') && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      setTimeout(() => process.exit(0), 300);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
  });

  server.listen(PORT, () => {
    console.log(`Dashboard running on port ${PORT}`);
  });
}

module.exports = { startDashboard };
