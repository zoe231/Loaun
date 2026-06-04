require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { generateReply } = require('./ai');
const { remember, forget, buildMemoryContext, autoMemory } = require('./memory');
const { joinVC, leaveVC } = require('./voice');
const { addLog } = require('./logger');
const { startDashboard } = require('./dashboard');

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

startDashboard(client);

client.once('clientReady', () => {
  addLog(`Online as ${client.user.tag}`);
});

const processed = new Set();

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (processed.has(message.id)) return;
  processed.add(message.id);
  if (processed.size > 500) {
    const first = processed.values().next().value;
    processed.delete(first);
  }

  const content = message.content.trim();
  const userId = message.author.id;
  const username = message.author.username;

  if (content.startsWith('!remember ')) {
    const fact = content.slice('!remember '.length).trim();
    remember(userId, username, fact);
    return message.reply('Got it.');
  }

  if (content.startsWith('!forget ')) {
    const keyword = content.slice('!forget '.length).trim();
    const deleted = forget(userId, keyword);
    return message.reply(deleted ? 'Forgotten.' : 'Nothing matched.');
  }

  if (content === '!joinvc') {
    if (!message.member?.voice?.channel) {
      return message.reply('Join a voice channel first.');
    }
    addLog(`[CMD] !joinvc by ${username}`);
    await joinVC(message.member.voice.channel, message.channel, client).catch((err) => {
      addLog(`[Error] joinvc: ${err.message}`);
      message.reply(`Could not join: ${err.message}`);
    });
    return;
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
    console.error('Message error:', err);
    addLog(`[Error] ${err.message}`);
    if (!replied) message.reply('Something went wrong, try again.').catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
