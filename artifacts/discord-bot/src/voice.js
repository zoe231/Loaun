require('dotenv').config();
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
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
      greeted: false,
    });
  }
  return guildState.get(guildId);
}

async function speakInVC(connection, text, guildId) {
  const state = getState(guildId);
  if (state.interrupted) { state.interrupted = false; return; }

  addLog(`[Loaun] ${text}`);
  try {
    const pcmBuffer = await textToSpeech(text);
    if (state.interrupted) { state.interrupted = false; return; }

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
      try { frames.push(Buffer.from(decoder.decode(chunk).buffer)); } catch (_) {}
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

  addLog(`[VC] Joining ${voiceChannel.name} — initial state: ${connection.state.status}`);

  const state = getState(guildId);
  state.greeted = false;
  state.player = createAudioPlayer();
  connection.subscribe(state.player);

  const firstMember = voiceChannel.members.filter((m) => !m.user.bot).first();
  const greetName = firstMember?.user?.username || 'there';

  async function greet() {
    if (state.greeted) return;
    state.greeted = true;
    addLog(`[VC] Ready — greeting ${greetName}`);
    await speakInVC(connection, `Hey ${greetName}. I'm here. What's on your mind?`, guildId);
  }

  // Already Ready by the time we attach the listener (rare but possible)
  if (connection.state.status === VoiceConnectionStatus.Ready) {
    greet();
  }

  connection.on('stateChange', (oldState, newState) => {
    addLog(`[VC] ${oldState.status} → ${newState.status}`);
    if (newState.status === VoiceConnectionStatus.Ready) {
      greet();
    }
    if (newState.status === VoiceConnectionStatus.Destroyed) {
      guildState.delete(guildId);
    }
  });

  connection.on('error', (err) => {
    addLog(`[Error] Connection: ${err.message}`);
  });

  // Auto-reconnect on disconnect
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    addLog('[VC] Disconnected — attempting rejoin');
    try {
      await Promise.race([
        new Promise((_, r) => setTimeout(r, 5000, new Error('timeout'))),
      ]);
    } catch (_) {
      connection.destroy();
      guildState.delete(guildId);
      addLog('[VC] Gave up rejoining');
    }
  });

  setupReceiver(connection, voiceChannel, client, guildId);
}

function setupReceiver(connection, voiceChannel, client, guildId) {
  const receiver = connection.receiver;

  receiver.speaking.on('start', (userId) => {
    if (userId === client.user?.id) return;
    const state = getState(guildId);

    if (state.isSpeaking) {
      addLog('[VC] Interrupted by user speech');
      state.interrupted = true;
    }
    if (state.processingUsers.has(userId)) return;

    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_TIMEOUT_MS },
    });
    const opusChunks = [];
    opusStream.on('data', (c) => opusChunks.push(c));

    opusStream.on('end', async () => {
      if (state.processingUsers.has(userId)) return;
      state.processingUsers.add(userId);
      try {
        const pcm = decodeOpusToPcm(opusChunks);
        addLog(`[STT] ${opusChunks.length} Opus chunks → ${pcm.length}B PCM`);
        if (pcm.length < MIN_PCM_BYTES) { addLog('[STT] Too short, skipping'); return; }

        const member = voiceChannel.guild.members.cache.get(userId);
        const username = member?.user?.username || 'User';
        const transcript = await transcribeAudio(pcm);
        if (!transcript || transcript.trim().length < 2) { addLog('[STT] Empty — skipping'); return; }

        addLog(`[${username}] ${transcript}`);
        autoMemory(userId, username, transcript).catch(() => {});
        const reply = await generateReply(userId, username, transcript, buildMemoryContext(userId), true);

        if (!state.interrupted) await speakInVC(connection, reply, guildId);
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
  addLog('[VC] Left channel');
}

module.exports = { joinVC, leaveVC };
