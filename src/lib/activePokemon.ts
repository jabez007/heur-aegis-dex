import type {
  AbilityProfile,
  DamageRelations,
  PokemonListEntry,
  ResistantTypeResult,
  TeamTypeData
} from './pokedexTypes';

export interface TypeDataLike extends TeamTypeData {
  selectedPokemon?: PokemonListEntry | null;
  selected_pokemon_index?: number;
  selected_ability_name?: string;
  include_ability_immunities?: boolean;
}

export interface ActiveTypeDataLike extends TypeDataLike {
  selected_pokemon_index: number;
  selectedPokemon: PokemonListEntry | null;
  selected_ability_name: string;
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
    pokemon.effective_resistances !== undefined;

  if (!hasEffectiveProfile) {
    return null;
  }

  return {
    damage_relations: pokemon.effective_damage_relations as DamageRelations | undefined,
    weaknesses: pokemon.effective_weaknesses || [],
    quadruple_weaknesses: pokemon.effective_quadruple_weaknesses || [],
    resistances: pokemon.effective_resistances || [],
    ineffectives: pokemon.effective_ineffectives || [],
    coverages: pokemon.effective_coverages || [],
    damage_from_score: pokemon.effective_damage_from_score,
    damage_to_score: pokemon.effective_damage_to_score
  };
}

/**
 * Resolves the active Pokemon entry for a type card using the selected slot and ability.
 *
 * @param typeData Type card data containing the available Pokemon list and fallback profile values.
 * @param pokemonIndex Index of the selected Pokemon within `typeData.pokemon`.
 * @param abilityName Optional ability override for the selected Pokemon.
 * @returns The resolved Pokemon entry with effective profile fields applied, or `null`.
 */
export function resolveSelectedPokemon(typeData: TypeDataLike, pokemonIndex: number, abilityName?: string) {
  const selectedPokemon = typeData.selectedPokemon;
  const indexedPokemon = typeData.pokemon[pokemonIndex];
  const basePokemon = selectedPokemon?.pokemon?.name === indexedPokemon?.pokemon?.name
    ? selectedPokemon
    : (indexedPokemon || selectedPokemon);

  if (!basePokemon) return null;

  const nextAbilityName = abilityName || selectedPokemon?.selected_ability_name || basePokemon.selected_ability_name || '';
  const abilityProfile = getPokemonAbilityProfile(basePokemon, nextAbilityName);

  return {
    ...basePokemon,
    selected_ability_name: nextAbilityName,
    effective_damage_relations: abilityProfile?.damage_relations || selectedPokemon?.effective_damage_relations || basePokemon.effective_damage_relations,
    effective_weaknesses: abilityProfile?.weaknesses || selectedPokemon?.effective_weaknesses || basePokemon.effective_weaknesses || typeData.weaknesses || [],
    effective_quadruple_weaknesses: abilityProfile?.quadruple_weaknesses || selectedPokemon?.effective_quadruple_weaknesses || basePokemon.effective_quadruple_weaknesses || typeData.quadruple_weaknesses || [],
    effective_resistances: abilityProfile?.resistances || selectedPokemon?.effective_resistances || basePokemon.effective_resistances || typeData.resistances || [],
    effective_ineffectives: abilityProfile?.ineffectives || selectedPokemon?.effective_ineffectives || basePokemon.effective_ineffectives || typeData.ineffectives || [],
    effective_coverages: abilityProfile?.coverages || selectedPokemon?.effective_coverages || basePokemon.effective_coverages || typeData.coverages || [],
    effective_damage_from_score: abilityProfile?.damage_from_score ?? selectedPokemon?.effective_damage_from_score ?? basePokemon.effective_damage_from_score ?? typeData.damage_from_score,
    effective_damage_to_score: abilityProfile?.damage_to_score ?? selectedPokemon?.effective_damage_to_score ?? basePokemon.effective_damage_to_score ?? typeData.damage_to_score
  };
}

/**
 * Projects a type card into its active UI state for the selected Pokemon and ability.
 *
 * @param typeData Base type card data.
 * @param pokemonIndex Index of the selected Pokemon within `typeData.pokemon`.
 * @param abilityName Optional ability override for the selected Pokemon.
 * @returns A type card snapshot with selected Pokemon state and effective profile values applied.
 */
export function buildActiveTypeData(typeData: TypeDataLike, pokemonIndex: number, abilityName?: string) {
  const activePokemon = resolveSelectedPokemon(typeData, pokemonIndex, abilityName);

  if (!activePokemon) {
    return {
      ...typeData,
      selected_pokemon_index: pokemonIndex,
      selectedPokemon: null,
      selected_ability_name: ''
    };
  }

  return {
    ...typeData,
    selected_pokemon_index: pokemonIndex,
    selectedPokemon: activePokemon,
    selected_ability_name: activePokemon.selected_ability_name,
    weaknesses: activePokemon.effective_weaknesses,
    quadruple_weaknesses: activePokemon.effective_quadruple_weaknesses,
    resistances: activePokemon.effective_resistances,
    ineffectives: activePokemon.effective_ineffectives,
    coverages: activePokemon.effective_coverages,
    damage_from_score: activePokemon.effective_damage_from_score,
    damage_to_score: activePokemon.effective_damage_to_score
  };
}

/**
 * Returns the effective defensive and offensive profile for a type card, using
 * the selected Pokemon profile when one is available.
 *
 * @param typeData Base type card data.
 * @param selectedPokemon Optional explicit selected Pokemon override.
 * @returns A profile object backed by the selected Pokemon when available, otherwise the raw type data.
 */
export function getEffectiveTypeProfile(typeData: TypeDataLike, selectedPokemon?: PokemonListEntry | null): ResistantTypeResult | TypeDataLike {
  const activePokemon = selectedPokemon || typeData.selectedPokemon;
  if (!activePokemon) return typeData;

  const abilityProfile = getPokemonAbilityProfile(activePokemon);

  return {
    ...typeData,
    weaknesses: abilityProfile?.weaknesses || typeData.weaknesses || [],
    quadruple_weaknesses: abilityProfile?.quadruple_weaknesses || typeData.quadruple_weaknesses || [],
    resistances: abilityProfile?.resistances || typeData.resistances || [],
    ineffectives: abilityProfile?.ineffectives || typeData.ineffectives || [],
    coverages: abilityProfile?.coverages || typeData.coverages || [],
    damage_from_score: abilityProfile?.damage_from_score ?? typeData.damage_from_score,
    damage_to_score: abilityProfile?.damage_to_score ?? typeData.damage_to_score
  };
}
