// What the Browser's ranking actually decides on, as opposed to what the weights
// claim it decides on.
//
// Run with:  npx tsx scripts/measure-ranking-terms.mjs
//
// It writes no constant. Every other measurement script here sets a number; this
// one reports what the numbers already set are buying, which is the check that
// was missing when a term quietly stopped mattering.
//
// ## Why a weight is not a share
//
// `MEMBER_WEIGHTS` says bulk is 0.45 and speed is 0.20. That is the weight on a
// term, not the influence of the input behind it, and the two come apart whenever
// an input fails to occupy the range it is normalized against. This repo has now
// found that failure five times — OBSERVED_DAMAGE_FROM, COMPOSITE_BOUNDS,
// OBSERVED_STAT_TERMS, the offensive census, and the pool-relative typing bounds
// this script was written to catch — and every time the symptom was the same: a
// term with a large nominal weight that decided nothing, discovered by accident.
//
// So this measures the thing directly. For each input, hold every other input at
// the pool median and move that one from its 5th to its 95th percentile. The
// points of `candidatePriority` between those two is what the input is worth in
// the ranking the user actually sees.
//
// ## The premise this is measured against
//
// The tool exists to find **decently bulky Pokemon with strong defensive typings
// and good offensive STAB**. That is a statement about what should be near the
// top of the Browser, and it is a preference rather than a prediction — ladder
// usage cannot confirm or refute it, which is what `measure-usage-correlation`
// is for and why that one is secondary. The premise section below is the primary
// check: it asks whether the three things the tool was built to find are the
// three things deciding its order.
//
// Rerun after changing MEMBER_WEIGHTS, TYPE_MODULATION, FIREPOWER_MODULATION,
// STAT_CEILINGS, OBSERVED_STAT_TERMS, CANDIDATE_WEIGHTS, or anything that moves
// the damage-score bounds.

import { loadPokemonCatalog } from '../src/lib/pokemonCatalogLoader.ts';
import { getCatalogResistantTypes } from '../src/lib/pokemonCatalogScan.ts';
import { flattenToPokemon } from '../src/lib/pokemonEntry.ts';
import { candidatePriority, CANDIDATE_WEIGHTS } from '../src/lib/rosterGeneration.ts';
import { scoreMemberQuality } from '../src/lib/teamScoring.ts';
import { getStabPower } from '../src/lib/stabPower.ts';
import { hpAdjustedBulk } from '../src/lib/statMetrics.ts';
import { getDamageFromBounds, getDamageToBounds, getDefenderCensus, getThreatWeights } from '../src/lib/threatPool.ts';
import { getRegulation } from '../src/lib/regulations.ts';
import { DEFAULT_BASE_SCORE as BASE } from '../src/lib/pokedexScoring.ts';

const REGULATION = 'M-B';
const FORMAT = { hasAlly: true };

const catalog = await loadPokemonCatalog();
const regulation = getRegulation(REGULATION);
const selection = { regulation, baseScore: BASE };

// The default view, not the opened one. This script asks what the user sees
// ranked, so the product's own filters are part of the question — the opposite
// of `measure-usage-correlation`, which opens them because the metagame does not
// respect them.
const scan = await getCatalogResistantTypes(catalog, { pokemonFilters: { regulation: REGULATION } });
const pool = flattenToPokemon(scan, {
  scoring: {
    weights: getThreatWeights(catalog, selection),
    census: getDefenderCensus(catalog, selection),
    bounds: getDamageFromBounds(catalog, selection),
    toBounds: getDamageToBounds(catalog, selection)
  }
});

console.log(`regulation ${REGULATION}, default browser view: ${pool.length} entries\n`);

const percentile = (values, p) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * p)];
};

/**
 * Every input the ranking reads, per entry, in its own natural unit.
 *
 * Read off the entries rather than recomputed, so this measures the pipeline
 * that runs rather than a copy of it.
 */
