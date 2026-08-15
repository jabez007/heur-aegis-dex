// The model's first external validation. Everything else in this repo is
// measured against itself.
//
// Every constant here has been derived from something — attack availability,
// typing prevalence, what a roster member is worth — and each derivation was an
// improvement on a guess. But an internally consistent model can be consistently
// wrong, and until now nothing has compared any of it to a result produced
// outside this codebase. `TYPE_MODULATION`, `MEMBER_WEIGHTS` and their kin all
// carry the same disclaimer: "reasoned, not validated against usage data". This
// is the script that was owed.
//
// Run with:  npx tsx scripts/measure-usage-correlation.mjs
//
// It writes no constant. It reports how well the Browser's ranking tracks a real
// metagame, term by term, so that the next person tuning a weight knows which
// half of the model is carrying it.
//
// ## What the comparison can and cannot show
//
// The data is ladder usage and ladder win rate for Regulation M-B doubles (see
// usage-reg-m-b.json for provenance). Three limits are structural, not fixable
// by trying harder:
//
// 1. **Usage is popularity.** It rewards Pokemon that are cheap to obtain, easy
//    to pilot and famous. This model does not try to predict any of that, so a
//    perfect score against usage would be evidence of something wrong.
// 2. **Win rate is closer to what is modelled, and noisier.** It spans 44.7% to
//    52.4% — a range narrow enough that rank order within it is partly noise,
//    and it is confounded by who chooses each Pokemon.
// 3. **The tail is censored.** Only species above ~1% usage are listed. The 115
//    absent ones are known to be unpopular but cannot be ranked against each
//    other, so they are excluded from the rank correlations and used instead for
//    a separation test, which is the honest use of a censored tail.
//
// The right reading of a modest correlation is therefore not "the model is
// broken". It is a ceiling on how much of the metagame this kind of model can
// explain, and a map of which terms contribute.

import { readFileSync } from 'node:fs';
import { loadPokemonCatalog } from '../src/lib/pokemonCatalogLoader.ts';
import { getCatalogResistantTypes } from '../src/lib/pokemonCatalogScan.ts';
import { flattenToPokemon } from '../src/lib/pokemonEntry.ts';
import { candidatePriority } from '../src/lib/rosterGeneration.ts';
import { scoreMemberQuality } from '../src/lib/teamScoring.ts';
import { effectiveOffense, hpAdjustedBulk } from '../src/lib/statMetrics.ts';
import { getStabPower } from '../src/lib/stabPower.ts';

const data = JSON.parse(readFileSync(new URL('./usage-reg-m-b.json', import.meta.url), 'utf8'));
const { battles, window: dateWindow, format } = data._provenance;
console.log(`usage data: ${data.entries.length} Pokemon, ${battles.toLocaleString()} ${format} battles, ${dateWindow}`);

// The listed names are display names, and most lower-case straight onto a
// variety name. These are the ones that do not, resolved to the variety the scan
// actually holds. A form suffix in the data ("Ninetales-Alola") is a different
// Pokemon from its base species and has to stay that way; a *default* form the
// data leaves implicit ("Basculegion", "Aegislash") has to gain its suffix.
const ALIASES = {
  'basculegion': 'basculegion-male',
  'aegislash': 'aegislash-shield',
  'mimikyu': 'mimikyu-disguised',
  'palafin': 'palafin-zero',
  'meowstic': 'meowstic-male',
  'maushold': 'maushold-family-of-four',
  'pyroar': 'pyroar-male'
};

// Two entries in the data have no counterpart in the app, and both are excluded
// on purpose: this tool is for players who breed what they play, so a Pokemon
// that cannot be bred is not a Pokemon they can bring. Aliasing them to a near
// neighbour would launder a deliberate product decision into a data error, so
// they stay unmatched and are named here with the reason.
//
// The cost is real and worth stating in one place rather than rediscovering: the
// two of them are 17.6% of this metagame between them. That is the price of the
// policy, not an argument against it.
const KNOWN_GAPS = {
  'floette-eternal': 'the Eternal Flower, excluded by UNBREEDABLE_FORMS',
  'gholdengo': 'unbreedable by egg group, so the species-level breedable rule drops it'
};

