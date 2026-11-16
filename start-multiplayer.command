#!/bin/bash
# Doppelklick startet den E46-DRIFT-Multiplayer-Server (Hotspot / WLAN)
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js wurde nicht gefunden. Bitte von https://nodejs.org installieren."
  read -n 1 -s -r -p "Taste drücken zum Schließen"
  exit 1
fi
node server.js
