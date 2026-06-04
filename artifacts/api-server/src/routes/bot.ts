import { Router } from "express";
import fs from "fs";

const router = Router();

const STATUS_FILE = "/tmp/bot-status.json";

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch {
    return { online: false, uptime: "—", logs: [], tag: null };
  }
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Loaun Bot Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d0d0d;color:#e2e2e2;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px}
.card{background:#161616;border:1px solid #2a2a2a;border-radius:16px;padding:32px;width:100%;max-width:640px;margin-bottom:24px}
h1{font-size:1.8rem;font-weight:700;letter-spacing:-0.5px;margin-bottom:4px}
.tag{font-size:0.8rem;color:#666;margin-bottom:24px}
.status-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.dot{width:10px;height:10px;border-radius:50%;background:#2ecc71;box-shadow:0 0 8px #2ecc71;animation:pulse 2s infinite}
.dot.off{background:#e74c3c;box-shadow:0 0 8px #e74c3c;animation:none}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.label{font-weight:600}
.meta{font-size:.82rem;color:#777;margin-top:4px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
.info{background:#0d0d0d;border-radius:10px;padding:14px;border:1px solid #222}
.info label{font-size:.72rem;color:#666;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px}
.info span{font-size:1rem;font-weight:600}
.btns{display:flex;gap:12px;margin-top:20px}
button{padding:10px 22px;border-radius:10px;border:none;font-size:.9rem;font-weight:600;cursor:pointer;transition:.15s}
.restart{background:#5865f2;color:#fff}.restart:hover{background:#4752c4}.restart:disabled{background:#2a2a2a;color:#555;cursor:not-allowed}
h2{font-size:1rem;font-weight:600;color:#aaa;margin-bottom:14px;text-transform:uppercase;letter-spacing:.5px}
.logbox{background:#0d0d0d;border-radius:10px;padding:14px;font-family:'Courier New',monospace;font-size:.78rem;line-height:1.7;max-height:340px;overflow-y:auto;border:1px solid #222}
.row{display:flex;gap:8px}.t{color:#555;flex-shrink:0}.m{color:#ccc;word-break:break-word}
.m.err{color:#e74c3c}.m.bot{color:#5865f2}.m.cmd{color:#f0b429}.m.vc{color:#2ecc71}
.empty{color:#444;font-style:italic}
.cmds{margin-top:8px;font-size:.82rem;color:#666}
.cmds code{background:#1a1a1a;padding:2px 6px;border-radius:4px;color:#aaa}
</style>
</head>
<body>
<div class="card">
  <h1>Loaun</h1>
  <div class="tag">Discord Voice Bot</div>
  <div class="status-row">
    <div class="dot" id="dot"></div>
    <span class="label" id="lbl">Checking...</span>
  </div>
  <div class="meta" id="meta"></div>
  <div class="grid">
    <div class="info"><label>Uptime</label><span id="up">—</span></div>
    <div class="info"><label>Commands</label><span><code>!joinvc</code> <code>!leavevc</code></span></div>
  </div>
  <div class="btns">
    <button class="restart" id="rb" onclick="restart()">Restart Bot</button>
  </div>
  <div class="cmds">Text: mention the bot or DM it &nbsp;·&nbsp; Voice: type <code>!joinvc</code> in any channel while in a VC</div>
</div>
<div class="card">
  <h2>Live Activity</h2>
  <div class="logbox" id="log"><span class="empty">No activity yet...</span></div>
</div>
<script>
async function poll(){
  try{
    const d=await fetch('/api/bot/status').then(r=>r.json());
    document.getElementById('dot').className='dot'+(d.online?'':' off');
    document.getElementById('lbl').textContent=d.online?('Online — '+d.tag):'Offline';
    document.getElementById('meta').textContent=d.online?'Bot is running and listening':'Bot process is not running';
    document.getElementById('up').textContent=d.uptime||'—';
    render(d.logs||[]);
  }catch{
    document.getElementById('lbl').textContent='Unreachable';
    document.getElementById('dot').className='dot off';
  }
}
function render(logs){
  const b=document.getElementById('log');
  if(!logs.length){b.innerHTML='<span class="empty">No activity yet...</span>';return;}
  b.innerHTML=[...logs].reverse().map(l=>{
    let c='m';
    if(l.msg.startsWith('[Error]'))c+=' err';
    else if(l.msg.startsWith('[Loaun]'))c+=' bot';
    else if(l.msg.startsWith('[CMD]'))c+=' cmd';
    else if(l.msg.startsWith('[VC]')||l.msg.startsWith('[STT]'))c+=' vc';
    return '<div class="row"><span class="t">'+l.time+'</span><span class="'+c+'">'+esc(l.msg)+'</span></div>';
  }).join('');
}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
async function restart(){
  const b=document.getElementById('rb');
  b.disabled=true;b.textContent='Restarting...';
  await fetch('/api/bot/restart',{method:'POST'}).catch(()=>{});
  setTimeout(()=>{b.disabled=false;b.textContent='Restart Bot';poll();},4000);
}
poll();setInterval(poll,2500);
</script>
</body>
</html>`;

router.get("/bot", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(DASHBOARD_HTML);
});

router.get("/bot/status", (_req, res) => {
  res.json(readStatus());
});

router.post("/bot/restart", (_req, res) => {
  res.json({ ok: true });
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    execSync("pkill -f 'node src/app.js' || true");
  } catch (_) {}
});

export default router;