// ## Scoring runs on the whole regulation; the view is filtered separately
//
// The scan's defaults — `minimumAttacks: 80`, `minimumBulk: 70`,
// `limitQuadrupleDamage: true`, breedable-only — are deliberate product choices
// about what to *show*. They are not claims about what exists, and the metagame
// does not respect them: a team still has to beat the Kingambit and Garchomp the
// browser declines to display.
//
// So the two questions are kept apart, and this is the rule for every
// calibration script here. **Scoring and calibration run against every Pokemon
// the regulation permits**, because that is the field being played into.
// **Filtering is a view concern**, applied after. Validating inside the filters
// would ask the much weaker question of whether the model ranks well among
// Pokemon it already chose to show, and worse, those filters select on the same
// stats several terms are built from — restricting range there quietly deflates
// the very correlations being measured.
//
// What the default view holds is reported separately at the end, as the cost of
// the policy rather than an argument against it.
const catalog = await loadPokemonCatalog();
const openOptions = {
  pokemonFilters: { regulation: 'M-B' },
  statsFilters: { minimumAttacks: 0, minimumBulk: 0 },
  typeFilters: { limitQuadrupleDamage: false }
};
const scan = await getCatalogResistantTypes(catalog, openOptions);
const pool = flattenToPokemon(scan);
console.log(`scoring pool: ${pool.length} entries (filters opened)`);

const defaultScan = await getCatalogResistantTypes(catalog, { pokemonFilters: { regulation: 'M-B' } });
const defaultNames = new Set(flattenToPokemon(defaultScan).map((entry) => entry.name));
console.log(`default view:  ${defaultNames.size} entries`);

const scored = pool.map((entry) => ({
  name: entry.name,
  priority: candidatePriority(entry, { hasAlly: format === 'doubles' }),
  quality: scoreMemberQuality({
    stats: entry.stats,
    normalizedDamageToScore: entry.normalizedDamageToScore,
    normalizedDamageFromScore: entry.normalizedDamageFromScore,
    abilityName: entry.abilityName,
    varietyName: entry.name
  }),
  // The same score with the firepower term switched off, which is what the depth
  // sweep below has to modulate. Sweeping the live quality would apply firepower
  // twice and report the second application as though it were the first.
  qualityWithoutFirepower: scoreMemberQuality({
    stats: entry.stats,
    normalizedDamageToScore: entry.normalizedDamageToScore,
    normalizedDamageFromScore: entry.normalizedDamageFromScore,
    abilityName: entry.abilityName
  }),
  damageTo: entry.normalizedDamageToScore,
  damageFrom: entry.normalizedDamageFromScore,
  offense: effectiveOffense(entry.stats),
  bulk: hpAdjustedBulk(entry.stats),
  speed: entry.stats.speed,
  bst: Object.values(entry.stats).reduce((sum, stat) => sum + stat, 0),
  coverage: entry.moveCoverages.length,
  stab: getStabPower(entry.name, entry.stats) ?? 0
}));
const scoredByName = new Map(scored.map((row) => [row.name, row]));

// Match the external list onto the scan.
const matched = [];
const unmatched = [];
for (const entry of data.entries) {
  const key = entry.name.toLowerCase();
  const varietyName = ALIASES[key] ?? key;
  const row = scoredByName.get(varietyName);
  if (row) matched.push({ ...entry, ...row });
  else unmatched.push(entry.name);
}
console.log(`matched: ${matched.length}/${data.entries.length}`);
for (const name of unmatched) {
  const key = name.toLowerCase();
  const known = KNOWN_GAPS[key];
  console.log(known
    ? `  gap: ${name} (${data.entries.find((e) => e.name === name).usage}% usage) — ${known}`
    : `  UNMATCHED, unexplained — this silently biases everything below: ${name}`);
}

