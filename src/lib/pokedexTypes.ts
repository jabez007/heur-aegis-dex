export interface NamedResource {
  name: string;
  url?: string;
}

export interface DamageRelations {
  double_damage_from: NamedResource[];
  half_damage_from: NamedResource[];
  no_damage_from: NamedResource[];
  double_damage_to: NamedResource[];
  half_damage_to: NamedResource[];
  no_damage_to: NamedResource[];
  quadruple_damage_from?: NamedResource[];
  quarter_damage_from?: NamedResource[];
  damage_from_score?: number;
  damage_to_score?: number;
}

export interface PokemonTypeData {
  id?: number;
  name: string;
  damage_relations: DamageRelations;
  pokemon?: PokemonListEntry[];
  weaknesses?: string[];
  quadruple_weaknesses?: string[];
  resistances?: string[];
  /** Types dealing 0x damage. A strict subset of `resistances`. */
  immunities?: string[];
  ineffectives?: string[];
  coverages?: string[];
  damage_from_score?: number;
  damage_to_score?: number;
}

export interface TeamTypeData {
  name: string;
  weaknesses: string[];
  quadruple_weaknesses?: string[];
  resistances: string[];
  /** Types dealing 0x damage. A strict subset of `resistances`. */
  immunities?: string[];
  /** Types reachable super-effectively via any learnable move. */
  move_coverages?: string[];
  ineffectives: string[];
  coverages: string[];
  damage_from_score?: number;
  damage_to_score?: number;
  pokemon: PokemonListEntry[];
}

export interface PokemonRef {
  name: string;
  url?: string;
}

export interface PokemonTypeSlot {
  type: NamedResource;
}

export interface PokemonAbilitySlot {
  name: string;
  is_hidden: boolean;
}

export interface PokemonStats {
  hp: number;
  attack: number;
  defense: number;
  'special-attack': number;
  'special-defense': number;
  speed: number;
  [key: string]: number;
}

export interface AbilityProfile {
  ability_name?: string;
  damage_relations?: DamageRelations;
  weaknesses?: string[];
  quadruple_weaknesses?: string[];
  resistances?: string[];
  immunities?: string[];
  ineffectives?: string[];
  coverages?: string[];
  damage_from_score?: number;
  damage_to_score?: number;
  /**
   * Stats with this ability's own multiplier applied. Huge Power and its kin
   * change the stat line, so each ability carries the numbers it fights with.
   */
  stats?: PokemonStats;
  stats_total?: number;
  /** Move coverage resolved against this ability's stat line. */
  move_coverages?: string[];
}

export interface PokemonListEntry {
  pokemon: PokemonRef;
  /** PokeAPI species name. Regional forms and Megas share their base species. */
  species_name?: string;
  types?: PokemonTypeSlot[];
  sprite?: string | null;
  abilities?: PokemonAbilitySlot[];
  /**
   * Battle-only form these stats describe, when the Pokemon registers as one
   * form and fights as another. Absent when the registered form is the one
   * being rated, which is the overwhelmingly common case.
   */
  battle_form_name?: string;
  /**
   * Stats the Pokemon fights with under its selected ability. Scoring uses this
   * line; eligibility passes when at least one individual ability profile clears
   * the scan's stat floors.
   */
  stats?: PokemonStats;
  /** The published line, before abilities. Kept so a UI can show both. */
  base_stats?: PokemonStats;
  /** Ability responsible for the difference, when there is one. */
  stat_ability_name?: string;
  /** Whether this is the species' default variety, used to pick a survivor when varieties collapse. */
  is_default_variety?: boolean;
  stats_total?: number;
  selected_ability_name?: string;
  ability_profiles?: Record<string, AbilityProfile>;
  effective_damage_relations?: DamageRelations;
  effective_weaknesses?: string[];
  effective_quadruple_weaknesses?: string[];
  effective_resistances?: string[];
  effective_immunities?: string[];
  /** Types reachable super-effectively via any learnable move, not just STAB. */
  effective_move_coverages?: string[];
  effective_ineffectives?: string[];
  effective_coverages?: string[];
  effective_damage_from_score?: number;
  effective_damage_to_score?: number;
}

export interface ResistantTypeResult extends TeamTypeData {
  include_ability_immunities: boolean;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasStringArrays = (value: UnknownRecord, fields: string[]): boolean =>
  fields.every((field) =>
    Array.isArray(value[field]) && value[field].every((entry: unknown) => typeof entry === 'string')
  );

const isPokemonStats = (value: unknown): value is PokemonStats => {
  if (!isRecord(value)) return false;
  return ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed']
    .every((field) => typeof value[field] === 'number' && Number.isFinite(value[field]));
};

const isCachedAbilityProfile = (value: unknown): boolean =>
  isRecord(value) &&
  isPokemonStats(value.stats) &&
  hasStringArrays(value, [
    'weaknesses', 'quadruple_weaknesses', 'resistances', 'immunities',
    'ineffectives', 'coverages', 'move_coverages'
  ]);

const isCachedPokemon = (value: unknown): boolean => {
  if (!isRecord(value) || !isRecord(value.pokemon) || typeof value.pokemon.name !== 'string') return false;
  if (!isPokemonStats(value.stats) || !isPokemonStats(value.base_stats)) return false;
  if (!Array.isArray(value.types) || !value.types.every((slot) =>
    isRecord(slot) && isRecord(slot.type) && typeof slot.type.name === 'string'
  )) return false;
  if (!Array.isArray(value.abilities) || !value.abilities.every((ability) =>
    isRecord(ability) && typeof ability.name === 'string' && typeof ability.is_hidden === 'boolean'
  )) return false;
  if (!isRecord(value.ability_profiles) || !Object.values(value.ability_profiles).every(isCachedAbilityProfile)) {
    return false;
  }
  return hasStringArrays(value, [
    'effective_weaknesses', 'effective_quadruple_weaknesses',
    'effective_resistances', 'effective_immunities', 'effective_move_coverages',
    'effective_ineffectives', 'effective_coverages'
  ]);
};

/**
 * Validates data read from the browser scan cache before UI code consumes it.
 * The check is intentionally strict: stale cache shapes should trigger a fresh
 * scan rather than being repaired or partially displayed.
 */
export function isResistantTypeResultList(value: unknown): value is ResistantTypeResult[] {
  return Array.isArray(value) && value.every((entry) =>
    isRecord(entry) &&
    typeof entry.name === 'string' &&
    typeof entry.include_ability_immunities === 'boolean' &&
    hasStringArrays(entry, [
      'weaknesses', 'quadruple_weaknesses', 'resistances', 'immunities',
      'ineffectives', 'coverages'
    ]) &&
    Array.isArray(entry.pokemon) && entry.pokemon.every(isCachedPokemon)
  );
}
