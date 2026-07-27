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
  stats?: PokemonStats;
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

