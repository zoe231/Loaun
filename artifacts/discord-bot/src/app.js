require('dotenv').config();
const { Client, GatewayIntentBits, Partials, MessageFlags } = require('discord.js');
const { generateReply } = require('./ai');
const { remember, forget, forgetAll, buildMemoryContext, autoMemory } = require('./memory');
const { joinVC, leaveVC } = require('./voice');
const { transcribeVoiceNote } = require('./stt');
const { addLog, flushStatus, markOffline } = require('./logger');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once('clientReady', () => {
  addLog(`Online as ${client.user.tag}`);
  flushStatus({ tag: client.user.tag });
  setInterval(() => flushStatus({ tag: client.user.tag }), 5000);
});

process.on('exit', markOffline);
process.on('SIGTERM', () => { markOffline(); process.exit(0); });

const processed = new Set();

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (processed.has(message.id)) return;
  processed.add(message.id);
  if (processed.size > 500) processed.delete(processed.values().next().value);

  const content = message.content.trim();
  const userId = message.author.id;
  const username = message.author.username;

  // ── Commands (no mention needed) ──────────────────────────────────────────
  if (content.startsWith(':remember ')) {
    const fact = content.slice(':remember '.length).trim();
    remember(userId, username, fact);
    addLog(`[Memory] Stored for ${username}: "${fact}"`);
    return message.reply(`Got it. I'll remember that.`);
  }

  if (content.startsWith(':forget ')) {
    const keyword = content.slice(':forget '.length).trim();
    const deleted = forget(userId, keyword);
    return message.reply(deleted ? `Done, I've cleared that.` : `Nothing matched that.`);
  }

  if (content === ':forgetall') {
    forgetAll(userId);
    return message.reply(`Wiped everything I had on you.`);
  }

  if (content === ':memory') {
    const ctx = buildMemoryContext(userId);
    return message.reply(ctx ? `What I know about you:\n${ctx}` : `I don't have any memories about you yet.`);
  }

  if (content === ':joinvc') {
    if (!message.member?.voice?.channel) {
      return message.reply('You need to be in a voice channel first.');
    }
    addLog(`[CMD] :joinvc by ${username}`);
    joinVC(message.member.voice.channel, message.channel, client).catch((err) => {
      addLog(`[Error] joinvc: ${err.message}`);
    });
    return message.reply('Joining now — give me a moment to connect audio.');
  }

  if (content === ':leavevc') {
    addLog(`[CMD] :leavevc by ${username}`);
    leaveVC(message.guild.id);
    return message.reply('Left.');
  }

  if (content === ':help') {
    return message.reply(
      '**Loaun Commands**\n' +
      '`:joinvc` — join your voice channel\n' +
      '`:leavevc` — leave voice channel\n' +
      '`:memory` — see what I know about you\n' +
      '`:remember <fact>` — store something for me to remember\n' +
      '`:forget <keyword>` — remove a memory\n' +
      '`:forgetall` — wipe all your memories\n' +
      '\nYou can also mention me or DM me to chat.'
    );
  }

  // ── Voice notes (Discord audio messages sent in chat) ─────────────────────
  const isVoiceNote =
    message.flags?.has?.(MessageFlags.IsVoiceMessage) ||
    message.attachments?.some?.((a) => a.contentType?.startsWith('audio/'));

  if (isVoiceNote) {
    const attachment = message.attachments?.first?.();
    if (!attachment) return;
    addLog(`[VoiceNote] from ${username}`);
    try {
      await message.channel.sendTyping();
      const transcript = await transcribeVoiceNote(attachment.url);
      if (!transcript || transcript.length < 2) {
        return message.reply("Couldn't make out what you said — try again?");
      }
      addLog(`[VoiceNote] ${username}: ${transcript}`);
      autoMemory(userId, username, transcript).catch(() => {});
      const memoryContext = buildMemoryContext(userId);
      const reply = await generateReply(userId, username, transcript, memoryContext, false);
      return message.reply(reply);
    } catch (err) {
      addLog(`[Error] VoiceNote: ${err.message}`);
      return message.reply("Had trouble processing that — sorry.");
    }
  }

  // ── Text replies (mention or DM) ──────────────────────────────────────────
  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;
  if (!isMentioned && !isDM) return;

  const cleanContent = content.replace(/<@!?\d+>/g, '').trim();
  if (!cleanContent) {
    return message.reply('Yeah?');
  }

  let replied = false;
  try {
    await message.channel.sendTyping();
    autoMemory(userId, username, cleanContent).catch(() => {});
    const memoryContext = buildMemoryContext(userId);
    const reply = await generateReply(userId, username, cleanContent, memoryContext, false);
    replied = true;
    if (reply.length > 1990) {
      const chunks = reply.match(/.{1,1990}/gs);
      for (const chunk of chunks) await message.reply(chunk);
    } else {
      await message.reply(reply);
    }
  } catch (err) {
    addLog(`[Error] Text reply: ${err.message}`);
    if (!replied) message.reply('Something went wrong, try again.').catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
