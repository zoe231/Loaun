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
const MIN_PCM_BYTES = 9600;

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

    if (state.interrupted) {
      state.interrupted = false;
      return;
    }

    const stream = new Readable();
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
      const done = () => {
        state.isSpeaking = false;
        resolve();
      };

      const checkInterrupt = setInterval(() => {
        if (state.interrupted) {
          state.player.stop(true);
          clearInterval(checkInterrupt);
          state.player.removeListener(AudioPlayerStatus.Idle, done);
          state.isSpeaking = false;
          state.interrupted = false;
          resolve();
        }
      }, 80);

      state.player.once(AudioPlayerStatus.Idle, () => {
        clearInterval(checkInterrupt);
        done();
      });

      state.player.play(resource);
    });
  } catch (err) {
    console.error('[TTS] Error:', err.message);
    addLog(`[Error] TTS failed: ${err.message}`);
    const state = getState(guildId);
    state.isSpeaking = false;
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
    console.error('[Opus] Decode error:', err.message);
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

  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  addLog(`[VC] Joined channel: ${voiceChannel.name}`);

  const state = getState(guildId);
  state.player = createAudioPlayer();
  connection.subscribe(state.player);

  const firstMember = voiceChannel.members.filter((m) => !m.user.bot).first();
  const greetName = firstMember?.user?.username || 'there';

  setTimeout(async () => {
    await speakInVC(
      connection,
      `Hey ${greetName}. I'm here. What's on your mind?`,
      guildId
    );
  }, 800);

  const receiver = connection.receiver;

  receiver.speaking.on('start', (userId) => {
    if (userId === client.user?.id) return;

    const curState = getState(guildId);

    if (curState.isSpeaking) {
      addLog(`[VC] Interrupted by user ${userId}`);
      curState.interrupted = true;
    }

    if (curState.processingUsers.has(userId)) return;

    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: SILENCE_TIMEOUT_MS,
      },
    });

    const opusChunks = [];
    opusStream.on('data', (chunk) => opusChunks.push(chunk));

    opusStream.on('end', async () => {
      if (curState.processingUsers.has(userId)) return;
      curState.processingUsers.add(userId);

      try {
        const pcmBuffer = decodeOpusToPcm(opusChunks);
        if (pcmBuffer.length < MIN_PCM_BYTES) return;

        const member = voiceChannel.guild.members.cache.get(userId);
        const username = member?.user?.username || 'User';

        addLog(`[${username}] (transcribing ${pcmBuffer.length} bytes...)`);
        const transcript = await transcribeAudio(pcmBuffer);
        if (!transcript || transcript.trim().length < 2) return;

        addLog(`[${username}] ${transcript}`);
        await autoMemory(userId, username, transcript);
        const memoryContext = buildMemoryContext(userId);
        const reply = await generateReply(userId, username, transcript, memoryContext, true);

        if (!curState.interrupted) {
          await speakInVC(connection, reply, guildId);
        }
        curState.interrupted = false;
      } catch (err) {
        console.error('[Pipeline] Error:', err.message);
        addLog(`[Error] ${err.message}`);
      } finally {
        curState.processingUsers.delete(userId);
      }
    });
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
      guildState.delete(guildId);
      addLog('[VC] Disconnected and cleaned up');
    }
  });
}

function leaveVC(guildId) {
  const connection = getVoiceConnection(guildId);
  if (connection) {
    connection.destroy();
  }
  guildState.delete(guildId);
  addLog('[VC] Left voice channel');
}

module.exports = { joinVC, leaveVC };
