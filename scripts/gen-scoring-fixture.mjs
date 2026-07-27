// Generates the scoring validation fixture.
//
// The fixture has to be real data, not hand-written approximations: the whole
// point is to check that the scoring weights order *actual* Pokemon the way a
// player would. So this drives the project's own pipeline — the real type
// chart, the real ability modifiers, the real coverage table — and emits the
// resulting PokemonEntry for each Pokemon the fixture teams use.
//
// Run with:  npx tsx scripts/gen-scoring-fixture.mjs > src/lib/scoring.fixture.ts

import { getBaseTypes, getDualTypes } from '../src/lib/pokedex.ts';
import { applyAbilityModifiers } from '../src/lib/pokedexAbilities.ts';
import { buildOffensiveTypeChart, getMoveCoverage } from '../src/lib/coverageMoves.ts';
import { getEffectiveStats, getStatAbilityName, totalStats } from '../src/lib/statAbilities.ts';
import {
  DEFAULT_BASE_SCORE as BASE,
  normalizeDamageFromScore,
  normalizeDamageToScore
} from '../src/lib/pokedexScoring.ts';

// Ability is named explicitly rather than derived: a fixture must be
// deterministic and must not silently follow a change to the selection rule it
// exists to test around.
const FIXTURE = [
  // Recognisable strong Pokemon
  ['incineroar', 'intimidate'],
  ['dragonite', 'multiscale'],
  ['garchomp', 'rough-skin'],
  ['metagross', 'clear-body'],
  ['milotic', 'competitive'],
  ['clefable', 'magic-guard'],
  ['tyranitar', 'sand-stream'],
  ['hydreigon', 'levitate'],
  ['volcarona', 'flame-body'],
  ['kingambit', 'defiant'],
  ['annihilape', 'defiant'],
  ['sylveon', 'pixilate'],
  ['glimmora', 'toxic-debris'],
  ['sneasler', 'poison-touch'],
  // Same Fire/Ghost typing, so the comparison is purely stats and abilities.
  ['skeledirge', 'unaware'],
  ['typhlosion-hisui', 'blaze'],
  ['dragonite', 'multiscale'],

  // Weather cores
  ['torkoal', 'drought'],
  ['venusaur', 'chlorophyll'],
  ['charizard', 'blaze'],
  ['arcanine', 'intimidate'],
  ['pelipper', 'drizzle'],
  ['basculegion-male', 'adaptability'],

  // Support and defensive specialists
  ['whimsicott', 'prankster'],
  ['grimmsnarl', 'prankster'],
  ['klefki', 'prankster'],
  ['skarmory', 'sturdy'],
  ['forretress', 'sturdy'],
  ['farigiraf', 'armor-tail'],
  ['azumarill', 'huge-power'],
  ['lucario', 'inner-focus'],
  ['talonflame', 'gale-wings'],

  // Deliberately weak: low stats, poor typing, no role
  ['pikachu', 'static'],
  ['castform', 'forecast'],
  ['watchog', 'illuminate'],
  ['emolga', 'static'],
  ['dedenne', 'cheek-pouch'],
  ['liepard', 'limber'],
  ['audino', 'healer'],
  ['arbok', 'intimidate'],
  ['simisear', 'blaze'],
  ['camerupt', 'magma-armor'],
  ['salazzle', 'corrosion'],
  ['scovillain', 'chlorophyll']
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

for (const [name, abilityName] of FIXTURE) {
  if (seen.has(name)) continue;
  seen.add(name);

  const poke = await getJson(`https://pokeapi.co/api/v2/pokemon/${name}`);
  const species = await getJson(poke.species.url);
  const types = poke.types.map((slot) => slot.type.name);

  const typeData = findType(types);
  if (!typeData) throw new Error(`no type entry for ${name} (${types.join('/')})`);

  const abilityNames = poke.abilities.map((a) => a.ability.name);
  if (!abilityNames.includes(abilityName)) {
    throw new Error(`${name} has no ability ${abilityName}; it has ${abilityNames.join(', ')}`);
  }

  const baseStats = poke.stats.reduce((acc, s) => ({ ...acc, [s.stat.name]: s.base_stat }), {});
  const stats = getEffectiveStats(baseStats, [abilityName]);

  const { abilityProfiles } = applyAbilityModifiers(typeData.damage_relations, abilityNames, BASE);
  const profile = abilityProfiles.find((p) => p.ability_name === abilityName);
  if (!profile) throw new Error(`no profile for ${name}/${abilityName}`);

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
const body = entries
  .map((e) => `  ${JSON.stringify(e.name)}: ${format(e, '  ')}`)
  .join(',\n');

process.stdout.write(`/**
 * GENERATED FILE — do not edit by hand.
 *
 * Real Pokemon data for the scoring validation fixture, produced by driving the
 * project's own pipeline: the real type chart, the real ability modifiers and
 * the real coverage table. Hand-written approximations would let the fixture
 * agree with the scoring for the wrong reasons.
 *
 * \`abilityProfiles\` is deliberately empty — scoring reads the resolved fields,
 * and carrying every profile would triple the file for no assertion's benefit.
 * Each entry's ability is pinned in the generator rather than derived, so the
 * fixture cannot drift when the ability-selection rule changes.
 *
 * Regenerate with scripts/gen-scoring-fixture.mjs. Generated ${today}.
 */

import type { PokemonEntry } from './pokemonEntry';

export const SCORING_FIXTURE_POKEMON: Readonly<Record<string, PokemonEntry>> = {
${body}
};
`);
