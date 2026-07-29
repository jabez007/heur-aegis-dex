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
# Guarded: the next thing this script does is `rm -rf node_modules/.vite`, and
# without `set -e` a failed cd would run that against whatever directory the
# script was invoked from.
cd "$(dirname "$0")/.." || { echo "cannot reach repository root" >&2; exit 2; }

PORT=${1:-5299}
DEP=node_modules/.vite/deps/pokedex-promise-v2.js
LOG=$(mktemp -t repro-vite.XXXXXX)

rm -rf node_modules/.vite
timeout 45 npx vite --port "$PORT" >"$LOG" 2>&1 &
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

# The vite log is the only diagnostic when this comes back INCONCLUSIVE, so keep
# it on anything but a clean pass and say where it is.
if [ $RESULT -eq 0 ]; then
  rm -f "$LOG"
else
  echo "  vite log: $LOG"
fi
exit $RESULT
