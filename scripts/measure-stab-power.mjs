// Measures whether best-usable-STAB power is worth folding into the score, and
// whether doing so would pay for something the model already pays for.
//
// `STAB_POWER` is generated data with no consumer. Before it gets one, two
// questions have to be answered with numbers rather than intuition:
//
// 1. **Is it independent?** The highest-power physical STAB moves cluster hard
//    in a few types — Close Combat and Flare Blitz are 120, Fighting and Fire.
//    Fighting is also the heaviest threat weight in the model and near the top
//    of the offensive census. If firepower is largely a restatement of offensive
//    typing, adding it charges the same property twice, which is the mistake
//    `candidatePriority` already records having made three times over with
//    defensive typing.
// 2. **Does it discriminate?** A column where two thirds of the roster share one
//    of two values cannot modulate anything. The raw table looks worryingly like
//    that, and the bias-resolved column is what a consumer would actually see.
//
// Run with:  npx tsx scripts/measure-stab-power.mjs
//
// Nothing here writes a constant. It reports the correlations that decide
// whether a constant should exist at all.

import { chooseDefaultAbility } from '../src/lib/pokedex.ts';
import { getCatalogBaseTypes } from '../src/lib/pokemonCatalogScan.ts';
import { buildDualTypes } from '../src/lib/resistantTypeScan.ts';
import { loadPokemonCatalog } from '../src/lib/pokemonCatalogLoader.ts';
import { measureDamageFromBounds, measureDamageToBounds } from '../src/lib/damageBounds.ts';
import { getDefenderCensus, getThreatWeights } from '../src/lib/threatPool.ts';
import { applyAbilityModifiers } from '../src/lib/pokedexAbilities.ts';
import { getEffectiveStats } from '../src/lib/statAbilities.ts';
import { getRegulation } from '../src/lib/regulations.ts';
import { getAttackerBias } from '../src/lib/coverageMoves.ts';
import { getStabPower, hasStabPowerData } from '../src/lib/stabPower.ts';
import { effectiveOffense } from '../src/lib/statMetrics.ts';
import { hpAdjustedBulk } from '../src/lib/statMetrics.ts';
import {
  DEFAULT_BASE_SCORE as BASE,
  normalizeDamageFromScore,
  normalizeDamageToScore
} from '../src/lib/pokedexScoring.ts';

const regulation = getRegulation('M-B') ?? { legalSpecies: new Set(), id: 'none' };
const species = [...regulation.legalSpecies].sort();
process.stderr.write(`regulation ${regulation.id}: ${species.length} legal species\n`);

const catalog = await loadPokemonCatalog();
const weights = getThreatWeights(catalog, { regulation, baseScore: BASE });
const census = getDefenderCensus(catalog, { regulation, baseScore: BASE });
// The census reaches the type data positionally, and has to: `damage_to_score`
// is computed once when a type is built and carried through the ability profiles
// unchanged, so a census that does not reach here silently produces chart-weighted
// offensive scores while every label says otherwise.
const base = getCatalogBaseTypes(catalog, BASE, weights, census);
const allTypes = base.concat(buildDualTypes(base, BASE, weights, census));
const fromBounds = measureDamageFromBounds(base, BASE, weights);
const toBounds = measureDamageToBounds(census, BASE);

const findType = (types) => {
  const key = types.length === 1 ? types[0] : types.join('/');
  return allTypes.find((t) => t.name === key)
    ?? allTypes.find((t) => t.name === types.slice().reverse().join('/'));
};

const getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

