/**
 * The Pokemon entity.
 *
 * The scan is organised around type combinations: 171 of them, each carrying
 * the Pokemon that share that typing. That shape was inherited from a tool that
 * ranked *typings*, and it makes the Pokemon a property of its type rather than
 * the other way round. Everything that actually varies — stats, abilities,
 * movepool, whether you are allowed to use it — belongs to the Pokemon.
 *
 * This module flattens the scan into Pokemon records so the rest of the app can
 * treat them as the primary entity. A typing becomes what it should always have
 * been: one of a Pokemon's attributes, and a way to group them for browsing.
 *
 * The grid still consumes the type-keyed view, so both shapes coexist. This is
 * the seam that lets them.
 */

import {
  DEFAULT_BASE_SCORE,
  calculateDamageFromResidual,
  calculateDamageFromScore,
  normalizeDamageFromScore,
  normalizeDamageToScore
} from './pokedexScoring';
import type { DamageScoreBounds } from './pokedexScoring';
import type {
  AbilityProfile,
  DamageRelations,
  PokemonAbilitySlot,
  PokemonListEntry,
  PokemonStats,
  TeamTypeData
} from './pokedexTypes';
import type { TypeThreatWeights } from './typeThreat';
import { calculateDamageToScore } from './defenderCensus';
import type { DefenderCensus } from './defenderCensus';
import { getEffectiveStats, getStatAbilityName, totalStats } from './statAbilities';

/**
 * The metagame a flattened Pokemon is scored against.
 *
 * A scan bakes in the weighting of the regulation it ran under, and that is the
 * wrong answer for two cases the browser has to handle. A cup narrows the pool
 * after the scan is finished, and a cached scan may predate the weighting
 * entirely. Both are solved the same way: the raw defensive score is recomputed
 * here from the damage relations every entry already carries, so the stored
 * score is treated as a cache rather than as the truth.
 *
 * Weights and bounds travel together and must come from the same measurement.
 * A score weighted one way and normalized against another way's range is the
 * compression bug `damageBounds.ts` exists to prevent, and it is silent.
 */
export interface ThreatScoring {
  /**
   * Weighting to re-score under. Absent keeps the score the scan recorded, which
   * is what a result read on its own terms wants: the scan already weighted it,
   * and only the range it was measured against has to travel alongside.
   */
  readonly weights?: TypeThreatWeights;
  readonly bounds: DamageScoreBounds;
  /**
   * Field to re-score the offensive side against, and the range it reaches.
   * Same contract as `weights` and `bounds`: absent keeps the scan's own score,
   * and a census present without its bounds would normalize one measurement
   * against another's range.
   */
  readonly census?: DefenderCensus;
  readonly toBounds: DamageScoreBounds;
}

/** Reads a scan's own recorded ranges without re-scoring anything under them. */
const asStoredScoring = (
  bounds: DamageScoreBounds | undefined,
  toBounds: DamageScoreBounds | undefined
): ThreatScoring | undefined => (bounds && toBounds ? { bounds, toBounds } : undefined);

/**
 * Re-derives an offensive score under a census, falling back to the stored one.
 *
 * Takes the attacker's types rather than its damage relations, because the
 * merged `damage_to` buckets cannot resolve a dual defender — see
 * `defenderCensus.ts`.
 *
 * @param types The attacker's own elemental types.
 * @param stored Score the scan recorded, used when no census is supplied.
 * @param baseScore Baseline the score is calculated with.
 * @param scoring Census to score against, or undefined to keep the stored score.
 * @returns The raw offensive score to normalize.
 */
const rescoreDamageTo = (
  types: readonly string[] | undefined,
  stored: number | undefined,
  baseScore: number,
  scoring: ThreatScoring | undefined
): number | undefined => {
  if (!scoring?.census || !types || types.length === 0) return stored;
  return calculateDamageToScore(types, scoring.census, baseScore);
};

