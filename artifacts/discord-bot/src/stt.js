const { createClient } = require('@deepgram/sdk');
const fetch = require('node-fetch');

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// Transcribe raw PCM from voice channel (48kHz mono 16-bit)
async function transcribeAudio(pcmBuffer) {
  if (!pcmBuffer || pcmBuffer.length < 1000) return '';

  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
    pcmBuffer,
    {
      model: 'nova-2',
      language: 'en',
      smart_format: true,
      punctuate: true,
      encoding: 'linear16',
      sample_rate: 48000,
      channels: 1,
    }
  );

  if (error) throw new Error(`Deepgram STT error: ${error.message}`);
  return result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || '';
}

// Transcribe a Discord voice note (OGG/Opus attachment URL)
async function transcribeVoiceNote(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = await res.buffer();

  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
    buffer,
    {
      model: 'nova-2',
      language: 'en',
      smart_format: true,
      punctuate: true,
      // No encoding/sample_rate — Deepgram auto-detects OGG container
    }
  );

  if (error) throw new Error(`Deepgram voice note error: ${error.message}`);
  return result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || '';
}

module.exports = { transcribeAudio, transcribeVoiceNote };
