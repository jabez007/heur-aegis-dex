// Generates the scoring validation fixture.
//
// The fixture has to be real data, not hand-written approximations: the whole
// point is to check that the scoring weights order *actual* Pokemon the way a
// player would. So this drives the project's own pipeline — the real type
// chart, the real ability modifiers, the real coverage table — and emits the
// resulting PokemonEntry for each Pokemon the fixture teams use.
//
// Run with:  npm run gen:scoring-fixture
//
// Writes src/lib/scoring.fixture.ts itself rather than emitting to stdout for a
// shell redirect. `> file` truncates the destination when the shell sets the
// redirection up — before this script has fetched anything — so a mid-run
// failure left the committed fixture empty rather than untouched. There is no
// retry around the fetches below, and the fixture is the file every ordinal
// assertion is read against: losing it silently is the worst outcome available.

import { writeFileSync } from 'node:fs';
import { chooseDefaultAbility, getBaseTypes, getDualTypes } from '../src/lib/pokedex.ts';
import { applyAbilityModifiers } from '../src/lib/pokedexAbilities.ts';
import { buildOffensiveTypeChart, getMoveCoverage } from '../src/lib/coverageMoves.ts';
import { getEffectiveStats, getStatAbilityName, totalStats } from '../src/lib/statAbilities.ts';
import {
  DEFAULT_BASE_SCORE as BASE,
  normalizeDamageFromScore,
  normalizeDamageToScore
} from '../src/lib/pokedexScoring.ts';

// Abilities are *derived* the same way the scan derives them, not pinned.
//
// An earlier version pinned them, on the reasoning that a fixture should be
// deterministic. That reasoning was wrong in a way worth recording: pinning
// Skeledirge to Unaware made the ability-effect layer look tested while the app
// selected Blaze and never reached it. A fixture that does not use the app's own
// selection rule is testing something the user will never see.


const FIXTURE = [
  // Recognisable strong Pokemon
  'incineroar', 'dragonite', 'garchomp', 'metagross', 'milotic', 'clefable',
  'tyranitar', 'hydreigon', 'volcarona', 'kingambit', 'annihilape', 'sylveon',
  'glimmora', 'sneasler',

  // Same Fire/Ghost typing, so the comparison is purely stats and abilities.
  'skeledirge', 'typhlosion-hisui',

  // Weather cores
  'torkoal', 'venusaur', 'charizard', 'arcanine', 'pelipper', 'basculegion-male',
  'ninetales', 'ninetales-alola',

  // Support and defensive specialists
  'whimsicott', 'grimmsnarl', 'klefki', 'skarmory', 'forretress', 'farigiraf',
  'azumarill', 'lucario', 'talonflame',

  // Defensive walls against bulky-but-plain Pokemon. These were the reported
  // symptom of the compressed typing signal: Blastoise and Feraligatr have bulk
  // comparable to Skarmory's and four resistances to its twelve, and outranked
  // it anyway because twelve-versus-four was worth 3.6% of one term.
  'blastoise', 'feraligatr', 'corviknight',

  // A fast frail attacker with a support ability against two Pokemon that beat
  // it on quality. Staraptor led both because Intimidate paid +4 while their
  // quadruple weaknesses charged -5, on a scale where quality spans about 30.
  'staraptor', 'swampert', 'scizor',

  // Deliberately weak: low stats, poor typing, no role
  'pikachu', 'castform', 'watchog', 'emolga', 'dedenne', 'liepard', 'audino',
  'arbok', 'simisear', 'camerupt', 'salazzle', 'scovillain'
];

const base = await getBaseTypes(BASE);
const allTypes = base.concat(await getDualTypes(BASE, base));
const chart = buildOffensiveTypeChart(base);

const typeKey = (types) => types.length === 1 ? types[0] : types.join('/');
const findType = (types) => {
  const key = typeKey(types);
  return allTypes.find((t) => t.name === key)
    ?? allTypes.find((t) => t.name === types.slice().reverse().join('/'));
};

const getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

const seen = new Set();
const entries = [];
const rawScoreByName = new Map();

