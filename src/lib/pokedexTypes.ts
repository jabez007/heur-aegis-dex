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
  ineffectives?: string[];
  coverages?: string[];
  damage_from_score?: number;
  damage_to_score?: number;
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
  ineffectives?: string[];
  coverages?: string[];
  damage_from_score?: number;
  damage_to_score?: number;
}

export interface PokemonListEntry {
  pokemon: PokemonRef;
  types?: PokemonTypeSlot[];
  sprite?: string | null;
  abilities?: PokemonAbilitySlot[];
  stats?: PokemonStats;
  stats_total?: number;
  selected_ability_name?: string;
  ability_profiles?: Record<string, AbilityProfile>;
  effective_damage_relations?: DamageRelations;
  effective_weaknesses?: string[];
  effective_quadruple_weaknesses?: string[];
  effective_resistances?: string[];
  effective_ineffectives?: string[];
  effective_coverages?: string[];
  effective_damage_from_score?: number;
  effective_damage_to_score?: number;
}

export interface ResistantTypeResult {
  name: string;
  include_ability_immunities: boolean;
  weaknesses: string[];
  quadruple_weaknesses: string[];
  resistances: string[];
  ineffectives: string[];
  coverages: string[];
  damage_from_score?: number;
  damage_to_score?: number;
  pokemon: PokemonListEntry[];
}

export interface TeamMemberResult {
  types: string[];
  name: string;
  sprite?: string | null;
  stats: PokemonStats;
  selected_ability_name?: string;
  effective_weaknesses: string[];
  effective_quadruple_weaknesses: string[];
  effective_resistances: string[];
  effective_ineffectives: string[];
  effective_coverages: string[];
  normalized_damage_to_score: number;
  normalized_damage_from_score: number;
}

export interface GeneratedTeamResult {
  types: string[];
  typesTotal: number;
  pokemon: TeamMemberResult[];
  uncoveredWeaknesses: string[];
  uncoveredQuadrupleWeaknesses: string[];
  sharedWeaknesses: string[];
  sharedQuadrupleWeaknesses: string[];
  uniqueResistances: number;
  uniqueCoverages: number;
  score: number;
}

export interface GenerateTeamsOptions {
  allowedTypes?: Array<PokemonTypeData | ResistantTypeResult>;
  teamSize?: number;
  teamComposition?: {
    allowSharedTypes?: boolean;
    allowSharedWeaknesses?: boolean;
    coverWeaknesses?: boolean;
  };
  seed?: Array<PokemonTypeData | ResistantTypeResult>;
}
