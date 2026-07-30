import { buildOffensiveTypeChart } from './coverageMoves';
import { collapseIndistinctVarieties } from './pokemonEntry';
import {
  DEFAULT_BASE_SCORE,
  calculateDamageFromScore,
  calculateDamageToScore,
  cloneDamageRelations,
  createTypeSummary,
  filterUniqueBy
} from './pokedexScoring';
import { getRegulation } from './regulations';
import type { OffensiveTypeChart } from './coverageMoves';
import type { PokemonEnrichmentOptions } from './pokemonEnrichment';
import type { PokemonListEntry, PokemonTypeData, ResistantTypeResult } from './pokedexTypes';

export const DEFAULT_STATS_FILTERS = {
  minimumAttacks: 80,
  minimumBulk: 70
} as const;

export interface ResistantTypeScanOptions {
  baseScore?: number;
  typeFilters?: {
    maxDamageFromScore?: boolean;
    allowQuadrupleDamage?: boolean;
    limitQuadrupleDamage?: boolean;
  };
  pokemonFilters?: {
    inPokedex?: string;
    allowMegas?: boolean;
    includeAbilityImmunities?: boolean;
    /** Include coverage reachable through learnable moves, not only STAB. */
    includeMoveCoverage?: boolean;
    /** Restrict results to a known regulation roster; null means unrestricted. */
    regulation?: string | null;
  };
  statsFilters?: {
    /** @deprecated Ignored. Total base stats are no longer a scan filter. */
    minimumStatsTotal?: number;
    minimumAttacks?: number;
    minimumBulk?: number;
    /** @deprecated Use minimumBulk. Retained for saved settings and API compatibility. */
    minimumDefenses?: number;
  };
}

export interface ResolvedResistantTypeScanOptions {
  readonly baseScore: number;
  readonly typeFilters: {
    readonly maxDamageFromScore: boolean;
    readonly allowQuadrupleDamage: boolean;
    readonly limitQuadrupleDamage: boolean;
  };
  readonly enrichment: PokemonEnrichmentOptions;
}

export interface ResistantTypeScanSource {
  prepare?: (types: readonly PokemonTypeData[]) => Promise<void>;
  enrichType: (
    type: PokemonTypeData,
    offensiveChart: OffensiveTypeChart,
    options: PokemonEnrichmentOptions
  ) => Promise<readonly (PokemonListEntry | null)[]> | readonly (PokemonListEntry | null)[];
}

/** Resolves every scan default and rejects unknown regulations before acquisition. */
export function resolveResistantTypeScanOptions(
  options: ResistantTypeScanOptions = {}
): ResolvedResistantTypeScanOptions {
  const baseScore = options.baseScore === undefined ? DEFAULT_BASE_SCORE : options.baseScore;
  const typeFilters = {
    maxDamageFromScore: true,
    allowQuadrupleDamage: true,
    limitQuadrupleDamage: true,
    ...options.typeFilters
  };
  const pokemonFilters = {
    inPokedex: 'national',
    allowMegas: false,
    includeAbilityImmunities: true,
    includeMoveCoverage: true,
    regulation: null,
    ...options.pokemonFilters
  };
  const regulation = pokemonFilters.regulation
    ? getRegulation(pokemonFilters.regulation)
    : undefined;
  if (pokemonFilters.regulation && !regulation) {
    throw new Error(`Unknown regulation: ${pokemonFilters.regulation}`);
  }

  return {
    baseScore,
    typeFilters,
    enrichment: {
      baseScore,
      inPokedex: pokemonFilters.inPokedex,
      allowMegas: pokemonFilters.allowMegas,
      includeAbilityImmunities: pokemonFilters.includeAbilityImmunities,
      includeMoveCoverage: pokemonFilters.includeMoveCoverage,
      minimumAttacks: options.statsFilters?.minimumAttacks ?? DEFAULT_STATS_FILTERS.minimumAttacks,
      minimumBulk: options.statsFilters?.minimumBulk ??
        options.statsFilters?.minimumDefenses ??
        DEFAULT_STATS_FILTERS.minimumBulk,
      regulation
    }
  };
}

