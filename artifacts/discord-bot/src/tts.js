const fetch = require('node-fetch');
const { Readable } = require('stream');

const DEEPGRAM_TTS_URL = 'https://api.deepgram.com/v1/speak';

async function textToSpeech(text) {
  const cleanText = text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/_/g, '')
    .replace(/`/g, '')
    .replace(/#/g, '')
    .trim();

  const response = await fetch(
    `${DEEPGRAM_TTS_URL}?model=aura-2-andromeda-en&encoding=linear16&sample_rate=48000&container=none`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: cleanText }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Deepgram TTS error ${response.status}: ${err}`);
  }

  const buffer = await response.buffer();
  return buffer;
}

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

module.exports = { textToSpeech, bufferToStream };
