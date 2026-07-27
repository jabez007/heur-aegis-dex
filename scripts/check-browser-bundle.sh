#!/usr/bin/env bash
# Verifies the browser bundle does not externalize a Node builtin that runtime
# code actually touches.
#
# Checks Vite's dev-server
# optimized dep for pokedex-promise-v2. Node's `events` builtin gets externalized
# for the browser unless the `events` npm polyfill is installed, and node-cache
# does `class NodeCache extends require('events').EventEmitter`, so the module
# throws at import time.
#
# Exits 0 when healthy, 1 when the bug is present.
set -u
cd "$(dirname "$0")/.."

PORT=${1:-5299}
DEP=node_modules/.vite/deps/pokedex-promise-v2.js

rm -rf node_modules/.vite
timeout 45 npx vite --port "$PORT" >/tmp/repro-vite.log 2>&1 &
VITE_PID=$!

# Requesting the entry forces dep optimization to run.
for _ in $(seq 1 30); do
  sleep 1
  curl -s -o /dev/null "http://localhost:$PORT/heur-aegis-dex/" 2>/dev/null && break
done
curl -s -o /dev/null "http://localhost:$PORT/heur-aegis-dex/src/main.ts" 2>/dev/null

for _ in $(seq 1 20); do
  [ -f "$DEP" ] && break
  sleep 1
done

RESULT=0
if [ ! -f "$DEP" ]; then
  echo "INCONCLUSIVE: optimized dep never produced"
  RESULT=2
elif grep -q "has been externalized for browser compatibility" "$DEP"; then
  echo "BUG PRESENT: events externalized in pokedex-promise-v2 optimized dep"
  grep -o 'Module "[a-z]*" has been externalized[^"]*' "$DEP" | sort -u | head -3
  RESULT=1
else
  echo "HEALTHY: no externalization stub in optimized dep"
  grep -c "EventEmitter" "$DEP" | xargs echo "  EventEmitter references:"
fi

kill $VITE_PID 2>/dev/null
wait $VITE_PID 2>/dev/null
exit $RESULT
