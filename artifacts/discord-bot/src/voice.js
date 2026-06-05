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
const READY_TIMEOUT_MS = 25000; // 25s to reach Ready before we retry
const MAX_RETRIES = 3;

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

async function connectWithRetry(voiceChannel, client, retryCount = 0) {
  const guildId = voiceChannel.guild.id;

  const existing = getVoiceConnection(guildId);
  if (existing) {
    existing.destroy();
    await new Promise((r) => setTimeout(r, 800));
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  addLog(`[VC] Attempt ${retryCount + 1} — state: ${connection.state.status}`);

  const state = getState(guildId);
  state.greeted = false;
  state.player = createAudioPlayer();
  connection.subscribe(state.player);

  const firstMember = voiceChannel.members.filter((m) => !m.user.bot).first();
  const greetName = firstMember?.user?.username || 'there';

  return new Promise((resolve) => {
    let readyTimer = null;
    let resolved = false;

    function done(success) {
      if (resolved) return;
      resolved = true;
      if (readyTimer) clearTimeout(readyTimer);
      resolve(success ? connection : null);
    }

    async function greet() {
      if (state.greeted) return;
      state.greeted = true;
      addLog(`[VC] Ready! Greeting ${greetName}`);
      setupReceiver(connection, voiceChannel, client, guildId);
      await speakInVC(connection, `Hey ${greetName}. I'm here. What's on your mind?`, guildId);
      done(true);
    }

    // Already Ready when listener attaches (very rare)
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
        done(false);
      }
    });

    // Log internal debug events from @discordjs/voice
    connection.on('debug', (msg) => {
      // Only log short messages to avoid flooding
      const short = msg.replace(/\s+/g, ' ').slice(0, 180);
      addLog(`[VCdbg] ${short}`);
    });

    connection.on('error', (err) => {
      addLog(`[Error] Connection: ${err.message}`);
    });

    // Watchdog: if not Ready in READY_TIMEOUT_MS, retry or give up
    readyTimer = setTimeout(async () => {
      if (resolved) return;
      addLog(`[VC] Timed out reaching Ready (attempt ${retryCount + 1})`);
      connection.destroy();
      guildState.delete(guildId);

      if (retryCount < MAX_RETRIES) {
        addLog(`[VC] Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, 1500));
        const retryConn = await connectWithRetry(voiceChannel, client, retryCount + 1);
        resolve(retryConn);
      } else {
        addLog('[VC] All retries failed — check network/UDP');
        done(false);
      }
    }, READY_TIMEOUT_MS);

    // Handle disconnect: try to reconnect
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      addLog('[VC] Disconnected');
      try {
        await new Promise((_, r) => setTimeout(r, 5000, new Error('timeout')));
      } catch (_) {
        if (!resolved) {
          connection.destroy();
          guildState.delete(guildId);
          done(false);
        }
      }
    });
  });
}

async function joinVC(voiceChannel, textChannel, client) {
  const guildId = voiceChannel.guild.id;
  addLog(`[VC] Joining ${voiceChannel.name}`);
  const connection = await connectWithRetry(voiceChannel, client, 0);
  if (!connection) {
    addLog('[VC] Could not connect to voice channel after retries');
    textChannel.send("Couldn't connect to voice — check the Live Activity log on the dashboard.").catch(() => {});
  }
}

function setupReceiver(connection, voiceChannel, client, guildId) {
  const receiver = connection.receiver;

  receiver.speaking.on('start', (userId) => {
    if (userId === client.user?.id) return;
    const state = getState(guildId);

    if (state.isSpeaking) {
      addLog('[VC] Interrupted by user');
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
        addLog(`[STT] ${opusChunks.length} chunks → ${pcm.length}B PCM`);
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