const rank = (values) => {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
    const mean = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].index] = mean;
    i = j + 1;
  }
  return ranks;
};

const spearman = (left, right) => {
  const a = rank(left);
  const b = rank(right);
  const n = a.length;
  const mean = (xs) => xs.reduce((sum, x) => sum + x, 0) / n;
  const [ma, mb] = [mean(a), mean(b)];
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
};

// Rough two-sided significance for a Spearman coefficient, so a number measured
// on 90-odd rows is not read as though it were measured on thousands.
const significant = (rho, n) => Math.abs(rho) * Math.sqrt(n - 1) > 1.96;
const mark = (rho, n) => (significant(rho, n) ? ' *' : '  ');

const TERMS = [
  ['candidatePriority (what the Browser sorts by)', (r) => r.priority],
  ['scoreMemberQuality', (r) => r.quality],
  ['damage_to (offensive typing)', (r) => r.damageTo],
  ['damage_from (defensive typing, inverted)', (r) => -r.damageFrom],
  ['effectiveOffense', (r) => r.offense],
  ['hpAdjustedBulk', (r) => r.bulk],
  ['speed', (r) => r.speed],
  ['move coverage breadth', (r) => r.coverage],
  ['best usable STAB power', (r) => r.stab],
  ['base stat total (the naive baseline)', (r) => r.bst]
];

const report = (label, target) => {
  console.log(`\n=== against ${label} (n=${matched.length}) ===`);
  const truth = matched.map(target);
  for (const [name, pick] of TERMS) {
    const rho = spearman(matched.map(pick), truth);
    console.log(`  ${name.padEnd(44)} ${rho >= 0 ? ' ' : ''}${rho.toFixed(3)}${mark(rho, matched.length)}`);
  }
};

report('usage %', (r) => r.usage);
report('win rate', (r) => r.winRate);
console.log('\n  * = significant at p<0.05. Everything else is indistinguishable from zero.');

// ## The separation test
//
// The censored tail cannot be ranked, but it can be used for the cruder and more
// robust question: does the model put the Pokemon people actually play above the
// ones they do not? This is the test a team builder has to pass to be useful at
// all, and it survives the tail being unranked.
const usedNames = new Set(matched.map((row) => row.name));
const unused = scored.filter((row) => !usedNames.has(row.name));
console.log(`\n=== separation: ${matched.length} used vs ${unused.length} unused (<1%) ===`);
for (const [name, pick] of TERMS) {
  const used = matched.map(pick);
  const rest = unused.map(pick);
  const all = [...used, ...rest];
  const ranks = rank(all);
  // AUC via the rank-sum identity: the probability that a randomly chosen used
  // Pokemon outranks a randomly chosen unused one. 0.5 is a coin flip.
  const rankSum = ranks.slice(0, used.length).reduce((sum, r) => sum + r, 0);
  const auc = (rankSum - used.length * (used.length + 1) / 2) / (used.length * rest.length);
  const bar = '#'.repeat(Math.max(0, Math.round((auc - 0.5) * 60)));
  console.log(`  ${name.padEnd(44)} ${auc.toFixed(3)}  ${bar}`);
}

// ## Where the model is most wrong
//
// The residuals are the actionable part: a term-level correlation says how much
// signal there is, but the worst-ranked Pokemon say what kind of thing the model
// cannot see.
const usageRank = rank(matched.map((r) => -r.usage));
const modelRank = rank(matched.map((r) => -r.priority));
const residuals = matched.map((row, index) => ({
  name: row.name,
  usageRank: usageRank[index],
  modelRank: modelRank[index],
  error: modelRank[index] - usageRank[index]
}));

const show = (rows) => rows.map((r) =>
  `${r.name} (played #${r.usageRank}, model #${r.modelRank})`).join('\n    ');
