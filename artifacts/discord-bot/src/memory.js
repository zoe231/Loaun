const fs = require('fs');
const fetch = require('node-fetch');

const DB_FILE = './memories.json';

function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '{}');
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function remember(userId, username, fact) {
  const db = loadDB();
  if (!db[userId]) db[userId] = { username, facts: [] };
  db[userId].facts.push({ fact, createdAt: new Date().toISOString() });
  saveDB(db);
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

function buildMemoryContext(userId) {
  const db = loadDB();
  const facts = db[userId]?.facts?.slice(-20);
  if (!facts?.length) return null;
  return facts.map((f, i) => `${i + 1}. ${f.fact}`).join('\n');
}

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
            content: `Extract personal facts worth remembering from the user message (name, location, job, hobby, preferences, etc.).
Return ONLY a JSON array of short fact strings, max 3 items. If nothing is memorable, return [].
Example: ["likes cats", "lives in Mumbai", "studying B.Com"]`,
          },
          { role: 'user', content: message },
        ],
        max_tokens: 100,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '[]';
    const clean = raw.replace(/```json|```/g, '').trim();
    const facts = JSON.parse(clean);

    if (Array.isArray(facts)) {
      for (const fact of facts) {
        if (typeof fact === 'string' && fact.length > 2) {
          remember(userId, username, fact);
        }
      }
    }
  } catch (_) {}
}

module.exports = { remember, forget, buildMemoryContext, autoMemory };
