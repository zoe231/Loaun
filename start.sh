#!/bin/sh
# Loaun production startup
# Starts Discord bot in background, API server in foreground

echo "[startup] Starting Loaun Discord bot..."
node artifacts/discord-bot/src/app.js &
BOT_PID=$!
echo "[startup] Bot started (pid $BOT_PID)"

echo "[startup] Starting API server..."
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