const inputs = pool.map((entry) => ({
  name: entry.name,
  bulk: hpAdjustedBulk(entry.stats),
  offense: Math.max(entry.stats.attack, entry.stats['special-attack'])
    + 0.3 * Math.min(entry.stats.attack, entry.stats['special-attack']),
  speed: entry.stats.speed,
  defensiveTyping: entry.normalizedDamageFromScore,
  offensiveTyping: entry.normalizedDamageToScore,
  stab: getStabPower(entry.name, entry.stats),
  priority: candidatePriority(entry, FORMAT),
  // The two adjunct terms are additive, so their contribution needs no ablation:
  // the weight times the value *is* the contribution.
  role: candidatePriority(entry, FORMAT)
    - 100 * scoreMemberQuality({
      stats: entry.stats,
      normalizedDamageToScore: entry.normalizedDamageToScore,
      normalizedDamageFromScore: entry.normalizedDamageFromScore,
      abilityName: entry.abilityName,
      varietyName: entry.name
    })
    - entry.moveCoverages.length * CANDIDATE_WEIGHTS.moveCoverage,
  coverage: entry.moveCoverages.length * CANDIDATE_WEIGHTS.moveCoverage
}));

const at = (key, p) => percentile(inputs.map((row) => row[key]).filter((v) => v !== null), p);

/**
 * A Pokemon assembled to sit at the pool median on every input at once.
 *
 * Synthetic rather than a real median Pokemon, because no real Pokemon is median
 * in six dimensions and the ablation needs one input to move at a time. The
 * stat line is built so the two derived metrics land exactly on their targets:
 * `hpAdjustedBulk` is the geometric mean of HP against each defence, so equal
 * values return that value; and the attacking stats are held at a 2:1 ratio so
 * `getAttackerBias` resolves to `physical` and the STAB lookup is a single
 * well-defined number rather than the better of two.
 */
const statsFor = ({ bulk, offense, speed }) => ({
  hp: bulk,
  defense: bulk,
  'special-defense': bulk,
  // effectiveOffense = attack + 0.3 * special-attack, with attack = 2 * special-attack.
  attack: offense / 1.15,
  'special-attack': offense / 2.3,
  speed
});

/**
 * A variety whose physical STAB power is nearest a target, so firepower can be
 * moved through the real `getStabPower` lookup instead of a copy of its formula.
 */
const varietyWithStab = (target, stats) => {
  let best = null;
  let bestGap = Infinity;
  pool.forEach((entry) => {
    const power = getStabPower(entry.name, stats);
    if (power === null) return;
    const gap = Math.abs(power - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = entry.name;
    }
  });
  return best;
};

const median = {
  bulk: at('bulk', 0.5),
  offense: at('offense', 0.5),
  speed: at('speed', 0.5),
  defensiveTyping: at('defensiveTyping', 0.5),
  offensiveTyping: at('offensiveTyping', 0.5),
  stab: at('stab', 0.5)
};

/** Scores one point in input space through the production quality function. */
const scoreAt = (point) => {
  const stats = statsFor(point);
  return 100 * scoreMemberQuality({
    stats,
    normalizedDamageToScore: point.offensiveTyping,
    normalizedDamageFromScore: point.defensiveTyping,
    varietyName: varietyWithStab(point.stab, stats)
  });
};

const ablate = (key) => {
  // Defensive score is inverted: a *lower* damage-from score is the better
  // Pokemon, so its p05 is the strong end and the swing is measured the same
  // way round as every other input.
  const low = { ...median, [key]: at(key, 0.05) };
  const high = { ...median, [key]: at(key, 0.95) };
  return Math.abs(scoreAt(high) - scoreAt(low));
};

const terms = [
  ['effective bulk', ablate('bulk'), 'premise'],
  ['defensive typing', ablate('defensiveTyping'), 'premise'],
  ['STAB power', ablate('stab'), 'premise'],
  ['effective offense', ablate('offense'), ''],
  ['offensive typing', ablate('offensiveTyping'), ''],
  ['speed', ablate('speed'), ''],
  ['support role', at('role', 0.95) - at('role', 0.05), ''],
  ['reachable coverage', at('coverage', 0.95) - at('coverage', 0.05), '']
];
const movement = terms.reduce((total, [, swing]) => total + swing, 0);

console.log('=== what decides the order ===');
console.log('points of candidatePriority between an input\'s 5th and 95th percentile,');
console.log('every other input held at the pool median\n');
terms
  .slice()
  .sort((left, right) => right[1] - left[1])
  .forEach(([label, swing, tag]) => {
    console.log(`  ${label.padEnd(20)} ${swing.toFixed(2).padStart(6)} pts  ${(100 * swing / movement).toFixed(1).padStart(5)}%  ${tag}`);
  });
