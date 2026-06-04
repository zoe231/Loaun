const { createClient } = require('@deepgram/sdk');

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

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

  const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return transcript?.trim() || '';
}

module.exports = { transcribeAudio };
