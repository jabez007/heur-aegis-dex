#!/usr/bin/env bash
# Verifies catalog loading stays lazy and live acquisition stays out of the
# production application and package bundles.
set -eu
cd "$(dirname "$0")/.." || { echo "cannot reach repository root" >&2; exit 2; }

ENTRY=$(grep -o 'assets/index-[^" ]*\.js' dist/index.html | sed -n '1p')
CATALOG=$(find dist/assets -maxdepth 1 -name 'pokemon-catalog.v1-*.js' -print -quit)

[ -n "$ENTRY" ] || { echo "MISSING: application entry chunk" >&2; exit 1; }
[ -n "$CATALOG" ] || { echo "MISSING: lazy Pokemon catalog chunk" >&2; exit 1; }

if grep -q 'eed7925e3158c9f744816768d3cc3395e290127f' "dist/$ENTRY"; then
  echo "BUG PRESENT: catalog payload was embedded in the initial application chunk" >&2
  exit 1
fi
if grep -R -q 'NodeCache\|pokedex-promise-v2' dist/assets lib; then
  echo "BUG PRESENT: live PokeAPI client reached a production bundle" >&2
  exit 1
fi

node -e "import('./lib/heur-aegis-dex.es.js').then(m => m.getBaseTypes()).then(t => { if (t.length !== 18) process.exit(1) })"
node -e "Promise.resolve(require('./lib/heur-aegis-dex.cjs').getBaseTypes()).then(t => { if (t.length !== 18) process.exit(1) })"

echo "HEALTHY: catalog is lazy and production bundles contain no live PokeAPI client"
echo "  app entry: $ENTRY"
echo "  catalog chunk: ${CATALOG#dist/}"