// The same pool the other calibration scripts build: every legal species in its
// default form, resolved through the species endpoint when the bare name has no
// resource. See the note in measure-composite-bounds.mjs.
const pool = [];
for (const [index, name] of species.entries()) {
  if (index % 25 === 0) process.stderr.write(`  ${index}/${species.length}\n`);
  let poke;
  try {
    poke = await getJson(`https://pokeapi.co/api/v2/pokemon/${name}`);
  } catch {
    try {
      const speciesData = await getJson(`https://pokeapi.co/api/v2/pokemon-species/${name}`);
      const variety = speciesData.varieties.find((v) => v.is_default) ?? speciesData.varieties[0];
      poke = await getJson(variety.pokemon.url);
    } catch {
      process.stderr.write(`  skipped ${name}\n`);
      continue;
    }
  }

  const types = poke.types.map((slot) => slot.type.name);
  const typeData = findType(types);
  if (!typeData) { process.stderr.write(`  no type entry for ${name}\n`); continue; }

  const abilityNames = poke.abilities.map((a) => a.ability.name);
  const baseStats = poke.stats.reduce((acc, s) => ({ ...acc, [s.stat.name]: s.base_stat }), {});
  const { abilityProfiles } = applyAbilityModifiers(
    typeData.damage_relations, abilityNames, BASE, weights
  );
  const profile = chooseDefaultAbility(
    abilityProfiles.map((p) => ({ ...p, stats: getEffectiveStats(baseStats, [p.ability_name]) })),
    BASE,
    fromBounds
  );

  pool.push({
    name: poke.name,
    types,
    stats: profile.stats,
    bias: getAttackerBias(profile.stats),
    stab: getStabPower(poke.name, profile.stats),
    known: hasStabPowerData(poke.name),
    offense: effectiveOffense(profile.stats),
    bulk: hpAdjustedBulk(profile.stats),
    speed: profile.stats.speed,
    damageTo: normalizeDamageToScore(profile.damage_to_score, BASE, toBounds),
    damageFrom: normalizeDamageFromScore(profile.damage_from_score, BASE, fromBounds)
  });
}

process.stderr.write(`pool: ${pool.length}\n`);

const missing = pool.filter((p) => !p.known);
if (missing.length > 0) {
  process.stderr.write(`no STAB entry: ${missing.map((p) => p.name).join(', ')}\n`);
}

const scored = pool.filter((p) => p.known && p.stab > 0);

// ## Rank correlation, the same measure every other comparison here uses.
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

const stab = scored.map((p) => p.stab);
console.log(`\npool with a usable STAB move: ${scored.length}/${pool.length}`);

console.log('\n=== 1. is it independent? ===');
console.log('  rank correlation of STAB power against what the model already scores:');
for (const [label, pick] of [
  ['damage_to (offensive typing)', (p) => p.damageTo],
  ['damage_from (defensive typing)', (p) => p.damageFrom],
  ['effectiveOffense (attack stats)', (p) => p.offense],
  ['hpAdjustedBulk', (p) => p.bulk],
  ['speed', (p) => p.speed]
]) {
  console.log(`    ${label.padEnd(34)} ${spearman(stab, scored.map(pick)).toFixed(3)}`);
}

// Firepower per attacking type, since the double-counting worry is specifically
// that the high-power moves live in the types the model already rates highly.
console.log('\n  mean STAB power by the Pokemon\'s own types:');
const byType = {};
for (const p of scored) {
  for (const type of p.types) (byType[type] ??= []).push(p.stab);
}
Object.entries(byType)
  .map(([type, values]) => [type, values.reduce((s, v) => s + v, 0) / values.length, values.length])
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, mean, count]) =>
    console.log(`    ${type.padEnd(10)} ${mean.toFixed(1).padStart(6)}  n=${count}`));

// The correlations above are the summary answer; this is the mechanism. If
// firepower were a restatement of typing, almost all its variance would sit
// *between* types and a Pokemon's type would tell you its firepower. Splitting
// the variance says how much of it typing can explain at best.
const grand = stab.reduce((sum, v) => sum + v, 0) / stab.length;
const total = stab.reduce((sum, v) => sum + (v - grand) ** 2, 0) / stab.length;
let between = 0;
let weight = 0;
for (const values of Object.values(byType)) {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  between += values.length * (mean - grand) ** 2;
  weight += values.length;
}
between /= weight;
console.log(`\n  variance explained by typing alone: ${(100 * between / total).toFixed(1)}%`);
console.log(`  so ${(100 - 100 * between / total).toFixed(1)}% is per-Pokemon and new to the model`);

