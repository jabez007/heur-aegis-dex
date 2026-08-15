import { buildOffensiveTypeChart } from './coverageMoves';
import { collapseIndistinctVarieties } from './pokemonEntry';
import {
  DEFAULT_BASE_SCORE,
  calculateDamageFromScore,
  cloneDamageRelations,
  createTypeSummary,
  damageFromScoreBounds,
  damageToScoreBounds,
  filterUniqueBy
} from './pokedexScoring';
import { getRegulation } from './regulations';
import { UNIFORM_TYPE_THREAT } from './typeThreat';
import { calculateDamageToScore, chartCensus, chartFromTypeData } from './defenderCensus';
import type { DefenderCensus } from './defenderCensus';
import type { OffensiveTypeChart } from './coverageMoves';
import type { DamageScoreBounds } from './pokedexScoring';
import type { PokemonEnrichmentOptions } from './pokemonEnrichment';
import type { PokemonListEntry, PokemonTypeData, ResistantTypeResult } from './pokedexTypes';
import type { Regulation } from './regulations';
import type { TypeThreatWeights } from './typeThreat';

export const DEFAULT_STATS_FILTERS = {
  minimumAttacks: 80,
  minimumBulk: 70
} as const;

export interface ResistantTypeScanOptions {
  baseScore?: number;
  typeFilters?: {
    /**
     * Drop typings scoring worse than the `baseScore` neutral line. **Off by
     * default, and the reason is that its justification expired.**
     *
     * It was a principled filter for as long as the neutral line was somewhere
     * typings actually landed. Unweighted, every defensive score is a multiple
     * of 0.25 and 14 of the 171 combinations sat exactly on `baseScore`, so the
     * cut fell on a plateau and the `<=` swept up everything tied there.
     *
     * Threat weighting made the score continuous, and **no typing lands on the
     * line any more** — 0 of 171, against 60 sitting within 0.6 of it. The same
     * cut now slices a dense band at a point nothing distinguishes: pure Water
     * scores 18.069 and is dropped, Ghost/Grass scores 17.782 and is kept, and
     * 0.29 of separation in a band that crowded is not a judgement worth acting
     * on. In practice it removed every mono-Water and mono-Fire Pokemon from the
     * browser — Palafin, Blastoise, Vaporeon, Arcanine — and admitted Gourgeist,
     * Trevenant and Runerigus in their place.
     *
     * Ranking already expresses what this was approximating, and expresses it
     * without a cliff: a poor defensive typing sinks in the order rather than
     * vanishing. The option stays for callers that want the old behaviour, but
     * nothing turns it on by default.
     */
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
    /**
     * Scale each type's contribution to the defensive score by how much of the
     * pool can actually attack with it. On by default: a weakness nothing in the
     * metagame can exploit is not a weakness, and pricing it as one was the
     * model's largest remaining false signal. Set false for the flat count every
     * calibration before `typeThreat.ts` was measured against.
     */
    weightByThreat?: boolean;
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
  /** Whether the caller asked for threat weighting; the weights need a pool. */
  readonly weightByThreat: boolean;
  /** Resolved regulation, kept so the source can build the threat pool from it. */
  readonly regulation?: Regulation;
  /**
   * Field the offensive score is measured against. Absent before the source has
   * measured a pool, at which point `applyThreatWeights` folds one in.
   */
  readonly census?: DefenderCensus;
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
    maxDamageFromScore: false,
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
    weightByThreat: true,
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
    weightByThreat: pokemonFilters.weightByThreat,
    regulation,
    enrichment: {
      baseScore,
      threatWeights: UNIFORM_TYPE_THREAT,
      damageFromBounds: damageFromScoreBounds(baseScore),
      damageToBounds: damageToScoreBounds(baseScore),
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

/**
 * Attaches the threat weights a scan will score with.
 *
 * Separate from `resolveResistantTypeScanOptions` because measuring the weights
 * needs the pool, and the pool needs the resolved regulation. Resolution runs
 * first with uniform weights, the source measures, and this folds the result
 * back in — which also keeps the invalid-regulation error firing before any data
 * source is touched.
 *
 * @param options Already-resolved scan options.
 * @param weights Threat weights measured over the scan's own pool.
 * @param bounds Extremes the weighted score reaches, from `damageBounds.ts`.
 * @param census Field the same pool presents to an attacker.
 * @param toBounds Extremes the offensive score reaches under that census.
 * @returns Options scoring with those weights and that census.
 */
export function applyThreatWeights(
  options: ResolvedResistantTypeScanOptions,
  weights: TypeThreatWeights,
  bounds: DamageScoreBounds,
  census: DefenderCensus,
  toBounds: DamageScoreBounds
): ResolvedResistantTypeScanOptions {
  if (!options.weightByThreat) return options;
  return {
    ...options,
    census,
    enrichment: {
      ...options.enrichment,
      threatWeights: weights,
      damageFromBounds: bounds,
      damageToBounds: toBounds
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

/**
 * Builds every unordered dual type from already acquired base types.
 *
 * @param baseTypes Single elemental types with their damage relations.
 * @param baseScore Baseline the scores are calculated with.
 * @param weights Threat weight per attacking type. Defaults to uniform.
 */
export function buildDualTypes(
  baseTypes: readonly PokemonTypeData[],
  baseScore: number,
  weights: TypeThreatWeights = UNIFORM_TYPE_THREAT,
  census: DefenderCensus = chartCensus(chartFromTypeData(baseTypes))
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
      baseScore,
      weights
    );
    dualType.damage_relations.damage_to_score =
      calculateDamageToScore([first.name, second.name], census, baseScore);
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
  const allTypes = baseTypes.concat(
    buildDualTypes(baseTypes, options.baseScore, options.enrichment.threatWeights, options.census)
  );
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
        damage_from_bounds: options.enrichment.damageFromBounds,
        damage_to_bounds: options.enrichment.damageToBounds,
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
