// Generates the coverage-move table from PokeAPI's `champions` version group,
// which is the actual Pokemon Champions movepool rather than a union across
// games. Keyed by PokeAPI *variety* name, matching what the app already holds.

import { readFileSync, writeFileSync } from 'node:fs';

const MIN_POWER = 60;
const CONCURRENCY = 12;
const VERSION_GROUP = 'champions';

const regs = readFileSync(new URL('../src/lib/regulations.ts', import.meta.url), 'utf8');
const grab = (label) => {
  const block = regs.split(`const ${label} = [`)[1].split('] as const;')[0];
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};
const species = [...new Set([...grab('M_A_SPECIES'), ...grab('M_B_ADDITIONS')])].sort();
console.log(`legal species: ${species.length}`);

const mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
};

const getJson = async (url) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error(`failed: ${url}`);
};

// 1. species -> varieties
const varietyLists = await mapLimit(species, CONCURRENCY, async (name) => {
  const data = await getJson(`https://pokeapi.co/api/v2/pokemon-species/${name}/`);
  return (data?.varieties || []).map((v) => v.pokemon.name);
});
const varieties = [...new Set(varietyLists.flat())].sort();
console.log(`varieties: ${varieties.length}`);

// 2. variety -> champions-legal move names
const varietyMoves = new Map();
await mapLimit(varieties, CONCURRENCY, async (variety) => {
  const data = await getJson(`https://pokeapi.co/api/v2/pokemon/${variety}/`);
  if (!data) return;
  const names = (data.moves || [])
    .filter((m) => m.version_group_details.some((d) => d.version_group.name === VERSION_GROUP))
    .map((m) => m.move.name);
  varietyMoves.set(variety, names);
});

const withMoves = [...varietyMoves.values()].filter((m) => m.length > 0).length;
console.log(`varieties with a champions learnset: ${withMoves}/${varieties.length}`);

// 3. move metadata
const allMoves = [...new Set([...varietyMoves.values()].flat())].sort();
console.log(`distinct moves: ${allMoves.length}`);
const moveMeta = new Map();
await mapLimit(allMoves, CONCURRENCY, async (move) => {
  const data = await getJson(`https://pokeapi.co/api/v2/move/${move}/`);
  if (!data) return;
  moveMeta.set(move, {
    type: data.type?.name,
    power: data.power,
    damageClass: data.damage_class?.name
  });
});

// 4. keep damaging moves at or above the power floor
const isCoverageMove = (move) => {
  const meta = moveMeta.get(move);
  return !!meta && meta.damageClass !== 'status' && typeof meta.power === 'number' && meta.power >= MIN_POWER;
};

const table = {};
for (const [variety, moves] of varietyMoves) {
  const types = [...new Set(moves.filter(isCoverageMove).map((m) => moveMeta.get(m).type))].sort();
  if (types.length > 0) table[variety] = types;
}

const counts = Object.values(table).map((t) => t.length);
counts.sort((a, b) => a - b);
const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
console.log(`\nentries: ${Object.keys(table).length}`);
console.log(`coverage types per entry — min ${counts[0]}, median ${counts[Math.floor(counts.length / 2)]}, mean ${mean.toFixed(1)}, max ${counts[counts.length - 1]}`);

for (const check of ['garchomp', 'incineroar', 'gholdengo', 'ditto', 'metagross']) {
  console.log(`  ${check.padEnd(12)} ${(table[check] || []).join(', ') || '(none)'}`);
}

// 5. emit
const lines = Object.keys(table).sort().map((variety) => {
  const types = table[variety].map((t) => `'${t}'`).join(', ');
  return `  '${variety}': [${types}]`;
});
writeFileSync('coverage-table.txt', lines.join(',\n') + '\n');
writeFileSync('coverage-stats.json', JSON.stringify({
  minPower: MIN_POWER,
  versionGroup: VERSION_GROUP,
  entries: Object.keys(table).length,
  varieties: varieties.length,
  distinctMoves: allMoves.length
}, null, 2));
console.log('\nwrote coverage-table.txt');
