// Generates the coverage-move table from PokeAPI's `champions` version group,
// which is the actual Pokemon Champions movepool rather than a union across
// games. Keyed by PokeAPI *variety* name, matching what the app already holds.
//
// Two more tables come out of the same fetch, because the expensive part is the
// crawl and all three read different fields off it. Coverage asks what a Pokemon
// can hit; status asks what it can inflict, which was unanswerable until this ran
// and is why every status-facing ability in the model was a hand-picked constant
// (see STATUS_THREAT in statusThreat.ts); STAB power asks how hard it hits with
// what it already has, which nothing in the model had a number for at all (see
// UNUSABLE_MOVES below, and stabPower.ts).
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

// 2. variety -> champions-legal move names, and its own types for STAB
const varietyMoves = new Map();
const varietyTypes = new Map();
await mapLimit(varieties, CONCURRENCY, async (variety) => {
  const data = await getJson(`https://pokeapi.co/api/v2/pokemon/${variety}/`);
  if (!data) return;
  const names = (data.moves || [])
    .filter((m) => m.version_group_details.some((d) => d.version_group.name === VERSION_GROUP))
    .map((m) => m.move.name);
  varietyMoves.set(variety, names);
  varietyTypes.set(variety, (data.types || []).map((t) => t.type.name));
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
    accuracy: data.accuracy,
    minHits: data.meta?.min_hits,
    maxHits: data.meta?.max_hits
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

// ## Utility moves that fill a modelled role
//
// `abilityRoles.ts` scores redirection, ally protection and the field setters,
// and reads all of them off *abilities*. That leaves the model blind to the
// Pokemon whose support is a move: Corviknight ranks 29th on its attacking stat
// while the format plays it for Tailwind, Wide Guard, Roost and U-turn, and the
// same gap sits under Whimsicott, Pelipper and Torkoal.
//
// ### Selected by role, not by frequency
//
// A move is emitted when it supplies a role the model already scores, plus one
// new role for speed control. That rule is the reason this table cannot repeat
// the coverage mistake — it is not an argmax over anything, and a move nothing
// scores is not included however common it is.
//
// The frequencies confirm the selection discriminates rather than choosing it.
// Measured across 317 varieties with a Champions learnset:
//
// | move                     | share | role            |
// | ------------------------ | ----- | --------------- |
// | Follow Me / Rage Powder  |  3.2% | redirection     |
// | Wide Guard               |  7.9% | ally-protection |
// | Tailwind                 |  8.5% | speed-control   |
// | Quick Guard / Ally Switch|  9.1% | ally-protection |
// | Trick Room               | 18.6% | speed-control   |
// | Reflect / Light Screen   | ~39%  | screens         |
//
// And the ones deliberately absent, which is where the discipline shows:
// **Protect is on 100% of the roster** and would have been pure noise — the
// Normal-as-coverage defect exactly, one layer up. Rain Dance and Sunny Day sit
// at 75% and 74%, universal TMs rather than a capability worth recording, and
// setting weather by move costs both a turn and a slot to get five turns of what
// an ability gives permanently. Helping Hand is 66%. None of them tell you
// anything about the Pokemon holding them.
const UTILITY_MOVE_ROLES = new Map([
  // Pulls an attack off a partner. The ability form is Lightning Rod and Storm
  // Drain; these are the same capability bought with a moveslot.
  ['follow-me', 'redirection'],
  ['rage-powder', 'redirection'],
  // Blunts what is aimed at the pair. Wide Guard stops spread moves outright,
  // which is the single most format-defining protective move in doubles.
  ['wide-guard', 'ally-protection'],
  ['quick-guard', 'ally-protection'],
  ['ally-switch', 'ally-protection'],
  // Speed control, which has no ability form in this roster and is the reason
  // the role vocabulary gains an entry rather than reusing one.
  ['tailwind', 'speed-control'],
  ['trick-room', 'speed-control'],
  // Screens halve incoming damage for the whole side for five turns. Also no
  // ability form here, and the archetype Grimmsnarl is built on — it is 18th in
  // the format and was ranked 56th, with none of the reason visible.
  ['reflect', 'screens'],
  ['light-screen', 'screens'],
  ['aurora-veil', 'screens']
]);

const utilityTable = {};
for (const [variety, moves] of varietyMoves) {
  const roles = new Set();
  for (const move of moves) {
    const role = UTILITY_MOVE_ROLES.get(move);
    if (role) roles.add(role);
  }
  if (roles.size > 0) utilityTable[variety] = [...roles].sort();
}

// ## Best usable STAB power
//
// The coverage table answers *which* types a Pokemon can reach. This answers
// *how hard* it hits with the types it already has, which the model has never
// had a number for: every offensive score in the app is built from base stats
// and type charts, as though a 60-power move and a 120-power move were the same
// tool.
//
// ### Why STAB only, and why "usable"
//
// The obvious design — highest base power in the whole movepool — is measurably
// wrong, and wrong in a way this codebase has hit before. An argmax over every
// move picks the filler that everything learns: Snorlax's best move comes out as
// Self-Destruct, Corviknight's and Skarmory's as Giga Impact. Correlated against
// the existing offensive score across the M-B pool it scores **-0.117**, so it
// carries no information about how hard anything actually hits. This is the same
// failure as counting Normal as coverage: a universally-learnable move wins any
// unfiltered maximum.
//
// Two restrictions fix it, measured on the same pool:
//
// | rule                              | corr. with effectiveOffense |
// | --------------------------------- | --------------------------- |
// | highest power, any move           | -0.117                      |
// | + accuracy discount               |  0.007                      |
// | + unusable moves dropped          |  0.195                      |
// | STAB only, all moves usable       |  0.141                      |
// | **STAB only + unusable dropped**  | **0.189**                   |
//
// STAB is the right restriction because it is the move a Pokemon actually leads
// with — the one its typing already pays for — and because every variety in this
// roster has at least one, so there is no fallback case to invent. The STAB
// multiplier itself is deliberately *not* applied: it is 1.5x for every entry, so
// it would scale the whole column and change nothing.
//
// ### What makes a move unusable
//
// A move is excluded when its listed power is not power the Pokemon can bring on
// demand. That is the rule; the list below enumerates it, because PokeAPI flags
// almost none of these structurally — Steel Beam halves the user's own HP and is
// recorded with `drain: 0`, indistinguishable from Flash Cannon.
//
// Deliberately *kept*, because the cost does not stop the move working and these
// are moves people genuinely lead with: recoil (Brave Bird, Flare Blitz, Head
// Smash), crash risk (High Jump Kick), lock-in (Outrage, Thrash — a locked
// attacker is still attacking), and low accuracy, which is priced below rather
// than excluded.
//
// Stat-drop nukes are the closest call and are kept. Overheat repeated is much
// weaker than Overheat once, so it does not strictly sustain — but the drop
// resets on a switch, and 130 is honestly what a Fire-type brings the turn it
// comes in. The line is drawn at costs that survive switching.
//
// Entries whose listed power is too low to ever win a maximum today are still
// listed, so the set stays an expression of the rule rather than a patch over
// whatever currently happens to win.
const UNUSABLE_MOVES = new Map([
  // Self-KO: the attacker is gone, so this is never a repeatable attack.
  ['explosion', 'self-KO'],
  ['self-destruct', 'self-KO'],
  ['misty-explosion', 'self-KO'],
  ['final-gambit', 'self-KO'],
  // Recharge: the following turn is spent doing nothing.
  ['hyper-beam', 'recharge'],
  ['giga-impact', 'recharge'],
  ['blast-burn', 'recharge'],
  ['frenzy-plant', 'recharge'],
  ['hydro-cannon', 'recharge'],
  ['rock-wrecker', 'recharge'],
  // Two-turn: this turn is spent doing nothing. Weather and Power Herb can
  // remove the charge, which is a condition, not the default.
  ['solar-beam', 'two-turn'],
  ['solar-blade', 'two-turn'],
  ['sky-attack', 'two-turn'],
  ['meteor-beam', 'two-turn'],
  ['electro-shot', 'two-turn'],
  ['dig', 'two-turn'],
  ['dive', 'two-turn'],
  ['fly', 'two-turn'],
  ['bounce', 'two-turn'],
  ['phantom-force', 'two-turn'],
  ['focus-punch', 'two-turn'],
  ['beak-blast', 'two-turn'],
  // Delayed: the damage does not land on the turn it is spent.
  ['future-sight', 'delayed'],
  // Typing loss: using it removes the very STAB being measured.
  ['burn-up', 'typing-loss'],
  // Half the user's own HP, which is a once-per-game nuke rather than a move it
  // brings turn after turn. This one was found by measurement, not by reading
  // the list: Steel Beam was setting the 133 that seven of the ten hardest
  // hitters read, and it is special, so it was doing it to Steel-types that are
  // physical attackers and would never click it.
  ['steel-beam', 'self-halving'],
  // Cannot be used on consecutive turns, so the listed power is what it brings
  // every other turn rather than what it sustains — the same objection as the
  // HP-scaling moves below, in the frequency dimension instead of the magnitude
  // one. Tinkaton was the single highest value in the table on the strength of it.
  ['gigaton-hammer', 'alternating'],
  // HP-scaling: the listed power is the full-health best case, not the typical
  // one, so reading it as a flat number overstates every use after the first.
  ['eruption', 'hp-scaling'],
  ['water-spout', 'hp-scaling'],
  // Conditional: needs setup that is not a given on the turn it is wanted.
  ['last-resort', 'conditional'],
  ['steel-roller', 'conditional'],
  ['belch', 'conditional'],
  ['beat-up', 'conditional'],
  ['stored-power', 'conditional'],
  ['power-trip', 'conditional'],
  ['rage-fist', 'conditional'],
  ['last-respects', 'conditional'],
  ['hard-press', 'conditional'],
  ['payback', 'conditional'],
  ['avalanche', 'conditional'],
  ['temper-flare', 'conditional'],
  ['sucker-punch', 'conditional'],
  ['upper-hand', 'conditional'],
  ['comeuppance', 'conditional'],
  ['counter', 'conditional'],
  ['mirror-coat', 'conditional'],
  ['metal-burst', 'conditional'],
  ['snore', 'conditional'],
  ['fake-out', 'conditional'],
  ['first-impression', 'conditional']
]);

// Average hits for a multi-hit move. The 2-5 spread is not uniform — the game
// rolls two and three hits at 35% each and four and five at 15% each, giving
// 3.0 — and a flat mean would read 3.5 and overstate Icicle Spear and friends.
// Fixed-count moves (Dragon Darts, Triple Axel) just multiply.
const expectedHits = ({ minHits, maxHits }) => {
  if (!minHits || !maxHits || maxHits <= 1) return 1;
  if (minHits === maxHits) return minHits;
  if (minHits === 2 && maxHits === 5) return 3;
  return (minHits + maxHits) / 2;
};

// Expected power: base power, discounted by accuracy, times expected hits.
//
// Accuracy enters linearly, as plain expected value. It earns its place — across
// the pool it changes *which* move is picked for 30 of 147 Pokemon (Rotom-Wash
// from Hydro Pump to Thunderbolt, Primarina from Hydro Pump to Moonblast) while
// leaving 32 correctly on a sub-100% move that is still their best. A null
// accuracy means the move never misses, which is 100, not unknown.
//
// The argument that a miss costs more than linearly — it can lose a game outright,
// so players discount 80% harder than 0.8 — is real and is deliberately not
// applied, because nothing here measures how much harder. Recorded so its absence
// is a choice rather than an oversight, the standing of MIXED_ATTACKER_RATIO.
const expectedPower = (meta) => {
  if (typeof meta.power !== 'number' || meta.power <= 0) return 0;
  const accuracy = typeof meta.accuracy === 'number' ? meta.accuracy / 100 : 1;
  return meta.power * accuracy * expectedHits(meta);
};

// Variable-power moves (Gyro Ball, Grass Knot, Heavy Slam, Weather Ball and 19
// others) carry `power: null` because their power depends on battle state the
// table cannot see. They fall out through the `typeof power` check above rather
// than being listed as unusable — they are perfectly good moves whose power is
// simply not a constant.
const stabTable = {};
for (const [variety, moves] of varietyMoves) {
  const own = new Set(varietyTypes.get(variety) || []);
  if (own.size === 0) continue;
  let physical = 0;
  let special = 0;

  for (const move of moves) {
    const meta = moveMeta.get(move);
    if (!meta || meta.damageClass === 'status' || UNUSABLE_MOVES.has(move)) continue;
    if (!own.has(meta.type)) continue;
    const power = expectedPower(meta);
    const adaptive = ADAPTIVE_MOVES.has(move);
    if (adaptive || meta.damageClass === 'physical') physical = Math.max(physical, power);
    if (adaptive || meta.damageClass === 'special') special = Math.max(special, power);
  }

  if (physical > 0 || special > 0) {
    stabTable[variety] = { physical: Math.round(physical), special: Math.round(special) };
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

const statusLines = Object.keys(statusTable).sort().map((variety) =>
  `  '${variety}': [${statusTable[variety].map((a) => `'${a}'`).join(', ')}]`
);
writeFileSync('status-table.txt', statusLines.join(',\n') + '\n');

const utilityLines = Object.keys(utilityTable).sort().map((variety) =>
  `  '${variety}': [${utilityTable[variety].map((r) => `'${r}'`).join(', ')}]`
);
writeFileSync('utility-move-table.txt', utilityLines.join(',\n') + '\n');

const roleCounts = {};
for (const roles of Object.values(utilityTable)) {
  for (const role of roles) roleCounts[role] = (roleCounts[role] || 0) + 1;
}
console.log(`\nutility-move entries: ${Object.keys(utilityTable).length}/${varieties.length}`);
for (const [role, count] of Object.entries(roleCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${role.padEnd(16)} ${String(count).padStart(4)}  ${(100 * count / varieties.length).toFixed(1)}%`);
}
for (const check of ['corviknight', 'whimsicott', 'pelipper', 'torkoal', 'incineroar', 'garchomp']) {
  console.log(`  ${check.padEnd(12)} [${(utilityTable[check] || []).join(', ')}]`);
}

const stabLines = Object.keys(stabTable).sort().map((variety) => {
  const { physical, special } = stabTable[variety];
  return `  '${variety}': { physical: ${physical}, special: ${special} }`;
});
writeFileSync('stab-power-table.txt', stabLines.join(',\n') + '\n');

// The number that decides whether this can carry weight downstream. A column
// with a narrow spread cannot modulate anything; one with a wide spread has to
// be folded in carefully or it swamps the terms already there.
const bestOf = (entry) => Math.max(entry.physical, entry.special);
const stabValues = Object.values(stabTable).map(bestOf).sort((a, b) => a - b);
const noStab = varieties.filter((v) => varietyMoves.has(v) && !stabTable[v]);
console.log(`\nstab power entries: ${Object.keys(stabTable).length}/${varieties.length}`);
console.log(`  min ${stabValues[0]}, median ${stabValues[Math.floor(stabValues.length / 2)]}, max ${stabValues[stabValues.length - 1]}`);
console.log(`  spread ${(stabValues[stabValues.length - 1] / stabValues[0]).toFixed(2)}x`);
console.log(`  no usable STAB: ${noStab.length}${noStab.length ? ` (${noStab.join(', ')})` : ''}`);
const unusableSeen = new Set([...UNUSABLE_MOVES.keys()].filter((m) => moveMeta.has(m)));
console.log(`  unusable moves in this pool: ${unusableSeen.size}/${UNUSABLE_MOVES.size}`);
for (const check of ['corviknight', 'dragapult', 'rotom-wash', 'snorlax', 'annihilape', 'cloyster']) {
  const entry = stabTable[check];
  if (entry) console.log(`  ${check.padEnd(12)} P:${String(entry.physical).padStart(3)} S:${String(entry.special).padStart(3)}`);
}

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
  stabPowerEntries: Object.keys(stabTable).length,
  stabPower: {
    min: stabValues[0],
    median: stabValues[Math.floor(stabValues.length / 2)],
    max: stabValues[stabValues.length - 1]
  },
  ailmentCounts,
  ailmentShare: Object.fromEntries(
    Object.entries(ailmentCounts).map(([a, c]) => [a, c / varietyCount])
  )
}, null, 2));
console.log('\nwrote coverage-table.txt, status-table.txt, stab-power-table.txt and utility-move-table.txt');