const pairCombinations = <T>(items: readonly T[]): [T, T][] => {
  const pairs: [T, T][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) pairs.push([items[i], items[j]]);
  }
  return pairs;
};

const clonePokemonEntry = (entry: PokemonListEntry): PokemonListEntry => {
  const abilityProfiles = entry.ability_profiles
    ? Object.fromEntries(
        Object.entries(entry.ability_profiles).map(([abilityName, profile]) => [
          abilityName,
          {
            ...profile,
            damage_relations: profile.damage_relations
              ? cloneDamageRelations(profile.damage_relations)
              : undefined,
            weaknesses: [...(profile.weaknesses || [])],
            quadruple_weaknesses: [...(profile.quadruple_weaknesses || [])],
            resistances: [...(profile.resistances || [])],
            immunities: [...(profile.immunities || [])],
            ineffectives: [...(profile.ineffectives || [])],
            coverages: [...(profile.coverages || [])],
            stats: profile.stats ? { ...profile.stats } : undefined,
            move_coverages: profile.move_coverages ? [...profile.move_coverages] : undefined
          }
        ])
      )
    : undefined;

  return {
    ...entry,
    pokemon: { ...entry.pokemon },
    types: entry.types?.map((slot) => ({ ...slot, type: { ...slot.type } })),
    abilities: entry.abilities?.map((ability) => ({ ...ability })),
    stats: entry.stats ? { ...entry.stats } : undefined,
    base_stats: entry.base_stats ? { ...entry.base_stats } : undefined,
    ability_profiles: abilityProfiles,
    effective_damage_relations: entry.effective_damage_relations
      ? cloneDamageRelations(entry.effective_damage_relations)
      : undefined,
    effective_weaknesses: [...(entry.effective_weaknesses || [])],
    effective_quadruple_weaknesses: [...(entry.effective_quadruple_weaknesses || [])],
    effective_resistances: [...(entry.effective_resistances || [])],
    effective_immunities: [...(entry.effective_immunities || [])],
    effective_move_coverages: [...(entry.effective_move_coverages || [])],
    effective_ineffectives: [...(entry.effective_ineffectives || [])],
    effective_coverages: [...(entry.effective_coverages || [])]
  };
};

/** Builds every unordered dual type from already acquired base types. */
export function buildDualTypes(
  baseTypes: readonly PokemonTypeData[],
  baseScore: number
): PokemonTypeData[] {
  return pairCombinations(baseTypes).map(([first, second]) => {
    const dr0 = first.damage_relations;
    const dr1 = second.damage_relations;
    const dualType: PokemonTypeData = {
      name: `${first.name}/${second.name}`,
      damage_relations: {
        quadruple_damage_from: dr0.double_damage_from
          .filter((left) => dr1.double_damage_from.some((right) => left.name === right.name)),
        double_damage_from: filterUniqueBy(dr0.double_damage_from.concat(dr1.double_damage_from))
          .filter((damage) =>
            (dr0.double_damage_from.every((entry) => damage.name !== entry.name) ||
              dr1.double_damage_from.every((entry) => damage.name !== entry.name)) &&
            dr0.half_damage_from.every((entry) => damage.name !== entry.name) &&
            dr1.half_damage_from.every((entry) => damage.name !== entry.name) &&
            dr0.no_damage_from.every((entry) => damage.name !== entry.name) &&
            dr1.no_damage_from.every((entry) => damage.name !== entry.name)
          ),
        double_damage_to: filterUniqueBy(dr0.double_damage_to.concat(dr1.double_damage_to)),
        half_damage_from: filterUniqueBy(dr0.half_damage_from.concat(dr1.half_damage_from))
          .filter((damage) =>
            (dr0.half_damage_from.every((entry) => damage.name !== entry.name) ||
              dr1.half_damage_from.every((entry) => damage.name !== entry.name)) &&
            dr0.double_damage_from.every((entry) => damage.name !== entry.name) &&
            dr1.double_damage_from.every((entry) => damage.name !== entry.name) &&
            dr0.no_damage_from.every((entry) => damage.name !== entry.name) &&
            dr1.no_damage_from.every((entry) => damage.name !== entry.name)
          ),
        half_damage_to: dr0.half_damage_to
          .filter((left) =>
            dr1.half_damage_to.some((right) => left.name === right.name) ||
            dr1.no_damage_to.some((right) => left.name === right.name)
          )
          .concat(dr1.half_damage_to.filter((right) =>
            dr0.no_damage_to.some((left) => right.name === left.name)
          )),
        quarter_damage_from: dr0.half_damage_from
          .filter((left) => dr1.half_damage_from.some((right) => left.name === right.name)),
        no_damage_from: filterUniqueBy(dr0.no_damage_from.concat(dr1.no_damage_from)),
        no_damage_to: dr0.no_damage_to
          .filter((left) => dr1.no_damage_to.some((right) => left.name === right.name))
      },
      pokemon: (first.pokemon || [])
        .filter((left) => (second.pokemon || []).some(
          (right) => left.pokemon.name === right.pokemon.name
        ))
        .map(clonePokemonEntry)
    };
    dualType.damage_relations.damage_from_score = calculateDamageFromScore(
      dualType.damage_relations,
      baseScore
    );
    dualType.damage_relations.damage_to_score = calculateDamageToScore(
      dualType.damage_relations,
      baseScore
    );
    return dualType;
  });
}

