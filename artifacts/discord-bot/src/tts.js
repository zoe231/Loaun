const fetch = require('node-fetch');

const DEEPGRAM_TTS_URL = 'https://api.deepgram.com/v1/speak';

function monoToStereo(monoBuffer) {
  const samples = monoBuffer.length / 2;
  const stereo = Buffer.allocUnsafe(samples * 4);
  for (let i = 0; i < samples; i++) {
    const s = monoBuffer.readInt16LE(i * 2);
    stereo.writeInt16LE(s, i * 4);
    stereo.writeInt16LE(s, i * 4 + 2);
  }
  return stereo;
}

async function textToSpeech(text) {
  const clean = text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/_/g, '')
    .replace(/`/g, '')
    .replace(/#/g, '')
    .trim();

  const response = await fetch(
    `${DEEPGRAM_TTS_URL}?model=aura-orion-en&encoding=linear16&sample_rate=48000&container=none`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: clean }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Deepgram TTS ${response.status}: ${err}`);
  }

  const mono = await response.buffer();
  return monoToStereo(mono);
}

module.exports = { textToSpeech };
