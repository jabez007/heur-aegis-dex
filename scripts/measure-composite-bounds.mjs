// Measures the reachable range of each half of the composite team score.
//
// `composeTeamScore` blends average member quality against team synergy at
// COMPOSITE_WEIGHTS, nominally 45/55. Those weights only mean what they say if
// both halves actually use their 0..1 range. Neither did: member quality is a
// weighted mean of clamped terms and bunches near the middle, while synergy is a
// bonus-minus-penalty difference that spans nearly the whole of -1..1.
//
// This is the same measurement `pokedexScoring.ts` records for the damage
// scores, run for the same reason and feeding the same kind of constant. Follow
// the argument under OBSERVED_DAMAGE_FROM there before changing anything here.
//
// Run with:  npx tsx scripts/measure-composite-bounds.mjs
//
// The result is pasted into OBSERVED_MEMBER_QUALITY / OBSERVED_SYNERGY in
// teamScoring.ts by hand, with the date, exactly as the damage bounds are. These
// are calibration constants, not generated code: a bound that silently moves
// when someone reruns a script is a bound nobody has checked.

import { chooseDefaultAbility, getBaseTypes, getDualTypes } from '../src/lib/pokedex.ts';
import { applyAbilityModifiers } from '../src/lib/pokedexAbilities.ts';
import { buildOffensiveTypeChart, getMoveCoverage } from '../src/lib/coverageMoves.ts';
import { getEffectiveStats } from '../src/lib/statAbilities.ts';
import { getActiveRegulation } from '../src/lib/regulations.ts';
import { analyzeTeamCoverage } from '../src/lib/teamCoverage.ts';
import { analyzeTeamRoles, isImmuneToAllyMoves } from '../src/lib/abilityRoles.ts';
import {
  MEMBER_WEIGHTS, STAT_CEILINGS, effectiveOffense, scoreMemberQuality, scoreTeamSynergy
} from '../src/lib/teamScoring.ts';
import { BATTLE_FORMAT_LIST } from '../src/lib/battleFormats.ts';
import {
  DEFAULT_BASE_SCORE as BASE,
  normalizeDamageFromScore,
  normalizeDamageToScore
} from '../src/lib/pokedexScoring.ts';

/** Subsets drawn per format. Large enough that the percentiles below settle. */
const SAMPLES = 200000;

const regulation = getActiveRegulation() ?? { legalSpecies: new Set(), id: 'none' };
const species = [...regulation.legalSpecies].sort();
process.stderr.write(`regulation ${regulation.id}: ${species.length} legal species\n`);

const base = await getBaseTypes(BASE);
const allTypes = base.concat(await getDualTypes(BASE, base));
const chart = buildOffensiveTypeChart(base);

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

// Every legal species in its default form. Alternate forms are deliberately
// skipped: they widen the pool without widening its extremes, and the bound only
// needs to contain what a roster can hold.
//
// Resolved through the species endpoint rather than by name, because a dozen
// species have no bare `pokemon/{name}` resource — Aegislash, Palafin, Mimikyu
// and their kin only exist under a form suffix. Fetching by name silently
// dropped them, and they are exactly the Pokemon most likely to sit near an
// extreme.
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
      process.stderr.write(`  ${name} -> ${poke.name}\n`);
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
  const { abilityProfiles } = applyAbilityModifiers(typeData.damage_relations, abilityNames, BASE);
  const profile = chooseDefaultAbility(
    abilityProfiles.map((p) => ({ ...p, stats: getEffectiveStats(baseStats, [p.ability_name]) })),
    BASE
  );

  pool.push({
    name,
    types,
    abilityName: profile.ability_name,
    stats: profile.stats,
    weaknesses: profile.weaknesses ?? [],
    quadruple_weaknesses: profile.quadruple_weaknesses ?? [],
    resistances: profile.resistances ?? [],
    immunities: profile.immunities ?? [],
    coverages: profile.coverages ?? [],
    moveCoverages: getMoveCoverage(name, chart, profile.stats),
    normalizedDamageToScore: normalizeDamageToScore(profile.damage_to_score, BASE),
    normalizedDamageFromScore: normalizeDamageFromScore(profile.damage_from_score, BASE)
  });
}

process.stderr.write(`scored pool: ${pool.length}\n`);

const halves = (members, format) => {
  const coverage = analyzeTeamCoverage(members.map((member) => ({
    ...member,
    immuneToAllyMoves: format.hasAlly && isImmuneToAllyMoves(member.abilityName)
  })));
  const roles = analyzeTeamRoles(
    members.map((member) => ({ abilityName: member.abilityName })),
    { hasAlly: format.hasAlly }
  );
  const qualities = members.map((member) => scoreMemberQuality({
    stats: member.stats,
    normalizedDamageToScore: member.normalizedDamageToScore,
    normalizedDamageFromScore: member.normalizedDamageFromScore,
    abilityName: member.abilityName
  }));

  return {
    quality: qualities.reduce((total, q) => total + q, 0) / qualities.length,
    synergy: scoreTeamSynergy({
      coverage,
      roles,
      format,
      typesTotal: new Set(members.flatMap((member) => member.types)).size,
      teamSize: members.length,
      typeCount: BASE
    })
  };
};

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

