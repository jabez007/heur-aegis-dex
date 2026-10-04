import { loadPokemonCatalog } from './pokemonCatalogLoader';
import {
  getCatalogBaseTypes,
  getCatalogResistantTypes
} from './pokemonCatalogScan';
import { DEFAULT_BASE_SCORE } from './pokedexScoring';
import { buildDualTypes, resolveResistantTypeScanOptions } from './resistantTypeScan';
import { UNIFORM_TYPE_THREAT } from './typeThreat';
import type { PokemonTypeData, ResistantTypeResult } from './pokedexTypes';
import type { ResistantTypeScanOptions } from './resistantTypeScan';
import type { TypeThreatWeights } from './typeThreat';

const BASESCORE = DEFAULT_BASE_SCORE;

export { DEFAULT_STATS_FILTERS } from './resistantTypeScan';
export { hpAdjustedBulk } from './statMetrics';
export { chooseDefaultAbility } from './pokemonEnrichment';
export type { NamedResource, DamageRelations, PokemonTypeData } from './pokedexTypes';
export {
  REGULATIONS,
  getActiveRegulation,
  getRegulation,
  isSpeciesLegal,
  canMegaEvolve,
  hasCompleteData
} from './regulations';
export type { Regulation, RegulationId, RegulationRules, MechanicId } from './regulations';

/**
 * Loads base elemental types from the verified committed catalog.
 *
 * @param baseScore Baseline, which is also how many types are kept.
 * @param weights Threat weight per attacking type. Defaults to uniform.
 */
export async function getBaseTypes(
  baseScore: number = BASESCORE,
  weights: TypeThreatWeights = UNIFORM_TYPE_THREAT
): Promise<PokemonTypeData[]> {
  return getCatalogBaseTypes(await loadPokemonCatalog(), baseScore, weights);
}

/**
 * Builds dual types from supplied types or from the verified committed catalog.
 *
 * @param baseScore Baseline the scores are calculated with.
 * @param baseTypes Already-loaded base types to combine.
 * @param weights Threat weight per attacking type. Defaults to uniform.
 */
export async function getDualTypes(
  baseScore: number = BASESCORE,
  baseTypes?: PokemonTypeData[],
  weights: TypeThreatWeights = UNIFORM_TYPE_THREAT
): Promise<PokemonTypeData[]> {
  const resolvedBaseTypes = baseTypes ?? await getBaseTypes(baseScore, weights);
  return buildDualTypes(resolvedBaseTypes, baseScore, weights);
}

/** Runs the public scan from the verified committed catalog without live acquisition. */
export async function getResistantTypes(
  options: ResistantTypeScanOptions = {}
): Promise<ResistantTypeResult[]> {
  // Preserve the public contract that invalid regulation ids fail before any
  // data source is loaded.
  resolveResistantTypeScanOptions(options);
  return getCatalogResistantTypes(await loadPokemonCatalog(), options);
}