const premiseShare = terms
  .filter(([, , tag]) => tag === 'premise')
  .reduce((total, [, swing]) => total + swing, 0);
console.log(`\n  the three premise terms decide ${(100 * premiseShare / movement).toFixed(1)}% of the ordering.`);

console.log('\n=== how much of its own range does each input occupy here? ===');
console.log('a term normalized against a range it does not occupy cannot decide anything,');
console.log('whatever weight it carries — this is the diagnostic for that\n');
[
  ['defensive typing', 'defensiveTyping', 0, 1],
  ['offensive typing', 'offensiveTyping', 0, 1],
  ['STAB power', 'stab', 77, 120]
].forEach(([label, key, min, max]) => {
  const low = at(key, 0.05);
  const high = at(key, 0.95);
  console.log(`  ${label.padEnd(20)} p05 ${low.toFixed(3).padStart(7)}  p95 ${high.toFixed(3).padStart(7)}  = ${(100 * (high - low) / (max - min)).toFixed(0).padStart(3)}% of ${min}..${max}`);
});

const ranks = (key, descending = true) => {
  const sorted = [...inputs].sort((left, right) =>
    descending ? right[key] - left[key] : left[key] - right[key]);
  return new Map(sorted.map((row, index) => [row.name, index + 1]));
};
const rankOf = (values) => {
  const order = values.map((value, index) => [value, index])
    .sort((left, right) => right[0] - left[0]);
  const out = new Array(values.length);
  order.forEach(([, index], rank) => { out[index] = rank + 1; });
  return out;
};
const rho = (left, right) => {
  const a = rankOf(left);
  const b = rankOf(right);
  const mean = (a.length + 1) / 2;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  a.forEach((value, index) => {
    const l = value - mean;
    const r = b[index] - mean;
    numerator += l * r;
    leftVariance += l * l;
    rightVariance += r * r;
  });
  return numerator / Math.sqrt(leftVariance * rightVariance);
};
const spearman = (leftRanks, rightRanks) => {
  const mean = (inputs.length + 1) / 2;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  inputs.forEach((row) => {
    const left = leftRanks.get(row.name) - mean;
    const right = rightRanks.get(row.name) - mean;
    numerator += left * right;
    leftVariance += left * left;
    rightVariance += right * right;
  });
  return numerator / Math.sqrt(leftVariance * rightVariance);
};

const browserRanks = ranks('priority');
console.log('\n=== what the order tracks (Spearman against the Browser\'s own ranking) ===');
[
  ['effective bulk', 'bulk', true],
  ['defensive typing', 'defensiveTyping', false],
  ['best usable STAB', 'stab', true],
  ['speed', 'speed', true],
  ['effective offense', 'offense', true],
  ['reachable coverage', 'coverage', true]
].forEach(([label, key, descending]) => {
  console.log(`  ${label.padEnd(20)} ${spearman(browserRanks, ranks(key, descending)).toFixed(3).padStart(6)}`);
});

// ## Are these eight inputs eight things, or fewer things counted more than once?
//
// The ablation above assumes they are separable — it moves one input while
// holding the others at the median, which is a point in input space no Pokemon
// need occupy. Two inputs that rise together are charged twice for one property,
// and the ablation cannot see it. This repo has already removed two such terms
// from `CANDIDATE_WEIGHTS` (see the comments there on `coverage` and
// `quadrupleWeakness`), both found by reading rather than by measuring, so the
// measurement belongs here.
//
// Correlation is not by itself a defect. Bulk and defensive typing correlate
// because they are deliberately multiplied together, which is one term with two
// factors rather than two terms. What to look for is a pair that correlates
// while entering the score *additively* or through separate factors, because
// that pair is being paid twice.
console.log('\n=== do the inputs overlap? (Spearman between the inputs themselves) ===');
const axes = [
  ['bulk', 'bulk', 1],
  // Sign-flipped so every row reads "more is better" and a positive correlation
  // means the two inputs agree about which Pokemon is stronger.
  ['defTyping', 'defensiveTyping', -1],
  ['offense', 'offense', 1],
  ['offTyping', 'offensiveTyping', 1],
  ['stab', 'stab', 1],
  ['coverage', 'coverage', 1],
  ['speed', 'speed', 1]
];
const column = ([, key, sign]) =>
  inputs.map((row) => sign * (row[key] ?? at(key, 0.05)));