console.log('\n=== biggest misses ===');
console.log('  model rates far below how much it is played:');
console.log(`    ${show([...residuals].sort((a, b) => b.error - a.error).slice(0, 10))}`);
console.log('\n  model rates far above how much it is played:');
console.log(`    ${show([...residuals].sort((a, b) => a.error - b.error).slice(0, 10))}`);

const mae = residuals.reduce((sum, r) => sum + Math.abs(r.error), 0) / residuals.length;
console.log(`\n  mean absolute rank error: ${mae.toFixed(1)} of ${matched.length} places`);

// ## Calibrating the firepower term
//
// Two things a constant needs and reasoning alone cannot supply: the range the
// term actually occupies, and whether folding it in makes the ranking better or
// worse against something outside this codebase.
const stabValues = scored.map((row) => row.stab).filter((value) => value > 0);
const stabMin = Math.min(...stabValues);
const stabMax = Math.max(...stabValues);
console.log(`\n=== firepower calibration ===`);
console.log(`  reachable range over the whole regulation: ${stabMin}..${stabMax} (n=${stabValues.length}/${scored.length})`);
console.log(`  entries with no usable STAB at all: ${scored.length - stabValues.length}`);

// The sweep. Firepower enters as a third factor on the offence axis, beside the
// attacking stat and the offensive typing, so it takes the same shape as
// TYPE_MODULATION: it scales the term between (1 - depth) and 1 rather than
// multiplying it outright.
//
// Depth 0 is the model before this term existed, so the row for it is the
// baseline every other row has to beat, and FIREPOWER_MODULATION's row is the
// one now shipping. Reported against both targets because they disagree about what
// the model is for, and a depth that helps one while hurting the other is a
// choice rather than a measurement.
const normalizedStab = (value) =>
  value <= 0 ? 1 : Math.min(1, Math.max(0, (value - stabMin) / (stabMax - stabMin)));
console.log(`\n  depth   usage    win rate   (Spearman of the modulated quality term)`);
for (const depth of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
  const modulated = matched.map((row) =>
    row.qualityWithoutFirepower * ((1 - depth) + (depth * normalizedStab(row.stab))));
  const vsUsage = spearman(modulated, matched.map((row) => row.usage));
  const vsWin = spearman(modulated, matched.map((row) => row.winRate));
  console.log(`   ${depth.toFixed(1)}   ${vsUsage >= 0 ? ' ' : ''}${vsUsage.toFixed(3)}${mark(vsUsage, matched.length)}` +
    `  ${vsWin >= 0 ? ' ' : ''}${vsWin.toFixed(3)}${mark(vsWin, matched.length)}`);
}

// ## Does the default view contain the metagame?
//
// A ranking can only be right about Pokemon it shows. This asks a question the
// correlations cannot: of the Pokemon people actually play, how many does the
// app display at all before the user touches a filter?
const shown = matched.filter((row) => defaultNames.has(row.name));
const hidden = matched.filter((row) => !defaultNames.has(row.name));
const usageShare = (rows) => rows.reduce((sum, row) => sum + row.usage, 0);
console.log(`\n=== what the default view holds ===`);
console.log(`  played Pokemon shown by default: ${shown.length}/${matched.length}`);
console.log(`  share of total usage shown:       ${(100 * usageShare(shown) / usageShare(matched)).toFixed(1)}%`);
const byUsage = [...matched].sort((a, b) => b.usage - a.usage);
console.log(`  of the 15 most-used, hidden: ${byUsage.slice(0, 15).filter((row) => !defaultNames.has(row.name)).length}`);
console.log(`\n  most-played Pokemon the default view hides:`);
for (const row of hidden.sort((a, b) => b.usage - a.usage).slice(0, 12)) {
  console.log(`    ${row.name.padEnd(20)} ${row.usage.toFixed(2).padStart(5)}% usage`);
}