/**
 * Re-derives a defensive score under a weighting, falling back to the stored one.
 *
 * @param relations Damage relations from the profile being scored.
 * @param stored Score the scan recorded, used when the buckets are unavailable.
 * @param baseScore Baseline the score is calculated with.
 * @param scoring Weights to score with, or undefined to keep the stored score.
 * @returns The raw defensive score to normalize.
 */
const rescoreDamageFrom = (
  relations: DamageRelations | undefined,
  stored: number | undefined,
  baseScore: number,
  scoring: ThreatScoring | undefined
): number | undefined => {
  if (!scoring?.weights || !relations) return stored;
  return calculateDamageFromScore(relations, baseScore, scoring.weights)
    + calculateDamageFromResidual(relations, scoring.weights);
};

export interface PokemonEntry {
  /** PokeAPI variety name. Unique, and the key everything else joins on. */
  name: string;
  /** PokeAPI species name. Regional forms and Megas share their base species. */
  speciesName: string;
  /** The type combination this Pokemon was found under, for example `water/flying`. */
  typeName: string;
  /** The Pokemon's own elemental types. */
  types: string[];
  sprite: string;
  /**
   * Battle-only form `stats` describe, when the Pokemon registers as one form
   * and fights as another. Absent when it is rated as registered.
   */
  battleFormName?: string;
  /**
   * Stats it fights with: the published line after the selected ability's
   * multiplier. Scoring and the stat floors judge on these.
   */
  stats: PokemonStats;
  /** The published line, before abilities. */
  baseStats: PokemonStats;
  /** Ability responsible for the difference between the two, when there is one. */
  statAbilityName?: string;
  statsTotal: number;
  abilities: PokemonAbilitySlot[];
  /** Ability currently selected for battle. */
  abilityName: string;
  abilityProfiles: Record<string, AbilityProfile>;
  weaknesses: string[];
  quadrupleWeaknesses: string[];
  resistances: string[];
  /** Strict 0x subset of `resistances`. */
  immunities: string[];
  /** Types this Pokemon hits super-effectively off STAB. */
  coverages: string[];
  /** Types reachable super-effectively through any learnable move. */
  moveCoverages: string[];
  normalizedDamageToScore: number;
  normalizedDamageFromScore: number;
  /**
   * The metagame `normalizedDamageFromScore` was computed under.
   *
   * Carried on the Pokemon so that re-deriving its profile — which `withAbility`
   * does from eight call sites across the guided flow, the workbench and the
   * roster — lands on the same scale it was flattened onto. Without it every one
   * of those call sites would have to remember to pass the weighting, and the
   * failure when one forgot would be a silently compressed defensive term rather
   * than an error.
   */
  scoring?: ThreatScoring;
}

/**
 * Resolves the currently active ability profile for a Pokemon, falling back to
 * its effective profile fields when no named ability profile is available.
 *
 * @param pokemon Pokemon entry to inspect.
 * @param abilityName Optional explicit ability name to resolve instead of the stored selection.
 * @returns The matching ability profile, a profile synthesized from effective fields, or `null`.
 */
export function getPokemonAbilityProfile(pokemon: PokemonListEntry | null | undefined, abilityName?: string): AbilityProfile | null {
  if (!pokemon) return null;

  const selectedAbilityName = abilityName || pokemon.selected_ability_name;
  if (selectedAbilityName && pokemon.ability_profiles?.[selectedAbilityName]) {
    return pokemon.ability_profiles[selectedAbilityName];
  }

  const hasEffectiveProfile =
    pokemon.effective_damage_from_score !== undefined ||
    pokemon.effective_damage_to_score !== undefined ||
    pokemon.effective_weaknesses !== undefined ||
    pokemon.effective_resistances !== undefined ||
    pokemon.effective_immunities !== undefined;

  if (!hasEffectiveProfile) {
    return null;
  }

  return {
    damage_relations: pokemon.effective_damage_relations as DamageRelations | undefined,
    weaknesses: pokemon.effective_weaknesses || [],
    quadruple_weaknesses: pokemon.effective_quadruple_weaknesses || [],
    resistances: pokemon.effective_resistances || [],
    immunities: pokemon.effective_immunities || [],
    ineffectives: pokemon.effective_ineffectives || [],
    coverages: pokemon.effective_coverages || [],
    damage_from_score: pokemon.effective_damage_from_score,
    damage_to_score: pokemon.effective_damage_to_score
  };
}

