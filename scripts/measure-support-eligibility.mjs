// Measures which scan-visible Pokemon the stat floors reject before support-role
// scoring can consider them.
//
// Run with:  npm run measure:support-eligibility -- M-B

import { getAbilityEffect } from '../src/lib/abilityRoles.ts';
import { flattenToPokemon } from '../src/lib/pokemonEntry.ts';
import { DEFAULT_STATS_FILTERS, getResistantTypes } from '../src/lib/pokedex.ts';
import { getRegulation } from '../src/lib/regulations.ts';
import { hpAdjustedBulk } from '../src/lib/statMetrics.ts';

const regulationId = process.argv[2] ?? 'M-B';
const regulation = getRegulation(regulationId);
if (!regulation) {
  process.stderr.write(`Unknown regulation: ${regulationId}\n`);
  process.exit(1);
}

const scanOptions = {
  typeFilters: {
    maxDamageFromScore: false,
    allowQuadrupleDamage: true,
    limitQuadrupleDamage: false
  },
  pokemonFilters: {
    inPokedex: 'national',
    allowMegas: false,
    includeAbilityImmunities: true,
    includeMoveCoverage: true,
    regulation: regulation.id
  }
};

process.stderr.write(`Scanning ${regulation.id} with current stat floors...\n`);
const eligible = flattenToPokemon(await getResistantTypes({
  ...scanOptions,
  statsFilters: DEFAULT_STATS_FILTERS
}));

process.stderr.write('Repeating scan without stat floors...\n');
const candidates = flattenToPokemon(await getResistantTypes({
  ...scanOptions,
  statsFilters: { minimumAttacks: 0, minimumBulk: 0 }
}));

const eligibleNames = new Set(eligible.map((pokemon) => pokemon.name));
const rejected = candidates
  .filter((pokemon) => !eligibleNames.has(pokemon.name))
  .sort((left, right) => left.name.localeCompare(right.name));
const roleBearingRejected = rejected.filter((pokemon) =>
  Object.keys(pokemon.abilityProfiles).some((abilityName) => getAbilityEffect(abilityName))
);

process.stdout.write(`# regulation=${regulation.id} verifiedOn=${regulation.verifiedOn} legalSpecies=${regulation.legalSpecies.size}\n`);
process.stdout.write(`# floors attack=${DEFAULT_STATS_FILTERS.minimumAttacks} bulk=${DEFAULT_STATS_FILTERS.minimumBulk}\n`);
process.stdout.write(`# candidateVarieties=${candidates.length} eligible=${eligible.length} rejected=${rejected.length} roleBearingRejected=${roleBearingRejected.length}\n`);
process.stdout.write('# scope=registerable breedable varieties belonging to legal species; form legality is species-level\n');
process.stdout.write('variety\tspecies\tability\tattack\tbulk\tfailed\tsupportRole\tfieldState\n');

for (const pokemon of rejected) {
  const profiles = Object.entries(pokemon.abilityProfiles);
  for (const [abilityName, profile] of profiles) {
    const stats = profile.stats ?? pokemon.stats;
    const attack = Math.max(stats.attack, stats['special-attack']);
    const bulk = hpAdjustedBulk(stats);
    const failed = [];
    if (attack < DEFAULT_STATS_FILTERS.minimumAttacks) failed.push('attack');
    if (bulk < DEFAULT_STATS_FILTERS.minimumBulk) failed.push('bulk');
    const effect = getAbilityEffect(abilityName);

    process.stdout.write([
      pokemon.name,
      pokemon.speciesName,
      abilityName || '-',
      attack,
      bulk.toFixed(1),
      failed.join(',') || '-',
      effect?.role ?? '-',
      effect?.fieldState ?? '-'
    ].join('\t') + '\n');
  }
}
