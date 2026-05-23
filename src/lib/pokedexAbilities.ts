import type { DamageRelations, NamedResource } from './pokedexTypes';
import {
  calculateDamageFromScore,
  calculateDamageToScore,
  cloneDamageRelations,
  createTypeSummary
} from './pokedexScoring';

const ABILITY_IMMUNITIES: Record<string, string> = {
  'dry-skin': 'water',
  'earth-eater': 'ground',
  'flash-fire': 'fire',
  'levitate': 'ground',
  'lightning-rod': 'electric',
  'motor-drive': 'electric',
  'sap-sipper': 'grass',
  'storm-drain': 'water',
  'volt-absorb': 'electric',
  'water-absorb': 'water',
  'well-baked-body': 'fire'
};

const removeType = (arr: NamedResource[] | undefined, typeName: string): NamedResource[] =>
  (arr || []).filter(resource => resource.name !== typeName);

const pickBetterDamageRelations = (current: DamageRelations | null, candidate: DamageRelations): DamageRelations => {
  if (!current) return candidate;

  const currentScore = current.damage_from_score ?? Number.POSITIVE_INFINITY;
  const candidateScore = candidate.damage_from_score ?? Number.POSITIVE_INFINITY;

  if (candidateScore !== currentScore) {
    return candidateScore < currentScore ? candidate : current;
  }

  const currentWeaknesses = ((current.quadruple_damage_from || []).length * 2) + current.double_damage_from.length;
  const candidateWeaknesses = ((candidate.quadruple_damage_from || []).length * 2) + candidate.double_damage_from.length;
  if (candidateWeaknesses !== currentWeaknesses) {
    return candidateWeaknesses < currentWeaknesses ? candidate : current;
  }

  const currentResistances = current.no_damage_from.length + (current.quarter_damage_from || []).length + current.half_damage_from.length;
  const candidateResistances = candidate.no_damage_from.length + (candidate.quarter_damage_from || []).length + candidate.half_damage_from.length;
  return candidateResistances > currentResistances ? candidate : current;
};

const buildDamageRelations = (
  dr: DamageRelations,
  abilityName: string,
  baseScore: number,
  respectImmunities: boolean
): DamageRelations => {
  const immunityType = respectImmunities ? ABILITY_IMMUNITIES[abilityName] : undefined;
  const nextDamageRelations = cloneDamageRelations(dr);

  if (immunityType) {
    nextDamageRelations.double_damage_from = removeType(nextDamageRelations.double_damage_from, immunityType);
    nextDamageRelations.quadruple_damage_from = removeType(nextDamageRelations.quadruple_damage_from, immunityType);
    nextDamageRelations.half_damage_from = removeType(nextDamageRelations.half_damage_from, immunityType);
    nextDamageRelations.quarter_damage_from = removeType(nextDamageRelations.quarter_damage_from, immunityType);

    if (!nextDamageRelations.no_damage_from.some(resource => resource.name === immunityType)) {
      nextDamageRelations.no_damage_from = nextDamageRelations.no_damage_from.concat({ name: immunityType });
    }
  }

  nextDamageRelations.damage_from_score = calculateDamageFromScore(nextDamageRelations, baseScore);
  nextDamageRelations.damage_to_score = calculateDamageToScore(nextDamageRelations, baseScore);
  return nextDamageRelations;
};

export const createAbilityProfile = (dr: DamageRelations, abilityName: string, baseScore: number) => {
  const damageRelations = buildDamageRelations(dr, abilityName, baseScore, true);
  return {
    ability_name: abilityName,
    damage_relations: damageRelations,
    ...createTypeSummary(damageRelations)
  };
};

export const createRawAbilityProfile = (dr: DamageRelations, abilityName: string, baseScore: number) => {
  const damageRelations = buildDamageRelations(dr, abilityName, baseScore, false);
  return {
    ability_name: abilityName,
    damage_relations: damageRelations,
    ...createTypeSummary(damageRelations)
  };
};

export const applyAbilityModifiers = (dr: DamageRelations, abilityNames: string[], baseScore: number) => {
  const candidateAbilities = abilityNames.length > 0 ? abilityNames : [''];
  const abilityProfiles = candidateAbilities.map((abilityName) => createAbilityProfile(dr, abilityName, baseScore));

  const bestProfile = abilityProfiles.reduce((best: any, profile: any) => {
    if (!best) return profile;
    return pickBetterDamageRelations(best.damage_relations, profile.damage_relations) === profile.damage_relations ? profile : best;
  }, null);

  return {
    abilityProfiles,
    bestProfile: bestProfile || createAbilityProfile(dr, '', baseScore)
  };
};
