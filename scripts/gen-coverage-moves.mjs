// Generates the coverage-move table from PokeAPI's `champions` version group,
// which is the actual Pokemon Champions movepool rather than a union across
// games. Keyed by PokeAPI *variety* name, matching what the app already holds.
//
// Also emits the status-move table, from the same fetch. Coverage asks what a
// Pokemon can hit; status asks what it can inflict, and the second question was
// unanswerable until this ran — which is why every status-facing ability in the
// model was a hand-picked constant. See STATUS_THREAT in statusThreat.ts.
//
// ## The roster is the game's, not the regulation's
//
// This used to read its species list out of regulations.ts, which conflated two
// different things: what exists in Champions, and what a regulation currently
// permits. They coincide exactly today — the Champions Pokedex holds 208 species
// and Regulation M-B legalizes the same 208 — and that coincidence is precisely
// why the conflation went unnoticed and why it is worth removing before a later
// regulation narrows legality and silently deletes movepools for Pokemon that
// still exist.
//
// It also settles a question that looks like it needs a bigger crawl. Species
// outside this Pokedex have no `champions` learnset at all, so widening the run
// to the full 1,025-species National Dex fetches several thousand pages and
// emits nothing: 20 species sampled across the dex from outside the roster
// returned zero champions moves between them. The table is complete when it
// covers this Pokedex. What the National Dex does affect is the *threat pool* —
// see COVERAGE_MOVE_POKEDEX in coverageMoves.ts.

import { readFileSync, writeFileSync } from 'node:fs';

const MIN_POWER = 60;
const CONCURRENCY = 12;
const VERSION_GROUP = 'champions';
const POKEDEX = 'champions';

const getJson = async (url) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error(`failed: ${url}`);
};

const pokedex = await getJson(`https://pokeapi.co/api/v2/pokedex/${POKEDEX}/`);
const species = (pokedex?.pokemon_entries || []).map((e) => e.pokemon_species.name).sort();
if (species.length === 0) {
  throw new Error(`the ${POKEDEX} pokedex returned no entries — refusing to emit an empty table`);
}
console.log(`${POKEDEX} pokedex species: ${species.length}`);

// The regulation is no longer the source, so report the difference rather than
// assuming it stays zero. A species legal in a regulation but absent from the
// game is a data error worth seeing; the reverse is just a narrow regulation.
const regs = readFileSync(new URL('../src/lib/regulations.ts', import.meta.url), 'utf8');
const grab = (label) => {
  const block = regs.split(`const ${label} = [`)[1].split('] as const;')[0];
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};
const legal = new Set([...grab('M_A_SPECIES'), ...grab('M_B_ADDITIONS')]);
const legalNotInGame = [...legal].filter((name) => !species.includes(name)).sort();
const inGameNotLegal = species.filter((name) => !legal.has(name));
console.log(`regulation legal species: ${legal.size}`);
console.log(`  in the game but not legal: ${inGameNotLegal.length}`);
if (legalNotInGame.length > 0) {
  console.log(`  LEGAL BUT NOT IN THE GAME: ${legalNotInGame.join(', ')}`);
}

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
    damageClass: data.damage_class?.name,
    ailment: data.meta?.ailment?.name,
    ailmentChance: data.meta?.ailment_chance,
    accuracy: data.accuracy
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

// The five non-volatile status conditions, which are the ones an ability like
// Purifying Salt blocks and the ones that persist across turns. Confusion and
// its kin are deliberately absent: they are volatile, they are not blocked by
// the same abilities, and treating them alike would overstate every number
// downstream.
const NON_VOLATILE_AILMENTS = new Set(['burn', 'paralysis', 'poison', 'sleep', 'freeze']);

// What counts as *being able to inflict* a status.
//
// The bar is reliability, for the same reason the coverage table has a power
// floor: a move that lands the status one time in ten describes a Pokemon that
// does not really have that tool. So a status-class move whose whole purpose is
// the ailment counts (Will-O-Wisp, Thunder Wave, Spore), and so does a damaging
// move that inflicts it every time (Nuzzle at 100%). A 10% burn on Flamethrower
// does not.
//
// Accuracy is deliberately not a factor. Will-O-Wisp at 85% is still a Pokemon
// that burns things; folding accuracy in here would make this a damage
// calculator rather than a capability table.
const isStatusMove = (move) => {
  const meta = moveMeta.get(move);
  if (!meta || !meta.ailment || !NON_VOLATILE_AILMENTS.has(meta.ailment)) return false;
  return meta.damageClass === 'status' || meta.ailmentChance === 100;
};

const statusTable = {};
for (const [variety, moves] of varietyMoves) {
  const ailments = new Set();
  for (const move of moves.filter(isStatusMove)) ailments.add(moveMeta.get(move).ailment);
  if (ailments.size > 0) statusTable[variety] = [...ailments].sort();
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

const statusLines = Object.keys(statusTable).sort().map((variety) =>
  `  '${variety}': [${statusTable[variety].map((a) => `'${a}'`).join(', ')}]`
);
writeFileSync('status-table.txt', statusLines.join(',\n') + '\n');

// Frequency across the pool, which is the number the ability model needs. Each
// ailment is counted per variety that can inflict it at all.
const ailmentCounts = {};
for (const ailments of Object.values(statusTable)) {
  for (const ailment of ailments) ailmentCounts[ailment] = (ailmentCounts[ailment] || 0) + 1;
}
const varietyCount = varieties.length;
console.log(`\nstatus entries: ${Object.keys(statusTable).length}/${varietyCount}`);
for (const [ailment, count] of Object.entries(ailmentCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${ailment.padEnd(10)} ${String(count).padStart(4)}  ${(100 * count / varietyCount).toFixed(1)}%`);
}

writeFileSync('coverage-stats.json', JSON.stringify({
  minPower: MIN_POWER,
  versionGroup: VERSION_GROUP,
  entries: Object.keys(table).length,
  varieties: varieties.length,
  distinctMoves: allMoves.length,
  statusEntries: Object.keys(statusTable).length,
  ailmentCounts,
  ailmentShare: Object.fromEntries(
    Object.entries(ailmentCounts).map(([a, c]) => [a, c / varietyCount])
  )
}, null, 2));
console.log('\nwrote coverage-table.txt and status-table.txt');
