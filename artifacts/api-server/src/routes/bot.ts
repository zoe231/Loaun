import { Router } from "express";
import fs from "fs";
import { execSync } from "child_process";

const router = Router();
const STATUS_FILE = "/tmp/bot-status.json";

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch {
    return { online: false, uptime: "—", logs: [], tag: null, memory: { users: [], totalUsers: 0 } };
  }
}

function getPublicUrl() {
  const domains = process.env["REPLIT_DOMAINS"] ?? "";
  const first = domains.split(",")[0]?.trim();
  return first ? `https://${first}/api/bot` : null;
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Loaun — Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#e2e2e2;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 16px;gap:20px}
a{color:#5865f2;text-decoration:none}a:hover{text-decoration:underline}
.card{background:#111;border:1px solid #222;border-radius:16px;padding:28px;width:100%;max-width:680px}
h1{font-size:2rem;font-weight:800;letter-spacing:-1px}
.subtitle{font-size:.85rem;color:#555;margin-top:2px}
.url-bar{display:flex;align-items:center;gap:8px;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:10px;padding:10px 14px;margin-top:16px;font-size:.82rem;color:#888;word-break:break-all}
.url-bar span{flex:1}.url-bar button{background:#1a1a1a;border:1px solid #333;color:#aaa;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.75rem;flex-shrink:0}
.url-bar button:hover{background:#222}
.status-row{display:flex;align-items:center;gap:10px;margin-top:20px}
.dot{width:10px;height:10px;border-radius:50%;background:#2ecc71;box-shadow:0 0 8px #2ecc7180;animation:pulse 2s infinite;flex-shrink:0}
.dot.off{background:#e74c3c;box-shadow:0 0 8px #e74c3c80;animation:none}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.status-label{font-weight:700;font-size:1.05rem}.status-meta{font-size:.8rem;color:#666;margin-top:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.info{background:#0a0a0a;border-radius:10px;padding:14px;border:1px solid #1a1a1a}
.info label{font-size:.68rem;color:#555;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:5px}
.info .val{font-size:1rem;font-weight:700}
.btns{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}
button.act{padding:9px 20px;border-radius:10px;border:none;font-size:.88rem;font-weight:600;cursor:pointer;transition:.15s}
.restart-btn{background:#5865f2;color:#fff}.restart-btn:hover{background:#4752c4}.restart-btn:disabled{background:#1e1e1e;color:#444;cursor:default}
h2{font-size:.78rem;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px}
.logbox{background:#0a0a0a;border-radius:10px;padding:14px;font-family:'JetBrains Mono','Courier New',monospace;font-size:.76rem;line-height:1.75;max-height:320px;overflow-y:auto;border:1px solid #1a1a1a;scroll-behavior:smooth}
.row{display:flex;gap:8px;align-items:flex-start}
.t{color:#444;flex-shrink:0;min-width:72px}.m{color:#bbb;word-break:break-word}
.m.err{color:#e74c3c}.m.bot{color:#7289da}.m.cmd{color:#f0b429}.m.vc{color:#2ecc71}.m.mem{color:#a78bfa}.m.note{color:#fb923c}
.empty{color:#333;font-style:italic}
.cmds-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.cmd-item{background:#0a0a0a;border-radius:8px;padding:10px 12px;border:1px solid #1a1a1a}
.cmd-item code{font-family:'JetBrains Mono','Courier New',monospace;font-size:.8rem;color:#a78bfa;display:block;margin-bottom:3px}
.cmd-item span{font-size:.75rem;color:#666}
.mem-list{display:flex;flex-direction:column;gap:10px}
.mem-user{background:#0a0a0a;border:1px solid #1a1a1a;border-radius:10px;padding:14px}
.mem-user-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.mem-username{font-weight:700;font-size:.9rem}
.mem-badges{display:flex;gap:6px}
.badge{font-size:.68rem;padding:2px 8px;border-radius:20px;font-weight:600}
.badge.lt{background:#1e1533;color:#a78bfa;border:1px solid #3d2d6e}
.badge.st{background:#1a2a1a;color:#2ecc71;border:1px solid #2d4a2d}
.badge.off{background:#1a1a1a;color:#555;border:1px solid #333}
.fact{font-size:.78rem;color:#888;padding:3px 0;border-bottom:1px solid #1a1a1a;display:flex;align-items:center;gap:6px}
.fact:last-child{border-bottom:none}
.fact-src{font-size:.65rem;padding:1px 5px;border-radius:4px;background:#1e1e1e;color:#555}
.no-mem{color:#444;font-style:italic;font-size:.82rem}
@media(max-width:500px){.grid{grid-template-columns:1fr}.cmds-grid{grid-template-columns:1fr}}
</style>
</head>
<body>

<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
    <div>
      <h1>Loaun</h1>
      <div class="subtitle">Discord Voice Bot — Dashboard</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:.72rem;color:#555">Bot tag</div>
      <div id="bot-tag" style="font-weight:700;color:#7289da;font-size:.9rem">—</div>
    </div>
  </div>

  <div class="url-bar" id="url-bar" style="display:none">
    <span id="pub-url"></span>
    <button onclick="copyUrl()">Copy</button>
  </div>

  <div class="status-row">
    <div class="dot" id="dot"></div>
    <div>
      <div class="status-label" id="lbl">Connecting...</div>
      <div class="status-meta" id="meta"></div>
    </div>
  </div>

  <div class="grid">
    <div class="info"><label>Uptime</label><div class="val" id="up">—</div></div>
    <div class="info"><label>Users in memory</label><div class="val" id="mem-count">—</div></div>
  </div>

  <div class="btns">
    <button class="act restart-btn" id="rb" onclick="restart()">Restart Bot</button>
  </div>
</div>

<div class="card">
  <h2>Commands</h2>
  <div class="cmds-grid">
    <div class="cmd-item"><code>!joinvc</code><span>Join your voice channel</span></div>
    <div class="cmd-item"><code>!leavevc</code><span>Leave voice channel</span></div>
    <div class="cmd-item"><code>!memory</code><span>See what I know about you</span></div>
    <div class="cmd-item"><code>!remember &lt;fact&gt;</code><span>Store something permanently</span></div>
    <div class="cmd-item"><code>!forget &lt;keyword&gt;</code><span>Remove a memory by keyword</span></div>
    <div class="cmd-item"><code>!forgetall</code><span>Wipe all your data</span></div>
    <div class="cmd-item"><code>@Loaun &lt;msg&gt;</code><span>Chat in any channel</span></div>
    <div class="cmd-item"><code>DM Loaun</code><span>Private chat + voice notes</span></div>
  </div>
</div>

<div class="card">
  <h2>Memory</h2>
  <div id="mem-section"><span class="empty">No users in memory yet.</span></div>
</div>

<div class="card">
  <h2>Live Activity</h2>
  <div class="logbox" id="log"><span class="empty">No activity yet...</span></div>
</div>

<script>
const PUB_URL_PLACEHOLDER = '__PUB_URL__';

function initUrl() {
  if (!PUB_URL_PLACEHOLDER || PUB_URL_PLACEHOLDER === '__PUB_URL__') return;
  const bar = document.getElementById('url-bar');
  bar.style.display = 'flex';
  document.getElementById('pub-url').textContent = PUB_URL_PLACEHOLDER;
}
initUrl();

function copyUrl() {
  navigator.clipboard.writeText(PUB_URL_PLACEHOLDER).then(() => {
    const b = document.querySelector('#url-bar button');
    b.textContent = 'Copied!';
    setTimeout(() => b.textContent = 'Copy', 1500);
  });
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderLogs(logs) {
  const b = document.getElementById('log');
  if (!logs.length) { b.innerHTML = '<span class="empty">No activity yet...</span>'; return; }
  b.innerHTML = [...logs].reverse().map(l => {
    let c = 'm';
    const m = l.msg || '';
    if (m.startsWith('[Error]')) c += ' err';
    else if (m.startsWith('[Loaun]')) c += ' bot';
    else if (m.startsWith('[CMD]')) c += ' cmd';
    else if (m.startsWith('[VC]') || m.startsWith('[STT]')) c += ' vc';
    else if (m.startsWith('[Memory]')) c += ' mem';
    else if (m.startsWith('[VoiceNote]')) c += ' note';
    return '<div class="row"><span class="t">'+esc(l.time)+'</span><span class="'+c+'">'+esc(m)+'</span></div>';
  }).join('');
}

function renderMemory(mem) {
  const sec = document.getElementById('mem-section');
  document.getElementById('mem-count').textContent = mem.totalUsers || 0;
  if (!mem.users || !mem.users.length) {
    sec.innerHTML = '<span class="no-mem">No users in memory yet.</span>';
    return;
  }
  sec.innerHTML = '<div class="mem-list">' + mem.users.map(u => {
    const stBadge = u.sessionActive
      ? '<span class="badge st">'+u.shortTermMessages+' turn session</span>'
      : '<span class="badge off">no active session</span>';
    const ltBadge = '<span class="badge lt">'+u.longTermCount+' long-term facts</span>';
    const factsHtml = u.facts.length
      ? u.facts.map(f => '<div class="fact">• '+esc(f.text)+'<span class="fact-src">'+esc(f.source)+'</span><span style="font-size:.65rem;color:#444;margin-left:auto">'+esc(f.date)+'</span></div>').join('')
      : '<div class="no-mem">No stored facts yet</div>';
    return '<div class="mem-user"><div class="mem-user-header"><div class="mem-username">'+esc(u.username)+'</div><div class="mem-badges">'+ltBadge+stBadge+'</div></div>'+factsHtml+'</div>';
  }).join('') + '</div>';
}

async function poll() {
  try {
    const d = await fetch('/api/bot/status').then(r => r.json());
    document.getElementById('dot').className = 'dot' + (d.online ? '' : ' off');
    document.getElementById('lbl').textContent = d.online ? 'Online' : 'Offline';
    document.getElementById('meta').textContent = d.online ? 'Bot is running and listening' : 'Bot process is not running';
    document.getElementById('bot-tag').textContent = d.tag || '—';
    document.getElementById('up').textContent = d.uptime || '—';
    renderLogs(d.logs || []);
    renderMemory(d.memory || { users: [], totalUsers: 0 });
  } catch {
    document.getElementById('lbl').textContent = 'Unreachable';
    document.getElementById('dot').className = 'dot off';
  }
}

async function restart() {
  const b = document.getElementById('rb');
  b.disabled = true; b.textContent = 'Restarting...';
  await fetch('/api/bot/restart', { method: 'POST' }).catch(() => {});
  setTimeout(() => { b.disabled = false; b.textContent = 'Restart Bot'; poll(); }, 4000);
}

poll();
setInterval(poll, 2500);
</script>
</body>
</html>`;

router.get("/bot", (_req, res) => {
  const pubUrl = getPublicUrl();
  const html = DASHBOARD_HTML.replace("'__PUB_URL__'", pubUrl ? `'${pubUrl}'` : "null");
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

router.get("/bot/status", (_req, res) => {
  res.json(readStatus());
});

router.post("/bot/restart", (_req, res) => {
  res.json({ ok: true });
  try {
    execSync("pkill -f 'node src/app.js' || true");
  } catch (_) {}
});

export default router;
