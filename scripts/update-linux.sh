#!/usr/bin/env bash
# Safe update for a Linux server running Incomu with pm2.
# Usage (from the project folder):  bash scripts/update-linux.sh ~/incomu-milestone28.zip
set -euo pipefail
ZIP="${1:-}"
APP="${PM2_NAME:-incomu}"
[ -n "$ZIP" ] && [ -f "$ZIP" ] || { echo "Give the path of the zip file, for example: bash scripts/update-linux.sh ~/incomu-milestone28.zip"; exit 1; }
[ -f index.js ] && [ -d src ] || { echo "Run this from the Incomu project folder."; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
echo "1/6 Stopping the bot..."
pm2 stop "$APP" >/dev/null 2>&1 || true

echo "2/6 Copying the database to ~/incomu-db-before-$STAMP"
mkdir -p "$HOME/incomu-db-before-$STAMP"
cp -a data/. "$HOME/incomu-db-before-$STAMP/" 2>/dev/null || echo "   (no data folder yet)"

echo "3/6 Unpacking the update..."
unzip -oq "$ZIP"

echo "4/6 Installing packages..."
npm install --omit=dev --no-audit --no-fund

echo "5/6 Running the tests..."
if ! node --test tests/*.test.js >/tmp/incomu-test.log 2>&1; then
  echo "Tests FAILED, so I did not start the new version. See /tmp/incomu-test.log"
  echo "Your database copy is in ~/incomu-db-before-$STAMP"
  exit 1
fi

echo "6/6 Starting the bot..."
pm2 start "$APP" >/dev/null 2>&1 || pm2 start ecosystem.config.js
pm2 save >/dev/null
echo "Done. If this update added or changed commands, also run: node src/deploy-commands.js"