console.log(`  ${''.padEnd(11)}${axes.map(([label]) => label.padStart(10)).join('')}`);
axes.forEach((rowAxis, rowIndex) => {
  const cells = axes.map((columnAxis, columnIndex) => (columnIndex <= rowIndex
    ? ''.padStart(10)
    : rho(column(rowAxis), column(columnAxis)).toFixed(2).padStart(10)));
  console.log(`  ${rowAxis[0].padEnd(11)}${cells.join('')}`);
});

// The structural half of the same question, for the one pair where the overlap
// is not a matter of degree. `coverages` is what a Pokemon hits super-effectively
// off its own typing, and it is exactly what `normalizedDamageToScore` counts.
// `moveCoverages` is what it reaches with any qualifying move — and the move
// table includes moves of its own types, so whenever a Pokemon has a real STAB
// move its typing's coverage is a *subset* of its move coverage.
const withCoverage = pool.filter((entry) => entry.moveCoverages.length > 0);
const contained = withCoverage.filter((entry) =>
  entry.coverages.every((type) => entry.moveCoverages.includes(type)));
console.log(`\n  of the ${withCoverage.length} entries with move-coverage data, ${contained.length}`
  + ' have their STAB coverage wholly inside it');
console.log('  — so the STAB half of `moveCoverage` is charged twice, once through the');
console.log('  offence term and again at a flat rate per type. Unlike the removed');
console.log('  `coverage` weight this is a superset rather than the same list, so the');
console.log('  non-STAB reach is real information; what it shares with that weight is');
console.log('  being stat-independent, paying a weak attacker per type at full rate.');

// The premise stated as a score, deliberately naive: equal parts of the three
// things the tool was built to find, each on the pool's own range. It is a
// yardstick rather than a proposal — if the Browser's order and this one
// disagree sharply, one of them is not the tool that was asked for.
const spread = (key) => {
  const values = inputs.map((row) => row[key]).filter((value) => value !== null);
  return { min: Math.min(...values), max: Math.max(...values) };
};
const bulkSpread = spread('bulk');
const typingSpread = spread('defensiveTyping');
const stabSpread = spread('stab');
const unit = (value, { min, max }) => (max === min ? 0.5 : (value - min) / (max - min));
inputs.forEach((row) => {
  row.premise = (
    unit(row.bulk, bulkSpread) +
    unit(1 - row.defensiveTyping, { min: 1 - typingSpread.max, max: 1 - typingSpread.min }) +
    unit(row.stab ?? stabSpread.min, stabSpread)
  ) / 3;
});
const premiseRanks = ranks('premise');

console.log('\n=== premise alignment ===');
console.log(`  browser order vs premise order:  ${spearman(browserRanks, premiseRanks).toFixed(3)}`);
const topPremise = new Set([...premiseRanks.entries()].filter(([, rank]) => rank <= 20).map(([name]) => name));
const topBrowser = [...browserRanks.entries()].filter(([, rank]) => rank <= 20).map(([name]) => name);
console.log(`  top-20 overlap:                  ${topBrowser.filter((name) => topPremise.has(name)).length}/20`);

console.log('\n  worst disagreements (premise rank -> browser rank):');
inputs
  .map((row) => ({
    name: row.name,
    moved: premiseRanks.get(row.name) - browserRanks.get(row.name),
    premise: premiseRanks.get(row.name),
    browser: browserRanks.get(row.name),
    speed: row.speed,
    bulk: Math.round(row.bulk),
    defensiveTyping: row.defensiveTyping,
    stab: row.stab
  }))
  .sort((left, right) => Math.abs(right.moved) - Math.abs(left.moved))
  .slice(0, 8)
  .forEach((row) => {
    console.log(`    ${row.name.padEnd(22)} ${String(row.premise).padStart(3)} -> ${String(row.browser).padStart(3)}  (${row.moved > 0 ? '+' : ''}${row.moved})`
      + `  bulk ${String(row.bulk).padStart(3)}  defTyping ${row.defensiveTyping.toFixed(2)}  stab ${String(row.stab ?? '-').padStart(3)}  speed ${String(row.speed).padStart(3)}`);
  });
