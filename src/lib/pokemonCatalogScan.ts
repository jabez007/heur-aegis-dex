import { getMergedBattleForm, sharesTyping } from './battleForms';
import { measureDamageFromBounds, measureDamageToBounds } from './damageBounds';
import { enrichPokemon } from './pokemonEnrichment';
import { calculateDamageFromScore } from './pokedexScoring';
import {
  calculateDamageToScore,
  chartCensus,
  measureDefenderCensus
} from './defenderCensus';
import type { DefenderCensus } from './defenderCensus';
import type { ThreatTypeChart } from './typeThreat';
import {
  applyThreatWeights,
  resolveResistantTypeScanOptions,
  runResistantTypeScan
} from './resistantTypeScan';
import { getDamageFromBounds, getDamageToBounds, getThreatPool, getThreatWeights } from './threatPool';
import { UNIFORM_TYPE_THREAT } from './typeThreat';
import type { OffensiveTypeChart } from './coverageMoves';
import type {
  CatalogTypeV1,
  CatalogVarietyV1,
  PokemonCatalogV1
} from './pokemonCatalog';
import type { PokemonEnrichmentFacts, PokemonEnrichmentOptions } from './pokemonEnrichment';
import type {
  DamageRelations,
  NamedResource,
  PokemonListEntry,
  PokemonTypeData,
  ResistantTypeResult
} from './pokedexTypes';
import type { ResistantTypeScanOptions } from './resistantTypeScan';
import type { TypeThreatWeights } from './typeThreat';

const resources = (names: readonly string[]): NamedResource[] => names.map((name) => ({ name }));

/**
 * Converts a normalized catalog type into the scan engine's base-type shape.
 *
 * @param type Catalog type with its damage relations.
 * @param catalog Verified catalog, for the varieties carrying the type.
 * @param baseScore Baseline the scores are calculated with.
 * @param weights Threat weight per attacking type. Defaults to uniform.
 */
export function catalogTypeToPokemonType(
  type: CatalogTypeV1,
  catalog: PokemonCatalogV1,
  baseScore: number,
  weights: TypeThreatWeights = UNIFORM_TYPE_THREAT,
  census?: DefenderCensus
): PokemonTypeData {
  const damageRelations: DamageRelations = {
    double_damage_from: resources(type.damageRelations.doubleDamageFrom),
    half_damage_from: resources(type.damageRelations.halfDamageFrom),
    no_damage_from: resources(type.damageRelations.noDamageFrom),
    double_damage_to: resources(type.damageRelations.doubleDamageTo),
    half_damage_to: resources(type.damageRelations.halfDamageTo),
    no_damage_to: resources(type.damageRelations.noDamageTo)
  };
  damageRelations.damage_from_score = calculateDamageFromScore(damageRelations, baseScore, weights);
  // Scored against the field when one has been measured, and against the chart
  // census otherwise — which is what the offensive score always did.
  damageRelations.damage_to_score = calculateDamageToScore(
    [type.name],
    census ?? chartCensus(catalogChart(catalog, baseScore)),
    baseScore
  );

  return {
    id: type.id,
    name: type.name,
    damage_relations: damageRelations,
    pokemon: catalog.varieties
      .filter((variety) => variety.types.includes(type.name))
      .map((variety) => ({
        pokemon: {
          name: variety.name,
          url: `https://pokeapi.co/api/v2/pokemon/${variety.id}/`
        }
      }))
  };
}

/**
 * Builds the standard base types from a validated catalog without network access.
 *
 * @param catalog Verified catalog.
 * @param baseScore Baseline, which is also how many types are kept.
 * @param weights Threat weight per attacking type. Defaults to uniform.
 */
export function getCatalogBaseTypes(
  catalog: PokemonCatalogV1,
  baseScore: number,
  weights: TypeThreatWeights = UNIFORM_TYPE_THREAT,
  census?: DefenderCensus
): PokemonTypeData[] {
  return catalog.types
    .filter((type) => type.id <= baseScore)
    .map((type) => catalogTypeToPokemonType(type, catalog, baseScore, weights, census));
}

/** The type chart in the shape the census wants, straight off the catalog. */
export function catalogChart(catalog: PokemonCatalogV1, baseScore: number): ThreatTypeChart {
  return Object.fromEntries(catalog.types
    .filter((type) => type.id <= baseScore)
    .map((type) => [type.name, type.damageRelations]));
}