const EMPTY_STATS: PokemonStats = {
  hp: 0, attack: 0, defense: 0, 'special-attack': 0, 'special-defense': 0, speed: 0
};

/**
 * Converts one scan entry into a Pokemon record.
 *
 * The ability stays as the scan selected it. Under a cup's weighting a different
 * ability could win — Levitate is worth what Ground is worth — but re-running
 * that choice means re-scoring every profile through member quality, and the
 * user can pick the ability directly anyway, at which point `withAbility`
 * re-derives everything under the same weights. Recorded as a known edge rather
 * than left to be discovered.
 *
 * @param entry Pokemon as the scan stored it, nested under a type.
 * @param typeName The type combination it was found under.
 * @param baseScore Baseline the damage scores were calculated with.
 * @param scoring Metagame to score against. Omitted keeps the scan's own scores.
 * @returns A flat Pokemon record, or null when the entry lacks usable data.
 */
export function toPokemonEntry(
  entry: PokemonListEntry,
  typeName: string,
  baseScore: number = DEFAULT_BASE_SCORE,
  scoring?: ThreatScoring
): PokemonEntry | null {
  if (!entry?.pokemon?.name || !entry.stats) return null;

  const profile = getPokemonAbilityProfile(entry);
  // Prefer the Pokemon's own types; fall back to splitting the grouping name for
  // entries the scan never enriched. Hoisted because the offensive score is now
  // computed from them rather than from a damage-relations summary.
  const types = entry.types?.map((slot) => slot.type.name) ?? typeName.split('/');
  // The selected ability's own stat line where the scan recorded one, since
  // Huge Power and its kin change the numbers as well as the resistances.
  const stats = profile?.stats ?? entry.stats;
  const statsTotal = profile?.stats_total
    ?? entry.stats_total
    ?? totalStats(stats);

  return {
    name: entry.pokemon.name,
    speciesName: entry.species_name || entry.pokemon.name,
    typeName,
    // Prefer the Pokemon's own types; fall back to splitting the grouping name
    // for entries the scan never enriched.
    types,
    sprite: entry.sprite || '',
    battleFormName: entry.battle_form_name,
    stats: stats ?? EMPTY_STATS,
    baseStats: entry.base_stats ?? entry.stats ?? EMPTY_STATS,
    statAbilityName: getStatAbilityName([entry.selected_ability_name]),
    statsTotal,
    abilities: entry.abilities ?? [],
    abilityName: entry.selected_ability_name || '',
    abilityProfiles: entry.ability_profiles ?? {},
    weaknesses: profile?.weaknesses ?? entry.effective_weaknesses ?? [],
    quadrupleWeaknesses: profile?.quadruple_weaknesses ?? entry.effective_quadruple_weaknesses ?? [],
    resistances: profile?.resistances ?? entry.effective_resistances ?? [],
    immunities: profile?.immunities ?? entry.effective_immunities ?? [],
    coverages: profile?.coverages ?? entry.effective_coverages ?? [],
    // Profile first, like every field around it. Which half of a learnset is
    // worth a moveslot depends on the stats the Pokemon fights with, and those
    // follow the ability — so coverage is an ability-resolved value, not an
    // entry-level one. A fresh scan sets `effective_move_coverages` from this
    // same profile, so the two agree today; the asymmetry was a trap rather
    // than a live defect, and `withAbility` below already reads it this way.
    moveCoverages: profile?.move_coverages ?? entry.effective_move_coverages ?? [],
    scoring,
    normalizedDamageToScore: normalizeDamageToScore(
      rescoreDamageTo(
        types, profile?.damage_to_score ?? entry.effective_damage_to_score, baseScore, scoring
      ),
      baseScore,
      scoring?.toBounds
    ),
    normalizedDamageFromScore: normalizeDamageFromScore(
      rescoreDamageFrom(
        profile?.damage_relations ?? entry.effective_damage_relations,
        profile?.damage_from_score ?? entry.effective_damage_from_score,
        baseScore,
        scoring
      ),
      baseScore,
      scoring?.bounds
    )
  };
}

