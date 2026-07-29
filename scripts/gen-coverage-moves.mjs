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

// Varieties the scan drops for being unbreedable. Emitting rows for them would
// be harmless — the table is looked up by name and a row nothing asks for costs
// nothing — but a generated file that disagrees with what the app can show is
// the kind of quiet inconsistency that gets mistaken for a bug later. Throwing
// on a failed parse is deliberate: a silently empty exclusion set would restore
// the rows without saying so.
const forms = readFileSync(new URL('../src/lib/unbreedableForms.ts', import.meta.url), 'utf8');
const unbreedable = new Set(
  [...forms.matchAll(/variety:\s*'([^']+)',\s*species:\s*'[^']+',\s*breedable:\s*false/g)].map((m) => m[1])
);
if (unbreedable.size === 0) {
  throw new Error('parsed no entries out of UNBREEDABLE_FORMS — the table shape changed, fix this regex');
}
console.log(`unbreedable varieties excluded: ${[...unbreedable].sort().join(', ')}`);

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
const varieties = [...new Set(varietyLists.flat())].filter((v) => !unbreedable.has(v)).sort();
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

// Moves that pick their damage class at use time rather than carrying a fixed
// one. PokeAPI records a single class for them, so trusting it would hide the
// move from half the Pokemon that can genuinely use it. Counted for both.
// Listed in full rather than filtered to the current pool, so the list stays
// correct if a later regulation reintroduces one.
const ADAPTIVE_MOVES = new Set([
  'shell-side-arm',
  'photon-geyser',
  'tera-blast',
  'light-that-burns-the-sky'
]);

const table = {};
for (const [variety, moves] of varietyMoves) {
  const physical = new Set();
  const special = new Set();

  for (const move of moves.filter(isCoverageMove)) {
    const { type, damageClass } = moveMeta.get(move);
    const adaptive = ADAPTIVE_MOVES.has(move);
    if (adaptive || damageClass === 'physical') physical.add(type);
    if (adaptive || damageClass === 'special') special.add(type);
  }

  if (physical.size > 0 || special.size > 0) {
    table[variety] = { physical: [...physical].sort(), special: [...special].sort() };
  }
}

const summarize = (pick) => {
  const counts = Object.values(table).map((entry) => pick(entry).length).sort((a, b) => a - b);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  return `min ${counts[0]}, median ${counts[Math.floor(counts.length / 2)]}, mean ${mean.toFixed(1)}, max ${counts[counts.length - 1]}`;
};
const bothTypes = (entry) => [...new Set([...entry.physical, ...entry.special])];

console.log(`\nentries: ${Object.keys(table).length}`);
console.log(`  physical — ${summarize((e) => e.physical)}`);
console.log(`  special  — ${summarize((e) => e.special)}`);
console.log(`  either   — ${summarize(bothTypes)}`);

for (const check of ['garchomp', 'incineroar', 'pelipper', 'ditto', 'metagross']) {
  const entry = table[check];
  console.log(`  ${check.padEnd(12)} P:[${(entry?.physical || []).join(',')}] S:[${(entry?.special || []).join(',')}]`);
}

// 5. emit
const lines = Object.keys(table).sort().map((variety) => {
  const quoted = (types) => types.map((t) => `'${t}'`).join(', ');
  const { physical, special } = table[variety];
  return `  '${variety}': { physical: [${quoted(physical)}], special: [${quoted(special)}] }`;
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
