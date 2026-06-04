require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { generateReply } = require('./ai');
const { remember, forget, buildMemoryContext, autoMemory } = require('./memory');
const { joinVC, leaveVC } = require('./voice');
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

  if (content.startsWith('!remember ')) {
    remember(userId, username, content.slice('!remember '.length).trim());
    return message.reply('Got it.');
  }

  if (content.startsWith('!forget ')) {
    const deleted = forget(userId, content.slice('!forget '.length).trim());
    return message.reply(deleted ? 'Forgotten.' : 'Nothing matched.');
  }

  if (content === '!joinvc') {
    if (!message.member?.voice?.channel) {
      return message.reply('Join a voice channel first.');
    }
    addLog(`[CMD] !joinvc by ${username}`);
    joinVC(message.member.voice.channel, message.channel, client).catch((err) => {
      addLog(`[Error] joinvc: ${err.message}`);
    });
    return message.reply('Joined. Connecting audio now...');
  }

  if (content === '!leavevc') {
    addLog(`[CMD] !leavevc by ${username}`);
    leaveVC(message.guild.id);
    return message.reply('Left.');
  }

  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;
  if (!isMentioned && !isDM) return;

  const cleanContent = content.replace(/<@!?\d+>/g, '').trim();
  if (!cleanContent) return message.reply('Yeah?');

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
    addLog(`[Error] ${err.message}`);
    if (!replied) message.reply('Something went wrong, try again.').catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
