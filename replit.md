# Loaun Discord Bot

A fully autonomous Discord voice bot that joins voice channels, listens to users via Deepgram STT, generates conversational AI replies via OpenRouter, and speaks back with a deep calm voice via Deepgram TTS. Includes a live web dashboard for monitoring and control.

## Run & Operate

- `pnpm --filter @workspace/discord-bot run dev` — run the Discord bot
- `pnpm --filter @workspace/api-server run dev` — run the API server + bot dashboard
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Dashboard

Available at `/api/bot` — shows bot online status, uptime, live activity log, and a Restart button.

## Discord Commands

- `!joinvc` — bot joins your current voice channel and greets you
- `!leavevc` — bot leaves the voice channel
- `@Loaun <message>` — text chat (also works in DMs)
- `!remember <info>` — store a personal fact the bot will remember
- `!forget <keyword>` — remove a stored memory

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9 (api-server), CJS (discord-bot)
- API/Dashboard: Express 5 (api-server) serving `/api/bot`
- Discord: discord.js ^14, @discordjs/voice 0.17.0
- STT: Deepgram nova-2 (48kHz mono PCM → transcript)
- TTS: Deepgram aura-orion-en (deep calm voice, mono→stereo conversion)
- AI: OpenRouter `openai/gpt-4o-mini`

## Where things live

- `artifacts/discord-bot/src/app.js` — main bot entrypoint, message handling
- `artifacts/discord-bot/src/voice.js` — VC join/leave, Opus decode, STT→AI→TTS pipeline
- `artifacts/discord-bot/src/ai.js` — OpenRouter chat completions
- `artifacts/discord-bot/src/stt.js` — Deepgram streaming STT
- `artifacts/discord-bot/src/tts.js` — Deepgram TTS + mono→stereo
- `artifacts/discord-bot/src/memory.js` — per-user memory store
- `artifacts/discord-bot/src/logger.js` — shared logger + status file at `/tmp/bot-status.json`
- `artifacts/api-server/src/routes/bot.ts` — dashboard HTML + status/restart API

## Architecture decisions

- Bot writes status to `/tmp/bot-status.json` every 5s; api-server reads it — avoids needing a second HTTP server
- Dashboard is served from api-server at `/api/bot` (the only properly registered web artifact)
- Voice uses `stateChange` events instead of `entersState` await to avoid 20s timeout errors
- Opus → PCM decoded with `opusscript` (pure JS, no native compilation required for STT input)
- TTS output is mono PCM from Deepgram; converted to stereo in-process before sending to Discord

## Environment Secrets Required

- `DISCORD_TOKEN` — bot token from Discord Developer Portal
- `OPENROUTER_API_KEY` — OpenRouter API key
- `DEEPGRAM_API_KEY` — Deepgram API key

## User preferences

- Bot name: Loaun
- Voice: deep, calm (aura-orion-en)
- Personality: conversational, ends replies with an engaging question

## Gotchas

- `sodium-native` needs `onlyBuiltDependencies` in `pnpm-workspace.yaml` for native crypto
- Do NOT run `pnpm dev` at the workspace root — use `pnpm --filter @workspace/<name> run dev`
- Dashboard polling URL is `/api/bot/status` (relative) — works from any domain
- If the bot shows "already joined" errors, the previous connection wasn't destroyed cleanly — `!leavevc` then `!joinvc`

## runing 

const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Keepalive server running on port ${PORT}`);
});