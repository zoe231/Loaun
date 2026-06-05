import { useEffect, useState, useRef } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SECRET = "zoe2004";
const SESSION_KEY = "loaun_auth";

interface LogEntry { time: string; msg: string; }
interface MemUser {
  userId: string; username: string;
  longTermCount: number; shortTermMessages: number; sessionActive: boolean;
  facts: { text: string; source: string; date: string }[];
}
interface Status {
  online: boolean; uptime: string; tag: string | null;
  logs: LogEntry[];
  memory: { users: MemUser[]; totalUsers: number };
}

function logClass(msg: string) {
  if (msg.startsWith("[Error]")) return "text-red-400";
  if (msg.startsWith("[Loaun]")) return "text-indigo-400";
  if (msg.startsWith("[CMD]")) return "text-amber-400";
  if (msg.startsWith("[VC]") || msg.startsWith("[STT]")) return "text-emerald-400";
  if (msg.startsWith("[Memory]")) return "text-violet-400";
  if (msg.startsWith("[VoiceNote]")) return "text-orange-400";
  if (msg.startsWith("[VCdbg]")) return "text-zinc-600";
  return "text-zinc-300";
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function attempt(e: React.FormEvent) {
    e.preventDefault();
    if (code === SECRET) {
      sessionStorage.setItem(SESSION_KEY, "1");
      onUnlock();
    } else {
      setError(true);
      setShake(true);
      setCode("");
      setTimeout(() => setShake(false), 500);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className={`w-full max-w-sm bg-card border border-border rounded-2xl p-8 flex flex-col items-center gap-6 ${shake ? "animate-shake" : ""}`}>
        {/* Lock icon */}
        <div className="w-16 h-16 rounded-2xl bg-indigo-950 border border-indigo-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>

        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Loaun Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Enter the access code to continue</p>
        </div>

        <form onSubmit={attempt} className="w-full flex flex-col gap-3">
          <input
            ref={inputRef}
            type="password"
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(false); }}
            placeholder="Access code"
            className={`w-full bg-muted border rounded-xl px-4 py-3 text-center text-lg tracking-[0.3em] font-mono outline-none transition-colors
              ${error ? "border-red-500 text-red-400 placeholder:text-red-800" : "border-border focus:border-indigo-500 text-foreground placeholder:text-muted-foreground"}`}
            autoComplete="off"
            spellCheck={false}
          />
          {error && (
            <p className="text-red-400 text-xs text-center">Incorrect code. Try again.</p>
          )}
          <button
            type="submit"
            className="bg-primary text-primary-foreground font-semibold px-5 py-2.5 rounded-xl text-sm hover:opacity-90 transition-opacity"
          >
            Unlock
          </button>
        </form>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  );
}

function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  async function poll() {
    try {
      const res = await fetch(`${BASE}/api/bot/status`);
      if (res.ok) setStatus(await res.json());
    } catch { /* offline */ }
  }

  useEffect(() => {
    poll();
    const id = setInterval(poll, 2500);
    return () => clearInterval(id);
  }, []);

  async function restart() {
    setRestarting(true);
    await fetch(`${BASE}/api/bot/restart`, { method: "POST" }).catch(() => {});
    setTimeout(() => { setRestarting(false); poll(); }, 4000);
  }

  function copyUrl() {
    navigator.clipboard.writeText(window.location.origin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const logs = status?.logs ?? [];
  const mem = status?.memory ?? { users: [], totalUsers: 0 };
  const online = status?.online ?? false;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center px-4 py-10 gap-5">

      {/* ── Header card ─────────────────────────────────── */}
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl p-7">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Loaun</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Discord Voice Bot — Dashboard</p>
          </div>
          {status?.tag && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground mb-0.5">Bot tag</div>
              <div className="text-indigo-400 font-bold text-sm">{status.tag}</div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 bg-muted border border-border rounded-xl px-4 py-2.5 mb-5 text-sm text-muted-foreground">
          <span className="flex-1 truncate">{window.location.origin}</span>
          <button
            onClick={copyUrl}
            className="text-xs bg-secondary border border-border px-3 py-1 rounded-lg hover:bg-accent transition-colors shrink-0"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 pulse-dot ${online ? "bg-emerald-400 text-emerald-400" : "bg-red-500 text-red-500"}`}
          />
          <div>
            <div className="font-semibold">{status === null ? "Connecting..." : online ? "Online" : "Offline"}</div>
            <div className="text-xs text-muted-foreground">
              {online ? "Bot is running and listening" : "Bot process is not running"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-muted border border-border rounded-xl p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Uptime</div>
            <div className="font-bold text-lg">{status?.uptime ?? "—"}</div>
          </div>
          <div className="bg-muted border border-border rounded-xl p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Users in memory</div>
            <div className="font-bold text-lg">{mem.totalUsers}</div>
          </div>
        </div>

        <button
          onClick={restart}
          disabled={restarting}
          className="bg-primary text-primary-foreground font-semibold px-5 py-2.5 rounded-xl text-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {restarting ? "Restarting..." : "Restart Bot"}
        </button>
      </div>

      {/* ── Commands ────────────────────────────────────── */}
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl p-7">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Commands</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {[
            [":joinvc", "Join your voice channel"],
            [":leavevc", "Leave voice channel"],
            [":memory", "See what I know about you"],
            [":remember <fact>", "Store something permanently"],
            [":forget <keyword>", "Remove a memory"],
            [":forgetall", "Wipe all your data"],
            ["@Loaun <msg>", "Chat in any channel"],
            ["DM Loaun", "Private chat + voice notes"],
          ].map(([cmd, desc]) => (
            <div key={cmd} className="bg-muted border border-border rounded-xl px-4 py-3">
              <code className="text-violet-400 text-sm font-mono block mb-1">{cmd}</code>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Memory ──────────────────────────────────────── */}
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl p-7">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Memory</h2>
        {mem.users.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">No users in memory yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {mem.users.map((u) => (
              <div key={u.userId} className="bg-muted border border-border rounded-xl p-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <span className="font-bold">{u.username}</span>
                  <div className="flex gap-2">
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-violet-950 text-violet-300 border border-violet-800">
                      {u.longTermCount} long-term
                    </span>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full border ${u.sessionActive ? "bg-emerald-950 text-emerald-300 border-emerald-800" : "bg-zinc-900 text-zinc-500 border-zinc-800"}`}>
                      {u.sessionActive ? `${u.shortTermMessages} turn session` : "no session"}
                    </span>
                  </div>
                </div>
                {u.facts.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No stored facts yet</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {u.facts.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm border-b border-border pb-1.5 last:border-0 last:pb-0">
                        <span className="text-zinc-400 flex-1">• {f.text}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{f.source}</span>
                        <span className="text-xs text-zinc-600">{f.date}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Live Activity ────────────────────────────────── */}
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl p-7">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Live Activity</h2>
        <div
          ref={logRef}
          className="bg-muted border border-border rounded-xl p-4 font-mono text-xs leading-7 max-h-80 overflow-y-auto"
        >
          {logs.length === 0 ? (
            <span className="text-muted-foreground italic">No activity yet...</span>
          ) : (
            [...logs].reverse().map((l, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-zinc-600 shrink-0 min-w-[72px]">{l.time}</span>
                <span className={logClass(l.msg)}>{l.msg}</span>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === "1");
  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return <Dashboard />;
}