// The same question one level down: do the three stat terms inside
// scoreMemberQuality use the range MEMBER_WEIGHTS assumes they do?
{
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const terms = { offense: [], bulk: [], speed: [] };
  pool.forEach((m) => {
    terms.offense.push(clamp01(effectiveOffense(m.stats) / STAT_CEILINGS.offense));
    terms.bulk.push(clamp01((m.stats.hp + m.stats.defense + m.stats['special-defense']) / STAT_CEILINGS.bulk));
    terms.speed.push(clamp01(m.stats.speed / STAT_CEILINGS.speed));
  });
  process.stdout.write('\nmember-quality stat terms across the legal pool:\n');
  Object.entries(terms).forEach(([name, values]) => {
    values.sort((a, b) => a - b);
    const lo = percentile(values, 0.01);
    const hi = percentile(values, 0.99);
    process.stdout.write(
      `  ${name.padEnd(8)} min ${values[0].toFixed(3)} p01 ${lo.toFixed(3)} p99 ${hi.toFixed(3)} ` +
      `max ${values.at(-1).toFixed(3)} | span ${(hi - lo).toFixed(3)} ` +
      `| weight ${MEMBER_WEIGHTS[name]} -> realized swing ${(MEMBER_WEIGHTS[name] * (hi - lo)).toFixed(3)}\n`
    );
  });
  process.stdout.write('\n');
}

for (const format of BATTLE_FORMAT_LIST) {
  const qualities = [];
  const synergies = [];

  for (let i = 0; i < SAMPLES; i++) {
    const picked = new Set();
    while (picked.size < format.broughtToBattle) picked.add(Math.floor(Math.random() * pool.length));
    const { quality, synergy } = halves([...picked].map((index) => pool[index]), format);
    qualities.push(quality);
    synergies.push(synergy);
  }

  qualities.sort((a, b) => a - b);
  synergies.sort((a, b) => a - b);

  const report = (label, sorted) => {
    process.stdout.write(
      `${format.id} ${label}: ` +
      `min ${sorted[0].toFixed(4)} p001 ${percentile(sorted, 0.001).toFixed(4)} ` +
      `p01 ${percentile(sorted, 0.01).toFixed(4)} p50 ${percentile(sorted, 0.5).toFixed(4)} ` +
      `p99 ${percentile(sorted, 0.99).toFixed(4)} p999 ${percentile(sorted, 0.999).toFixed(4)} ` +
      `max ${sorted[sorted.length - 1].toFixed(4)}\n`
    );
  };

  report('quality', qualities);
  report('synergy', synergies);

  // Average member quality has *exact* bounds, unlike synergy: the best possible
  // team average is the mean of the pool's highest individual qualities, and the
  // worst is the mean of its lowest. Worth having beside the sampled extremes,
  // because a sample of 200k out of C(198,4) never reaches either end.
  const solo = pool.map((member) => scoreMemberQuality({
    stats: member.stats,
    normalizedDamageToScore: member.normalizedDamageToScore,
    normalizedDamageFromScore: member.normalizedDamageFromScore,
    abilityName: member.abilityName
  })).sort((a, b) => a - b);
  const mean = (values) => values.reduce((total, v) => total + v, 0) / values.length;
  const exactMin = mean(solo.slice(0, format.broughtToBattle));
  const exactMax = mean(solo.slice(-format.broughtToBattle));
  process.stdout.write(`${format.id} quality EXACT: min ${exactMin.toFixed(4)} max ${exactMax.toFixed(4)}\n`);

  // What each candidate pair of bounds does to the balance the weights claim.
  // The operating band is p01..p99: the range real comparisons happen in.
  const band = (sorted) => percentile(sorted, 0.99) - percentile(sorted, 0.01);
  const qBand = band(qualities);
  const sBand = band(synergies);
  const candidates = {
    'current (nominal)': { q: [0, 1], s: [-1, 1] },
    'p01/p99': { q: [percentile(qualities, 0.01), percentile(qualities, 0.99)], s: [percentile(synergies, 0.01), percentile(synergies, 0.99)] },
    'p001/p999': { q: [percentile(qualities, 0.001), percentile(qualities, 0.999)], s: [percentile(synergies, 0.001), percentile(synergies, 0.999)] },
    'sampled min/max': { q: [qualities[0], qualities.at(-1)], s: [synergies[0], synergies.at(-1)] },
    'exact q / sampled s': { q: [exactMin, exactMax], s: [synergies[0], synergies.at(-1)] }
  };
  Object.entries(candidates).forEach(([label, { q, s }]) => {
    const qPts = 45 * (qBand / (q[1] - q[0]));
    const sPts = 55 * (sBand / (s[1] - s[0]));
    process.stdout.write(
      `${format.id}   ${label.padEnd(20)} quality ${qPts.toFixed(1)}pts  synergy ${sPts.toFixed(1)}pts  ` +
      `ratio ${(sPts / qPts).toFixed(2)}:1\n`
    );
  });
}
