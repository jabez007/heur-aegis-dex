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

import { DEFAULT_BASE_SCORE, normalizeDamageFromScore, normalizeDamageToScore } from './pokedexScoring';
import type {
  AbilityProfile,
  DamageRelations,
  PokemonAbilitySlot,
  PokemonListEntry,
  PokemonStats,
  TeamTypeData
} from './pokedexTypes';

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
  stats: PokemonStats;
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
 * @param entry Pokemon as the scan stored it, nested under a type.
 * @param typeName The type combination it was found under.
 * @param baseScore Baseline the damage scores were calculated with.
 * @returns A flat Pokemon record, or null when the entry lacks usable data.
 */
export function toPokemonEntry(
  entry: PokemonListEntry,
  typeName: string,
  baseScore: number = DEFAULT_BASE_SCORE
): PokemonEntry | null {
  if (!entry?.pokemon?.name || !entry.stats) return null;

  const profile = getPokemonAbilityProfile(entry);
  const statsTotal = entry.stats_total
    ?? Object.values(entry.stats).reduce((total, stat) => total + Number(stat || 0), 0);

  return {
    name: entry.pokemon.name,
    speciesName: entry.species_name || entry.pokemon.name,
    typeName,
    // Prefer the Pokemon's own types; fall back to splitting the grouping name
    // for entries the scan never enriched.
    types: entry.types?.map((slot) => slot.type.name) ?? typeName.split('/'),
    sprite: entry.sprite || '',
    battleFormName: entry.battle_form_name,
    stats: entry.stats ?? EMPTY_STATS,
    statsTotal,
    abilities: entry.abilities ?? [],
    abilityName: entry.selected_ability_name || '',
    abilityProfiles: entry.ability_profiles ?? {},
    weaknesses: profile?.weaknesses ?? entry.effective_weaknesses ?? [],
    quadrupleWeaknesses: profile?.quadruple_weaknesses ?? entry.effective_quadruple_weaknesses ?? [],
    resistances: profile?.resistances ?? entry.effective_resistances ?? [],
    immunities: profile?.immunities ?? entry.effective_immunities ?? [],
    coverages: profile?.coverages ?? entry.effective_coverages ?? [],
    moveCoverages: entry.effective_move_coverages ?? [],
    normalizedDamageToScore: normalizeDamageToScore(
      profile?.damage_to_score ?? entry.effective_damage_to_score, baseScore
    ),
    normalizedDamageFromScore: normalizeDamageFromScore(
      profile?.damage_from_score ?? entry.effective_damage_from_score, baseScore
    )
  };
}

export interface FlattenOptions {
  baseScore?: number;
  /** Keep only one entry per species. Off by default, since browsing wants every form. */
  uniqueBySpecies?: boolean;
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
  const { baseScore = DEFAULT_BASE_SCORE, uniqueBySpecies = false } = options;

  const seenVarieties = new Set<string>();
  const seenSpecies = new Set<string>();
  const results: PokemonEntry[] = [];

  types.forEach((typeData) => {
    (typeData.pokemon || []).forEach((entry) => {
      const pokemon = toPokemonEntry(entry, typeData.name, baseScore);
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
 * @returns A new entry with the chosen ability applied.
 */
export function withAbility(
  entry: PokemonEntry,
  abilityName: string | undefined | null,
  baseScore: number = DEFAULT_BASE_SCORE
): PokemonEntry {
  if (!abilityName || abilityName === entry.abilityName) return entry;

  const profile = entry.abilityProfiles[abilityName];
  if (!profile) return entry;

  return {
    ...entry,
    abilityName,
    weaknesses: profile.weaknesses ?? entry.weaknesses,
    quadrupleWeaknesses: profile.quadruple_weaknesses ?? entry.quadrupleWeaknesses,
    resistances: profile.resistances ?? entry.resistances,
    immunities: profile.immunities ?? entry.immunities,
    coverages: profile.coverages ?? entry.coverages,
    normalizedDamageToScore: normalizeDamageToScore(profile.damage_to_score, baseScore),
    normalizedDamageFromScore: normalizeDamageFromScore(profile.damage_from_score, baseScore)
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
