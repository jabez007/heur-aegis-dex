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
//
// ## The two targets are not independent, and win rate is worse than it looks
//
// This was measured after the fact and it constrains every number below, so it
// belongs at the top rather than in a footnote. The script reports it as the
// first section.
//
// `corr(usage, win rate)` is **0.683**, so the two columns are largely one
// signal rather than two checks — a result confirmed against both is confirmed
// about as strongly as a result confirmed against one.
//
// Worse, `corr(usage, |win rate - 50|)` is **-0.438**: the more a Pokemon is
// played, the closer its win rate sits to even. That is arithmetic, not a
// finding. Something on a quarter of all teams is largely playing itself, so it
// cannot post an extreme win rate. Mean deviation from 50% falls from 2.59
// points among 1-2% Pokemon to 0.84 among 8-15% ones.
//
// The consequence is that win-rate *variance* comes mostly from the rare tail,
// where each Pokemon has the fewest games and the most noise. A term correlating
// with win rate may only be detecting "rare and bad". So:
//
// **Do not tune a weight on this data.** The ablation section below exists to
// locate suspects, not to set constants. Two of its results — that speed and
// defensive typing both anti-correlate — are exactly what this artifact would
// manufacture, because heavily-played support and defensive Pokemon are pinned
// near 50% by construction while the tail drags the correlation negative.
//
// What the data *can* do reliably is compare two variants of the same term
// against the same target, where the artifact applies equally to both and
// largely cancels. That is how the STAB-only offensive score was checked
// (0.195 against -0.016, an effect far too large to be noise) and how the
// firepower depth sweep was read.

import { readFileSync } from 'node:fs';
import { loadPokemonCatalog } from '../src/lib/pokemonCatalogLoader.ts';
import { getCatalogResistantTypes } from '../src/lib/pokemonCatalogScan.ts';
import { flattenToPokemon } from '../src/lib/pokemonEntry.ts';
import { candidatePriority } from '../src/lib/rosterGeneration.ts';
import {
  FIREPOWER_MODULATION, MEMBER_WEIGHTS, OBSERVED_STAB_POWER, OBSERVED_STAT_TERMS,
  STAT_CEILINGS, TYPE_MODULATION, scoreMemberQuality
} from '../src/lib/teamScoring.ts';
import { getQualityMultipliers } from '../src/lib/abilityEffects.ts';
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
  stab: getStabPower(entry.name, entry.stats) ?? 0,
  // Kept for the ablation, which rebuilds member quality from its parts.
  stats: entry.stats,
  ability: getQualityMultipliers(entry.abilityName, entry.stats)
}));

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const rescale = (value, { min, max }) => clamp01((clamp01(value) - min) / (max - min));
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

// Reported first because it bounds how much every later number is worth. See
// the header for what these two mean.
{
  const usage = data.entries.map((entry) => entry.usage);
  const win = data.entries.map((entry) => entry.winRate);
  const deviation = data.entries.map((entry) => Math.abs(entry.winRate - 50));
  console.log(`\n=== how independent are the two targets? ===`);
  console.log(`  corr(usage, win rate)        ${spearman(usage, win).toFixed(3)}  — 1.0 would mean one target, not two`);
  console.log(`  corr(usage, |win rate - 50|) ${spearman(usage, deviation).toFixed(3)}  — negative means heavy use pins win rate to even`);
  for (const [lo, hi] of [[1, 2], [2, 4], [4, 8], [8, 15], [15, 100]]) {
    const band = data.entries.filter((entry) => entry.usage >= lo && entry.usage < hi);
    if (band.length === 0) continue;
    const mean = band.reduce((sum, entry) => sum + Math.abs(entry.winRate - 50), 0) / band.length;
    console.log(`    usage ${String(lo).padStart(2)}-${String(hi).padEnd(3)} n=${String(band.length).padStart(2)}  mean |win-50| ${mean.toFixed(2)}`);
  }
  console.log(`  → win-rate variance lives in the rare tail, where samples are smallest.`);
  console.log(`    Compare variants of one term against one target; do not tune weights.`);
}

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

