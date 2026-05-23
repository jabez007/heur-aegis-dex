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
  pokemon?: any[];
  weaknesses?: string[];
  quadruple_weaknesses?: string[];
  resistances?: string[];
  ineffectives?: string[];
  coverages?: string[];
  damage_from_score?: number;
  damage_to_score?: number;
}
