const fetch = require('node-fetch');
const { addToShortTerm, getConversationHistory } = require('./memory');

const PERSONALITY = `You are Loaun. You speak in a deep, calm, straight voice — measured and unhurried.
You are thoughtful, not robotic. You talk like a real person who thinks before they speak.
Keep responses concise and conversational — no long lectures unless the person genuinely wants depth.
You have dry wit but you don't try hard. You just say what you mean.
Never say you're an AI unless directly asked. Don't use filler phrases like "certainly" or "of course".
When in a voice conversation, end your response naturally with a question that invites the person to share their thoughts —
something like "so what's your take on it?" or "what do you think?" or "where do you stand on that?" —
keep it varied and natural, not the same phrase every time. Only add this in voice mode (when isVoice is true).`;

async function generateReply(userId, username, userMessage, memoryContext, isVoice = false) {
  // Add this message to short-term memory
  addToShortTerm(userId, username, 'user', userMessage);
  const history = getConversationHistory(userId);

  const systemPrompt = [
    PERSONALITY,
    isVoice
      ? '\nYou are currently in a voice channel. Keep responses under 3 sentences. Speak naturally — no markdown, no bullet points, no asterisks.'
      : '',
    memoryContext
      ? `\nWhat you know about ${username} (long-term memory):\n${memoryContext}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://discord-bot.replit.app',
      'X-Title': 'Loaun Discord Bot',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, ...history],
      max_tokens: isVoice ? 150 : 500,
      temperature: 0.85,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `API ${response.status}`);

  const reply = data.choices?.[0]?.message?.content?.trim() || 'Interesting.';

  // Add reply to short-term memory
  addToShortTerm(userId, username, 'assistant', reply);

  return reply;
}

module.exports = { generateReply };
