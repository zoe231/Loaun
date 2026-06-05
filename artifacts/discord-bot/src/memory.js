const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const DB_PATH = path.join(__dirname, '../memories.json');
const SHORT_TERM_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours of inactivity clears short-term
const MAX_SHORT_TERM_TURNS = 15; // 15 exchanges per session

// ─── Short-term (in-memory, per session) ─────────────────────────────────────
// Structure: userId → { messages: [{role, content}], lastActive: timestamp, username }
const shortTerm = new Map();

function getSession(userId) {
  const now = Date.now();
  const session = shortTerm.get(userId);
  if (!session) return null;
  if (now - session.lastActive > SHORT_TERM_EXPIRY_MS) {
    shortTerm.delete(userId);
    return null;
  }
  return session;
}

function touchSession(userId, username) {
  const existing = getSession(userId);
  if (existing) {
    existing.lastActive = Date.now();
    existing.username = username;
    return existing;
  }
  const session = { messages: [], lastActive: Date.now(), username };
  shortTerm.set(userId, session);
  return session;
}

function addToShortTerm(userId, username, role, content) {
  const session = touchSession(userId, username);
  session.messages.push({ role, content });
  if (session.messages.length > MAX_SHORT_TERM_TURNS * 2) {
    session.messages.splice(0, 2); // drop oldest exchange
  }
}

function getConversationHistory(userId) {
  return getSession(userId)?.messages ?? [];
}

function clearShortTerm(userId) {
  shortTerm.delete(userId);
}

// ─── Long-term (persisted to disk) ───────────────────────────────────────────
function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) return {};
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error('memory save error:', err.message);
  }
}

function remember(userId, username, fact) {
  const db = loadDB();
  if (!db[userId]) db[userId] = { username, facts: [] };
  db[userId].username = username;
  // Avoid exact duplicates
  const already = db[userId].facts.some(
    (f) => f.fact.toLowerCase() === fact.toLowerCase()
  );
  if (!already) {
    db[userId].facts.push({ fact, createdAt: new Date().toISOString(), source: 'manual' });
    saveDB(db);
  }
}

function rememberAuto(userId, username, fact) {
  const db = loadDB();
  if (!db[userId]) db[userId] = { username, facts: [] };
  db[userId].username = username;
  const already = db[userId].facts.some(
    (f) => f.fact.toLowerCase() === fact.toLowerCase()
  );
  if (!already) {
    db[userId].facts.push({ fact, createdAt: new Date().toISOString(), source: 'auto' });
    saveDB(db);
  }
}

function forget(userId, keyword) {
  const db = loadDB();
  if (!db[userId]) return false;
  const before = db[userId].facts.length;
  db[userId].facts = db[userId].facts.filter(
    (f) => !f.fact.toLowerCase().includes(keyword.toLowerCase())
  );
  saveDB(db);
  return db[userId].facts.length < before;
}

function forgetAll(userId) {
  const db = loadDB();
  if (db[userId]) {
    db[userId].facts = [];
    saveDB(db);
  }
  clearShortTerm(userId);
}

function buildMemoryContext(userId) {
  const db = loadDB();
  const facts = db[userId]?.facts?.slice(-20);
  if (!facts?.length) return null;
  return facts.map((f) => `• ${f.fact}`).join('\n');
}

// ─── Auto-extraction via AI ───────────────────────────────────────────────────
async function autoMemory(userId, username, message) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Extract personal facts worth long-term remembering from the user's message.
Only extract concrete, durable facts: name, location, job, relationships, hobbies, preferences, health, goals.
Return ONLY a JSON array of short fact strings (max 3). If nothing is memorable, return [].
Examples: ["name is Zoe", "lives in London", "studies computer science", "prefers dark mode"]`,
          },
          { role: 'user', content: message },
        ],
        max_tokens: 120,
        temperature: 0.2,
      }),
    });
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '[]';
    const facts = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (Array.isArray(facts)) {
      for (const fact of facts) {
        if (typeof fact === 'string' && fact.length > 2) rememberAuto(userId, username, fact);
      }
    }
  } catch (_) {}
}

// ─── Stats for dashboard ──────────────────────────────────────────────────────
function getMemoryStats() {
  const db = loadDB();
  const users = Object.entries(db).map(([userId, data]) => {
    const session = shortTerm.get(userId);
    return {
      userId,
      username: data.username || userId,
      longTermCount: data.facts?.length ?? 0,
      facts: (data.facts || []).slice(-5).map((f) => ({
        text: f.fact,
        source: f.source || 'manual',
        date: f.createdAt ? f.createdAt.slice(0, 10) : '',
      })),
      shortTermMessages: session ? Math.floor(session.messages.length / 2) : 0,
      sessionActive: !!session,
    };
  });
  return { users, totalUsers: users.length };
}

module.exports = {
  remember,
  forget,
  forgetAll,
  buildMemoryContext,
  autoMemory,
  addToShortTerm,
  getConversationHistory,
  clearShortTerm,
  getMemoryStats,
};