const toFacts = (
  catalog: PokemonCatalogV1,
  variety: CatalogVarietyV1
): PokemonEnrichmentFacts => {
  const species = catalog.species.find((entry) => entry.name === variety.speciesName);
  if (!species) throw new Error(`Catalog variety ${variety.name} references missing species ${variety.speciesName}`);

  const abilityNames = variety.abilities.map((ability) => ability.name);
  const battleRule = getMergedBattleForm(species.name, abilityNames);
  const battleVariety = battleRule
    ? catalog.varieties.find((entry) => entry.name === battleRule.variety)
    : undefined;
  const useBattleVariety = battleVariety && sharesTyping(variety.types, battleVariety.types);

  return {
    id: variety.id,
    name: variety.name,
    url: `https://pokeapi.co/api/v2/pokemon/${variety.id}/`,
    speciesName: species.name,
    isDefault: variety.isDefault,
    types: variety.types.map((name) => ({ type: { name } })),
    sprite: variety.sprite,
    abilities: variety.abilities.map((ability) => ({
      name: ability.name,
      is_hidden: ability.isHidden
    })),
    stats: useBattleVariety ? battleVariety.stats : variety.stats,
    battleFormName: useBattleVariety ? battleRule?.variety : undefined,
    isLegendary: species.isLegendary,
    isMythical: species.isMythical,
    eggGroups: species.eggGroups,
    pokedexes: species.pokedexes,
    form: variety.form
  };
};

/** Joins one catalog variety to its species and enriches it with the shared scan rules. */
export function enrichCatalogVariety(
  catalog: PokemonCatalogV1,
  variety: CatalogVarietyV1,
  type: PokemonTypeData,
  offensiveChart: OffensiveTypeChart,
  options: PokemonEnrichmentOptions
): PokemonListEntry | null {
  return enrichPokemon(toFacts(catalog, variety), type, offensiveChart, options);
}

/**
 * Runs the complete scan from a validated catalog without live acquisition.
 * This remains an internal parity path until the runtime source is cut over.
 */
export async function getCatalogResistantTypes(
  catalog: PokemonCatalogV1,
  options: ResistantTypeScanOptions = {}
): Promise<ResistantTypeResult[]> {
  const resolved = resolveResistantTypeScanOptions(options);

  // Weights come from the regulation the scan is restricted to, so a scan
  // prepares against the metagame it is a scan of. The browser re-derives the
  // same weights from the same regulation when it flattens a cached result, so
  // nothing here needs serializing — see `threatPool.ts`.
  const weights = resolved.weightByThreat
    ? getThreatWeights(catalog, {
      regulation: resolved.regulation,
      baseScore: resolved.baseScore
    })
    : UNIFORM_TYPE_THREAT;

  // The same pool, read the other way round: threat weighting asks what it can
  // attack with, the census asks what it *is*. See `defenderCensus.ts` for why
  // those are different questions with different answers.
  const census = resolved.weightByThreat
    ? measureDefenderCensus(
      getThreatPool(catalog, { regulation: resolved.regulation, baseScore: resolved.baseScore }),
      catalogChart(catalog, resolved.baseScore),
      resolved.baseScore
    )
    : chartCensus(catalogChart(catalog, resolved.baseScore));

  // Bounds come from the Pokemon this regulation can field, not from the whole
  // type lattice — see `measurePoolDamageFromBounds`. They travel with the
  // weights and the census because all four are one measurement of one pool;
  // mixing a score from one pool with a range from another is the compression
  // defect `damageBounds.ts` exists to prevent. The lattice they are looked up
  // through stays unweighted, since only its buckets are read.
  const selection = { regulation: resolved.regulation, baseScore: resolved.baseScore };
  const resolvedOptions = applyThreatWeights(
    resolved,
    weights,
    resolved.weightByThreat
      ? getDamageFromBounds(catalog, selection, getCatalogBaseTypes(catalog, resolved.baseScore))
      : measureDamageFromBounds(
        getCatalogBaseTypes(catalog, resolved.baseScore), resolved.baseScore, weights
      ),
    census,
    resolved.weightByThreat
      ? getDamageToBounds(catalog, selection)
      : measureDamageToBounds(census, resolved.baseScore)
  );
  const baseTypes = getCatalogBaseTypes(catalog, resolvedOptions.baseScore, weights, census);
  const varietiesByName = new Map(catalog.varieties.map((variety) => [variety.name, variety]));

  return runResistantTypeScan(baseTypes, resolvedOptions, {
    enrichType: (type, offensiveChart, enrichmentOptions) =>
      (type.pokemon || []).map((entry) => {
        const variety = varietiesByName.get(entry.pokemon.name);
        if (!variety) throw new Error(`Catalog type ${type.name} references missing variety ${entry.pokemon.name}`);
        return enrichCatalogVariety(
          catalog,
          variety,
          type,
          offensiveChart,
          enrichmentOptions
        );
      })
  });
}