/**
 * Drops varieties of a species that this tool cannot tell apart.
 *
 * PokeAPI models a great deal of cosmetic variation as separate varieties.
 * Pikachu alone carries fifteen — the cosplay outfits and every travelling cap —
 * each with identical stats, typing and abilities. Totem Pokemon are the same
 * story: oversized Sun/Moon variants whose numbers match the base form exactly.
 * All of them arrived in the browser as their own Pokemon, competing for
 * attention with genuinely different choices.
 *
 * The rule is deliberately narrow: two varieties collapse only when everything
 * this tool models about them matches. That makes the removal safe by
 * construction — whatever is dropped was indistinguishable from what stays, so
 * no option is lost. Varieties that genuinely differ survive, which is why
 * Basculegion keeps both its forms (112 Attack against 92, 80 Special Attack
 * against 100) and Meowstic keeps both of its (identical stats, but Prankster
 * against Competitive).
 *
 * Deliberately *not* keyed on move coverage. Coverage is looked up by variety
 * name, so the cosmetic variants have none — including it would make them look
 * distinct and defeat the purpose. The survivor is chosen to protect against
 * that instead: the species' default variety wins, and failing that one that
 * actually has coverage data.
 *
 * @param entries Enriched scan entries, expected to share a type grouping.
 * @returns The same entries with indistinguishable duplicates removed.
 */
export function collapseIndistinctVarieties(entries: PokemonListEntry[]): PokemonListEntry[] {
  const identityOf = (entry: PokemonListEntry) => JSON.stringify([
    entry.species_name || entry.pokemon.name,
    entry.stats ?? null,
    (entry.types || []).map((slot) => slot.type.name).sort(),
    (entry.abilities || []).map((ability) => `${ability.name}:${ability.is_hidden}`).sort()
  ]);

  // Higher wins. A default variety is the one the games treat as the Pokemon;
  // coverage data is the tiebreak that stops a cosmetic variant standing in for
  // the real entry when no variety is marked default.
  const survivorRank = (entry: PokemonListEntry) =>
    (entry.is_default_variety ? 2 : 0) + ((entry.effective_move_coverages || []).length > 0 ? 1 : 0);

  const best = new Map<string, PokemonListEntry>();
  const order: string[] = [];

  entries.forEach((entry) => {
    const identity = identityOf(entry);
    const incumbent = best.get(identity);
    if (!incumbent) {
      best.set(identity, entry);
      order.push(identity);
      return;
    }
    if (survivorRank(entry) > survivorRank(incumbent)) best.set(identity, entry);
  });

  return order.map((identity) => best.get(identity)!);
}

export interface FlattenOptions {
  baseScore?: number;
  /** Keep only one entry per species. Off by default, since browsing wants every form. */
  uniqueBySpecies?: boolean;
  /** Metagame to re-score defensive typing against. Omitted keeps the scan's own. */
  scoring?: ThreatScoring;
}

/**
 * Flattens the type-keyed scan into a list of Pokemon.
 *
 * A Pokemon can appear under more than one grouping, so entries are deduplicated
 * by variety name and the first occurrence wins. Type entries arrive ranked, so
 * that is the better-scoring grouping.
 *
 * @param types Scan results, keyed by type combination.
 * @param options Baseline score and whether to collapse forms to one per species.
 * @returns Pokemon records in encounter order.
 */
