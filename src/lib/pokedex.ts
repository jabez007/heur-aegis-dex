import { loadPokemonCatalog } from './pokemonCatalogLoader';
import {
  getCatalogBaseTypes,
  getCatalogResistantTypes
} from './pokemonCatalogScan';
import { DEFAULT_BASE_SCORE } from './pokedexScoring';
import { buildDualTypes, resolveResistantTypeScanOptions } from './resistantTypeScan';
import type { PokemonTypeData, ResistantTypeResult } from './pokedexTypes';
import type { ResistantTypeScanOptions } from './resistantTypeScan';

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

/** Loads base elemental types from the verified committed catalog. */
export async function getBaseTypes(baseScore: number = BASESCORE): Promise<PokemonTypeData[]> {
  return getCatalogBaseTypes(await loadPokemonCatalog(), baseScore);
}

/** Builds dual types from supplied types or from the verified committed catalog. */
export async function getDualTypes(
  baseScore: number = BASESCORE,
  baseTypes?: PokemonTypeData[]
): Promise<PokemonTypeData[]> {
  const resolvedBaseTypes = baseTypes ?? await getBaseTypes(baseScore);
  return buildDualTypes(resolvedBaseTypes, baseScore);
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