console.log('\n=== 2. does it discriminate? ===');
const sorted = [...stab].sort((a, b) => a - b);
const at = (q) => sorted[Math.floor(q * (sorted.length - 1))];
console.log(`  min ${sorted[0]}  p25 ${at(0.25)}  median ${at(0.5)}  p75 ${at(0.75)}  max ${sorted[sorted.length - 1]}`);
console.log(`  spread ${(sorted[sorted.length - 1] / sorted[0]).toFixed(2)}x`);

const hist = {};
for (const value of stab) hist[value] = (hist[value] || 0) + 1;
const modes = Object.entries(hist).sort((a, b) => b[1] - a[1]);
const share = (n) => `${(100 * n / stab.length).toFixed(0)}%`;
console.log(`  distinct values: ${modes.length}`);
console.log(`  most common: ${modes.slice(0, 3).map(([v, n]) => `${v} (${share(n)})`).join(', ')}`);
console.log(`  top two values cover ${share(modes[0][1] + modes[1][1])} of the pool`);

console.log('\n  by attacking bias:');
for (const bias of ['physical', 'special', 'mixed']) {
  const group = scored.filter((p) => p.bias === bias).map((p) => p.stab);
  if (group.length === 0) continue;
  const mean = group.reduce((s, v) => s + v, 0) / group.length;
  console.log(`    ${bias.padEnd(9)} n=${String(group.length).padStart(3)}  mean ${mean.toFixed(1)}  min ${Math.min(...group)}  max ${Math.max(...group)}`);
}

// What reading `max` off the table instead of resolving the class would do,
// which is the inflation `getStabPower` exists to avoid.
const inflated = scored.filter((p) => {
  const naive = getStabPower(p.name, null);
  return naive > p.stab;
});
console.log(`\n  reading max instead of the resolved class inflates ${inflated.length}/${scored.length}`);
console.log(`    worst: ${inflated
  .map((p) => ({ name: p.name, gap: getStabPower(p.name, null) - p.stab }))
  .sort((a, b) => b.gap - a.gap).slice(0, 6)
  .map((p) => `${p.name} +${p.gap}`).join(', ')}`);

console.log('\n=== 3. what would it move? ===');
// Firepower modulating offence, at candidate depths. The comparison is against
// the ranking the app produces today, so this reports disruption, not truth.
const meanStab = stab.reduce((s, v) => s + v, 0) / stab.length;
const baseline = scored.map((p) => p.offense);
for (const depth of [0.1, 0.2, 0.3, 0.4]) {
  const modulated = scored.map((p) => p.offense * (1 + depth * (p.stab / meanStab - 1)));
  const before = rank(baseline);
  const after = rank(modulated);
  const moves = before.map((r, i) => Math.abs(r - after[i])).sort((a, b) => a - b);
  console.log(`  depth ${depth.toFixed(1)}  spearman ${spearman(baseline, modulated).toFixed(3)}` +
    `  median move ${moves[Math.floor(moves.length / 2)]}  max ${moves[moves.length - 1]}`);
}

console.log('\n  biggest gainers and losers at depth 0.2:');
const delta = scored.map((p) => ({ name: p.name, stab: p.stab, ratio: p.stab / meanStab }))
  .sort((a, b) => b.ratio - a.ratio);
console.log(`    up:   ${delta.slice(0, 6).map((p) => `${p.name} (${p.stab})`).join(', ')}`);
console.log(`    down: ${delta.slice(-6).map((p) => `${p.name} (${p.stab})`).join(', ')}`);