const passesTypeFilters = (
  type: PokemonTypeData,
  options: ResolvedResistantTypeScanOptions
): boolean => {
  if (options.typeFilters.maxDamageFromScore &&
    (type.damage_relations.damage_from_score || 0) > options.baseScore) return false;

  const quadrupleCount = (type.damage_relations.quadruple_damage_from || []).length;
  if (!options.typeFilters.allowQuadrupleDamage) return quadrupleCount === 0;
  if (!options.typeFilters.limitQuadrupleDamage) return true;
  return quadrupleCount === 0 ||
    (quadrupleCount === 1 && type.damage_relations.double_damage_from.length === 0);
};

/** Runs source-independent dual construction, filtering, summarization, and ranking. */
export async function runResistantTypeScan(
  baseTypes: PokemonTypeData[],
  options: ResolvedResistantTypeScanOptions,
  source: ResistantTypeScanSource
): Promise<ResistantTypeResult[]> {
  const allTypes = baseTypes.concat(buildDualTypes(baseTypes, options.baseScore));
  const offensiveChart = buildOffensiveTypeChart(baseTypes);
  await source.prepare?.(allTypes);

  const results = await Promise.all(
    allTypes.filter((type) => passesTypeFilters(type, options)).map(async (type) => {
      const enriched = await source.enrichType(type, offensiveChart, options.enrichment);
      const pokemon = collapseIndistinctVarieties(
        enriched
          .filter((entry): entry is PokemonListEntry => entry !== null)
          .filter((entry) => type.name.includes('/') || (entry.types?.length || 0) === 1)
      ).sort((left, right) => (right.stats_total || 0) - (left.stats_total || 0));

      return {
        name: type.name,
        include_ability_immunities: options.enrichment.includeAbilityImmunities,
        ...createTypeSummary(type.damage_relations),
        pokemon
      } satisfies ResistantTypeResult;
    })
  );

  return results.sort((left, right) => {
    const leftFrom = left.damage_from_score ?? Number.POSITIVE_INFINITY;
    const leftTo = left.damage_to_score ?? 1;
    const rightFrom = right.damage_from_score ?? Number.POSITIVE_INFINITY;
    const rightTo = right.damage_to_score ?? 1;
    const leftQuotient = leftFrom / leftTo;
    const rightQuotient = rightFrom / rightTo;
    return rightQuotient === leftQuotient
      ? leftFrom - rightFrom
      : leftQuotient - rightQuotient;
  });
}