for (const name of FIXTURE) {
  if (seen.has(name)) continue;
  seen.add(name);

  const poke = await getJson(`https://pokeapi.co/api/v2/pokemon/${name}`);
  const species = await getJson(poke.species.url);
  const types = poke.types.map((slot) => slot.type.name);

  const typeData = findType(types);
  if (!typeData) throw new Error(`no type entry for ${name} (${types.join('/')})`);

  const abilityNames = poke.abilities.map((a) => a.ability.name);
  const baseStats = poke.stats.reduce((acc, s) => ({ ...acc, [s.stat.name]: s.base_stat }), {});

  // Exactly what the scan does: build a profile per ability, then let the scan's
  // own rule pick the default.
  const { abilityProfiles } = applyAbilityModifiers(typeData.damage_relations, abilityNames, BASE);
  const profile = chooseDefaultAbility(
    abilityProfiles.map((p) => ({ ...p, stats: getEffectiveStats(baseStats, [p.ability_name]) })),
    BASE,
    undefined,
    undefined,
    name
  );
  const abilityName = profile.ability_name;
  const stats = profile.stats;

  entries.push({
    name,
    speciesName: species.name,
    typeName: typeData.name,
    types,
    sprite: '',
    stats,
    baseStats,
    statAbilityName: getStatAbilityName([abilityName]),
    statsTotal: totalStats(stats),
    abilities: poke.abilities.map((a) => ({ name: a.ability.name, is_hidden: a.is_hidden })),
    abilityName,
    // Deliberately empty: scoring reads the resolved fields below, and carrying
    // every profile would triple the fixture for no assertion's benefit.
    abilityProfiles: {},
    weaknesses: profile.weaknesses ?? [],
    quadrupleWeaknesses: profile.quadruple_weaknesses ?? [],
    resistances: profile.resistances ?? [],
    immunities: profile.immunities ?? [],
    coverages: profile.coverages ?? [],
    moveCoverages: getMoveCoverage(name, chart, stats),
    normalizedDamageToScore: normalizeDamageToScore(profile.damage_to_score, BASE),
    normalizedDamageFromScore: normalizeDamageFromScore(profile.damage_from_score, BASE)
  });

  // Kept beside the entries rather than on them: PokemonEntry has no field for
  // raw scores, and the fixture needs them to check itself against the current
  // bounds. See SCORING_FIXTURE_RAW_SCORES in the emitted file.
  rawScoreByName.set(name, { from: profile.damage_from_score, to: profile.damage_to_score });
}

entries.sort((a, b) => a.name.localeCompare(b.name));

// Pretty-print, but inline anything that fits — a fixture nobody can read is a
// fixture nobody will check against their own judgement.
const INLINE_WIDTH = 96;
const format = (value, indent = '') => {
  const compact = JSON.stringify(value);
  if (compact.length <= INLINE_WIDTH || typeof value !== 'object' || value === null) return compact;

  const inner = indent + '  ';
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => inner + format(v, inner)).join(',\n')}\n${indent}]`;
  }
  const fields = Object.entries(value)
    // Match JSON.stringify: an undefined field is absent, not `undefined`.
    // statAbilityName is unset for every Pokemon without Huge Power or its kin.
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`);
  return `{\n${fields.join(',\n')}\n${indent}}`;
};

const today = new Date().toISOString().slice(0, 10);
const rawScores = entries.map((e) => {
  const raw = rawScoreByName.get(e.name);
  return `  ${JSON.stringify(e.name)}: { from: ${raw.from}, to: ${raw.to} }`;
}).join(',\n');
const body = entries
  .map((e) => `  ${JSON.stringify(e.name)}: ${format(e, '  ')}`)
  .join(',\n');

const OUTPUT = new URL('../src/lib/scoring.fixture.ts', import.meta.url);

writeFileSync(OUTPUT, `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Real Pokemon data for the scoring validation fixture, produced by driving the
 * project's own pipeline: the real type chart, the real ability modifiers and
 * the real coverage table. Hand-written approximations would let the fixture
 * agree with the scoring for the wrong reasons.
 *
 * \`abilityProfiles\` is deliberately empty — scoring reads the resolved fields,
 * and carrying every profile would triple the file for no assertion's benefit.
 * Each entry's ability is *derived* by the scan's own rule rather than pinned:
 * a fixture that picks abilities its own way cannot see a defect in the picking.
 *
 * Regenerate with scripts/gen-scoring-fixture.mjs. Generated ${today}.
 */

import type { PokemonEntry } from './pokemonEntry';

export const SCORING_FIXTURE_POKEMON: Readonly<Record<string, PokemonEntry>> = {
${body}
};

/**
 * Raw damage scores, before normalization.
 *
 * The entries above store *normalized* scores, which means the fixture bakes in
 * the output of the very stage most likely to be miscalibrated — and cannot see
 * a regression in it. Reverting \`pokedexScoring\`'s bounds left every ordinal
 * assertion passing, because they were reading numbers computed under the old
 * bounds and frozen into this file.
 *
 * These raw values are the fixture's link back to the live normalization.
 * \`scoringValidation.test.ts\` asserts the stored normalized values still match
 * what the current bounds produce, so changing the bounds without regenerating
 * fails loudly instead of quietly testing a scale that no longer exists.
 */
export const SCORING_FIXTURE_RAW_SCORES: Readonly<Record<string, { from: number; to: number }>> = {
${rawScores}
};
`);

process.stderr.write(`wrote ${OUTPUT.pathname} (${entries.length} Pokemon)\n`);