// ## Ablation: which terms are carrying the ranking, and which are suspects
//
// Read this as a map of where to look, never as weights to copy. The header
// explains why: the win-rate column is compressed toward even for exactly the
// heavily-played support and defensive Pokemon these terms are meant to reward,
// so a term that "hurts" here may only be failing to predict a number that
// cannot move.
//
// Each row rebuilds member quality with one thing changed. The shipping row is
// the baseline.
const q = (row, { wo, wb, ws, tmO, tmD, fm }) => {
  const off = rescale((effectiveOffense(row.stats) / STAT_CEILINGS.offense) * row.ability.offense,
    OBSERVED_STAT_TERMS.offense);
  const blk = rescale((hpAdjustedBulk(row.stats) / STAT_CEILINGS.bulk) * row.ability.bulk,
    OBSERVED_STAT_TERMS.bulk);
  const spd = rescale((row.stats.speed / STAT_CEILINGS.speed) * row.ability.speed,
    OBSERVED_STAT_TERMS.speed);
  const mod = (depth, value) => (1 - depth) + (depth * clamp01(value));
  const fp = row.stab <= 0 ? 1 : mod(fm,
    (row.stab - OBSERVED_STAB_POWER.min) / (OBSERVED_STAB_POWER.max - OBSERVED_STAB_POWER.min));
  return clamp01(
    (wo * off * mod(tmO, row.damageTo) * fp) +
    (wb * blk * mod(tmD, 1 - row.damageFrom)) +
    (ws * spd)
  );
};
const SHIPPING = {
  wo: MEMBER_WEIGHTS.offense, wb: MEMBER_WEIGHTS.bulk, ws: MEMBER_WEIGHTS.speed,
  tmO: TYPE_MODULATION, tmD: TYPE_MODULATION, fm: FIREPOWER_MODULATION
};
console.log('\n=== ablation (suspects, not weights — see the header) ===');
console.log('  configuration                        vs usage   vs win');
const ablate = (label, changes) => {
  const values = matched.map((row) => q(row, { ...SHIPPING, ...changes }));
  const u = spearman(values, matched.map((row) => row.usage));
  const w = spearman(values, matched.map((row) => row.winRate));
  console.log(`  ${label.padEnd(34)} ${u >= 0 ? ' ' : ''}${u.toFixed(3)}${mark(u, matched.length)}` +
    ` ${w >= 0 ? ' ' : ''}${w.toFixed(3)}${mark(w, matched.length)}`);
};
ablate('shipping', {});
ablate('speed weight -> 0', { ws: 0 });
ablate('offensive typing off', { tmO: 0 });
ablate('defensive typing off', { tmD: 0 });
ablate('firepower off', { fm: 0 });
ablate('offence weight -> 0', { wo: 0 });
ablate('bulk weight -> 0', { wb: 0 });
console.log('  the last two collapse, which is the only unambiguous result here:');
console.log('  both stat terms are load-bearing. The middle rows are suspects only.');

// ## How far does a doubles result carry to singles?
//
// Everything above is doubles, because no comparable singles dataset exists.
// Checked 2026-08-15: showdowntier has no singles format (its `smb` is BSS
// *doubles*), pokemon-zone and pokechamps refuse automated requests,
// stratadex and munchstats are VGC-only, and the one singles ranking that is
// reachable — rankedmeta — is a community poll of six voters, which is opinion
// rather than data and would be worse than nothing dressed as validation.
// pokesynergy states the position plainly on its own page: singles data arrives
// "once a reliable Champions Singles source exists".
//
// So the question is how much of the doubles result transfers, and that has an
// internal answer. `candidatePriority` differentiates the formats through
// exactly one flag, `hasAlly`, which gates credit for redirection and
// ally-protection roles. If the two orderings are nearly identical then the
// firepower term cannot be doing something different in singles that went
// unchecked — but by the same token the model is barely distinguishing the
// formats at the member level, which is a finding in its own right and not a
// reassuring one. Real singles and doubles metagames share few of their top
// Pokemon.
const doublesPriority = scored.map((row) => row.priority);
const singlesPriority = pool.map((entry) => candidatePriority(entry, { hasAlly: false }));
const dRanks = rank(doublesPriority);
const sRanks = rank(singlesPriority);
const formatMoves = dRanks.map((r, index) => Math.abs(r - sRanks[index])).sort((a, b) => a - b);
console.log(`\n=== singles against doubles (model-internal; no singles data exists) ===`);
console.log(`  ranking agreement:  ${spearman(doublesPriority, singlesPriority).toFixed(4)}`);
console.log(`  median rank move:   ${formatMoves[Math.floor(formatMoves.length / 2)]} of ${pool.length}, max ${formatMoves[formatMoves.length - 1]}`);
console.log(`  firepower vs doubles priority: ${spearman(scored.map((r) => r.stab), doublesPriority).toFixed(4)}`);
console.log(`  firepower vs singles priority: ${spearman(scored.map((r) => r.stab), singlesPriority).toFixed(4)}`);
console.log(`  → the term behaves the same in both, because the member ranking is`);
console.log(`    very nearly the same in both. Format differentiation lives in`);
console.log(`    scoreTeamSynergy and COMPOSITE_BOUNDS, not here.`);

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
