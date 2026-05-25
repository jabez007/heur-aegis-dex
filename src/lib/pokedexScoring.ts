import type { DamageRelations, NamedResource } from './pokedexTypes';

export const calculateDamageFromScore = (dr: DamageRelations, baseScore: number): number => {
  let score = baseScore;
  if (dr.quadruple_damage_from) score += (3 * dr.quadruple_damage_from.length);
  score += dr.double_damage_from.length;
  score -= (0.5 * dr.half_damage_from.length);
  if (dr.quarter_damage_from) score -= (0.75 * dr.quarter_damage_from.length);
  score -= dr.no_damage_from.length;
  return score;
};

export const calculateDamageToScore = (dr: DamageRelations, baseScore: number): number => {
  return baseScore
    + dr.double_damage_to.length
    - (0.5 * dr.half_damage_to.length)
    - dr.no_damage_to.length;
};

export const filterUniqueBy = (arr: NamedResource[]): NamedResource[] => {
  return arr.filter(function(this: Set<string>, { name }: NamedResource) {
    return !this.has(name) && this.add(name);
  }, new Set<string>());
};

export const cloneDamageRelations = (dr: DamageRelations): DamageRelations => ({
  double_damage_from: [...dr.double_damage_from],
  half_damage_from: [...dr.half_damage_from],
  no_damage_from: [...dr.no_damage_from],
  double_damage_to: [...dr.double_damage_to],
  half_damage_to: [...dr.half_damage_to],
  no_damage_to: [...dr.no_damage_to],
  quadruple_damage_from: [...(dr.quadruple_damage_from || [])],
  quarter_damage_from: [...(dr.quarter_damage_from || [])],
  damage_from_score: dr.damage_from_score,
  damage_to_score: dr.damage_to_score
});

export const createTypeSummary = (dr: DamageRelations) => ({
  weaknesses: ((dr.quadruple_damage_from || []).concat(dr.double_damage_from)).map(w => w.name),
  quadruple_weaknesses: (dr.quadruple_damage_from || []).map(w => w.name),
  resistances: dr.no_damage_from
    .concat(dr.quarter_damage_from || [])
    .concat(dr.half_damage_from)
    .map(r => r.name),
  ineffectives: dr.no_damage_to
    .concat(dr.half_damage_to)
    .map(i => i.name),
  coverages: dr.double_damage_to.map(c => c.name),
  damage_from_score: dr.damage_from_score,
  damage_to_score: dr.damage_to_score
});