export function flattenToPokemon(
  types: Array<TeamTypeData | { name: string; pokemon?: PokemonListEntry[] }>,
  options: FlattenOptions = {}
): PokemonEntry[] {
  const { baseScore = DEFAULT_BASE_SCORE, uniqueBySpecies = false, scoring } = options;

  const seenVarieties = new Set<string>();
  const seenSpecies = new Set<string>();
  const results: PokemonEntry[] = [];

  types.forEach((typeData) => {
    // With no override, a result is read on its own terms: the scan recorded the
    // range its scores were computed to occupy, and normalizing them against the
    // unweighted constants instead would silently compress the whole defensive
    // term. An explicit `scoring` replaces both halves together.
    const resolved = scoring ?? asStoredScoring(
      (typeData as TeamTypeData).damage_from_bounds,
      (typeData as TeamTypeData).damage_to_bounds
    );

    (typeData.pokemon || []).forEach((entry) => {
      const pokemon = toPokemonEntry(entry, typeData.name, baseScore, resolved);
      if (!pokemon) return;
      if (seenVarieties.has(pokemon.name)) return;
      if (uniqueBySpecies && seenSpecies.has(pokemon.speciesName)) return;

      seenVarieties.add(pokemon.name);
      seenSpecies.add(pokemon.speciesName);
      results.push(pokemon);
    });
  });

  return results;
}

/**
 * Applies an ability choice to a Pokemon, re-deriving its defensive profile.
 *
 * The scan picks each Pokemon's best ability defensively. When the user picks a
 * different one, the weaknesses, resistances and scores all have to follow —
 * that is the whole point of ability immunities.
 *
 * @param entry Pokemon to adjust.
 * @param abilityName Ability to select. Unknown names leave the entry unchanged.
 * @param baseScore Baseline the damage scores were calculated with.
 * @param scoring Metagame to score against. Defaults to the one the Pokemon was
 *   flattened under, which is what keeps an ability swap on the same scale.
 * @returns A new entry with the chosen ability applied.
 */
export function withAbility(
  entry: PokemonEntry,
  abilityName: string | undefined | null,
  baseScore: number = DEFAULT_BASE_SCORE,
  scoring: ThreatScoring | undefined = entry.scoring
): PokemonEntry {
  if (!abilityName || abilityName === entry.abilityName) return entry;

  const profile = entry.abilityProfiles[abilityName];
  if (!profile) return entry;

  // The stat line follows the ability too. Without this, switching away from
  // Huge Power in the UI would keep the doubled Attack it granted.
  const stats = profile.stats ?? getEffectiveStats(entry.baseStats, [abilityName]);

  return {
    ...entry,
    abilityName,
    stats,
    scoring,
    baseStats: entry.baseStats,
    statAbilityName: getStatAbilityName([abilityName]),
    statsTotal: profile.stats_total ?? totalStats(stats),
    moveCoverages: profile.move_coverages ?? entry.moveCoverages,
    weaknesses: profile.weaknesses ?? entry.weaknesses,
    quadrupleWeaknesses: profile.quadruple_weaknesses ?? entry.quadrupleWeaknesses,
    resistances: profile.resistances ?? entry.resistances,
    immunities: profile.immunities ?? entry.immunities,
    coverages: profile.coverages ?? entry.coverages,
    // An ability never changes what a Pokemon deals, so this re-derives against
    // the census for the same reason `toPokemonEntry` does — a cup — and not
    // because the ability moved it.
    normalizedDamageToScore: normalizeDamageToScore(
      rescoreDamageTo(entry.types, profile.damage_to_score, baseScore, scoring),
      baseScore,
      scoring?.toBounds
    ),
    normalizedDamageFromScore: normalizeDamageFromScore(
      rescoreDamageFrom(profile.damage_relations, profile.damage_from_score, baseScore, scoring),
      baseScore,
      scoring?.bounds
    )
  };
}

/**
 * Groups Pokemon back under their type combination.
 *
 * The inverse of flattening, for views that still browse by typing.
 *
 * @param pokemon Flat Pokemon records.
 * @returns A map from type combination name to its Pokemon.
 */
export function groupByTypeName(pokemon: PokemonEntry[]): Map<string, PokemonEntry[]> {
  const grouped = new Map<string, PokemonEntry[]>();
  pokemon.forEach((entry) => {
    const existing = grouped.get(entry.typeName);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(entry.typeName, [entry]);
    }
  });
  return grouped;
}
