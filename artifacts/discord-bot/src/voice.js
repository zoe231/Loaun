require('dotenv').config();
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  EndBehaviorType,
} = require('@discordjs/voice');
const { Readable } = require('stream');
const { transcribeAudio } = require('./stt');
const { generateReply } = require('./ai');
const { buildMemoryContext, autoMemory } = require('./memory');
const { textToSpeech } = require('./tts');
const { addLog } = require('./logger');

const SILENCE_TIMEOUT_MS = 1200;
const MIN_PCM_BYTES = 4800;

const guildState = new Map();

function getState(guildId) {
  if (!guildState.has(guildId)) {
    guildState.set(guildId, {
      player: null,
      isSpeaking: false,
      interrupted: false,
      processingUsers: new Set(),
    });
  }
  return guildState.get(guildId);
}

async function speakInVC(connection, text, guildId) {
  const state = getState(guildId);
  if (state.interrupted) {
    state.interrupted = false;
    return;
  }

  try {
    addLog(`[Loaun] ${text}`);
    const pcmBuffer = await textToSpeech(text);
    addLog(`[TTS] Got ${pcmBuffer.length} bytes, playing...`);

    if (state.interrupted) {
      state.interrupted = false;
      return;
    }

    const stream = new Readable({ read() {} });
    stream.push(pcmBuffer);
    stream.push(null);

    const resource = createAudioResource(stream, {
      inputType: StreamType.Raw,
      inlineVolume: false,
    });

    if (!state.player) {
      state.player = createAudioPlayer();
      connection.subscribe(state.player);
    }

    state.isSpeaking = true;

    await new Promise((resolve) => {
      const checkInterrupt = setInterval(() => {
        if (state.interrupted) {
          state.player.stop(true);
          clearInterval(checkInterrupt);
          state.isSpeaking = false;
          state.interrupted = false;
          resolve();
        }
      }, 80);

      state.player.once(AudioPlayerStatus.Idle, () => {
        clearInterval(checkInterrupt);
        state.isSpeaking = false;
        resolve();
      });

      state.player.once('error', (err) => {
        clearInterval(checkInterrupt);
        addLog(`[Error] Player: ${err.message}`);
        state.isSpeaking = false;
        resolve();
      });

      state.player.play(resource);
    });
  } catch (err) {
    addLog(`[Error] TTS: ${err.message}`);
    getState(guildId).isSpeaking = false;
  }
}

function decodeOpusToPcm(opusChunks) {
  try {
    const OpusScript = require('opusscript');
    const decoder = new OpusScript(48000, 1, OpusScript.Application.AUDIO);
    const frames = [];
    for (const chunk of opusChunks) {
      try {
        const pcm = decoder.decode(chunk);
        frames.push(Buffer.from(pcm.buffer));
      } catch (_) {}
    }
    decoder.delete();
    return Buffer.concat(frames);
  } catch (err) {
    addLog(`[Error] Opus decode: ${err.message}`);
    return Buffer.alloc(0);
  }
}

async function joinVC(voiceChannel, textChannel, client) {
  const guildId = voiceChannel.guild.id;

  const existing = getVoiceConnection(guildId);
  if (existing) existing.destroy();

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  addLog(`[VC] Connecting to ${voiceChannel.name}...`);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    addLog(`[VC] Ready in ${voiceChannel.name}`);
  } catch (err) {
    addLog(`[Error] VC ready timeout: ${err.message}`);
    connection.destroy();
    throw err;
  }

  const state = getState(guildId);
  state.player = createAudioPlayer();
  connection.subscribe(state.player);

  const firstMember = voiceChannel.members.filter((m) => !m.user.bot).first();
  const greetName = firstMember?.user?.username || 'there';

  setTimeout(() => {
    speakInVC(connection, `Hey ${greetName}. I'm here. What's on your mind?`, guildId);
  }, 600);

  setupReceiver(connection, voiceChannel, client, guildId);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
      guildState.delete(guildId);
      addLog('[VC] Disconnected');
    }
  });
}

function setupReceiver(connection, voiceChannel, client, guildId) {
  const receiver = connection.receiver;

  receiver.speaking.on('start', (userId) => {
    if (userId === client.user?.id) return;

    const state = getState(guildId);

    if (state.isSpeaking) {
      addLog(`[VC] Interrupted by ${userId}`);
      state.interrupted = true;
    }

    if (state.processingUsers.has(userId)) return;

    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: SILENCE_TIMEOUT_MS,
      },
    });

    const opusChunks = [];
    opusStream.on('data', (chunk) => opusChunks.push(chunk));

    opusStream.on('end', async () => {
      if (state.processingUsers.has(userId)) return;
      state.processingUsers.add(userId);

      try {
        const pcmBuffer = decodeOpusToPcm(opusChunks);
        addLog(`[STT] ${opusChunks.length} opus chunks → ${pcmBuffer.length} pcm bytes`);

        if (pcmBuffer.length < MIN_PCM_BYTES) {
          addLog(`[STT] Too short, skipping`);
          return;
        }

        const member = voiceChannel.guild.members.cache.get(userId);
        const username = member?.user?.username || 'User';

        const transcript = await transcribeAudio(pcmBuffer);
        if (!transcript || transcript.trim().length < 2) {
          addLog(`[STT] Empty transcript`);
          return;
        }

        addLog(`[${username}] ${transcript}`);
        autoMemory(userId, username, transcript).catch(() => {});
        const memoryContext = buildMemoryContext(userId);
        const reply = await generateReply(userId, username, transcript, memoryContext, true);

        if (!state.interrupted) {
          await speakInVC(connection, reply, guildId);
        }
        state.interrupted = false;
      } catch (err) {
        addLog(`[Error] Pipeline: ${err.message}`);
      } finally {
        state.processingUsers.delete(userId);
      }
    });

    opusStream.on('error', (err) => {
      addLog(`[Error] Opus stream: ${err.message}`);
      state.processingUsers.delete(userId);
    });
  });
}

function leaveVC(guildId) {
  const connection = getVoiceConnection(guildId);
  if (connection) connection.destroy();
  guildState.delete(guildId);
  addLog('[VC] Left');
}

module.exports = { joinVC, leaveVC };
