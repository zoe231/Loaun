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

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
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
    try {
      addLog(`[CMD] !joinvc by ${username}`);
      await joinVC(message.member.voice.channel, message.channel, client);
      return message.reply('Joined.');
    } catch (err) {
      console.error('Join VC error:', err);
      addLog(`[Error] joinvc failed: ${err.message}`);
      return message.reply(`Could not join: ${err.message}`);
    }
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

  try {
    await message.channel.sendTyping();
    await autoMemory(userId, username, cleanContent);
    const memoryContext = buildMemoryContext(userId);
    const reply = await generateReply(userId, username, cleanContent, memoryContext, false);
    if (reply.length > 1990) {
      const chunks = reply.match(/.{1,1990}/gs);
      for (const chunk of chunks) await message.reply(chunk);
    } else {
      await message.reply(reply);
    }
  } catch (err) {
    console.error('Message error:', err);
    message.reply('Something broke, try again.');
  }
});

client.login(process.env.DISCORD_TOKEN);
