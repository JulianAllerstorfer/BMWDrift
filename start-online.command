#!/bin/bash
# Doppelklick startet den Server UND einen ngrok-Tunnel, damit Freunde übers Internet mitspielen können
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT=${PORT:-8046}
for t in node ngrok; do
  if ! command -v $t >/dev/null 2>&1; then echo "$t wurde nicht gefunden."; read -n 1 -s -r -p "Taste drücken zum Schließen"; exit 1; fi
done
ngrok http $PORT --log=stdout > /tmp/bmwdrift-ngrok.log 2>&1 &
NGROK_PID=$!
trap 'kill $NGROK_PID 2>/dev/null' EXIT
URL=""
for i in $(seq 1 30); do
  URL=$(curl -s http://127.0.0.1:4040/api/tunnels | grep -o '"public_url":"https://[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$URL" ] && break
  sleep 0.5
done
if [ -z "$URL" ]; then
  echo "ngrok-Tunnel konnte nicht gestartet werden:"; tail -5 /tmp/bmwdrift-ngrok.log
  read -n 1 -s -r -p "Taste drücken zum Schließen"; exit 1
fi
echo "$URL" | pbcopy
echo ""
echo "  >>> Link für deinen Kollegen (schon in der Zwischenablage): $URL"
PUBLIC_URL="$URL" node server.js
