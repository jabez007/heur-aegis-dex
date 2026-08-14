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

/**
 * Rules for abilities that *reduce* incoming damage without zeroing it.
 *
 * These used to be flat multipliers on the bulk term in `abilityEffects.ts`, and
 * that was wrong twice over. Thick Fat's worth depends on the typing it is
 * attached to — Appletun gains six times what Azumarill does, because Water
 * already resists both Fire and Ice — but a bulk multiplier scales
 * `hpAdjustedBulk`, so the award tracked how bulky the Pokemon already was and
 * came out close to inverted. The magnitude was wrong too: the constants paid
 * about four times what the type data says the abilities are worth.
 *
 * Modelling them here instead makes the answer fall out of each Pokemon's own
 * damage relations, exactly as the immunities above already do, and no constant
 * is needed.
 */
interface DamageTakenRule {
  /** Types whose incoming damage is scaled. Omitted when `superEffectiveOnly`. */
  readonly types?: readonly string[];
  /** Applies to whatever the Pokemon happens to be weak to, whatever that is. */
  readonly superEffectiveOnly?: boolean;
  readonly multiplier: number;
  readonly reason: string;
}

const ABILITY_DAMAGE_TAKEN: Record<string, DamageTakenRule> = {
  'thick-fat': {
    types: ['fire', 'ice'],
    multiplier: 0.5,
    reason: 'Halves Fire and Ice damage.'
  },
  heatproof: {
    types: ['fire'],
    multiplier: 0.5,
    reason: 'Halves Fire damage. Also halves burn damage, which is not modelled.'
  },
  'water-bubble': {
    types: ['fire'],
    multiplier: 0.5,
    reason:
      'Halves Fire damage and blocks burn. The offensive half — doubled Water moves — stays out, because it needs '
      + 'a Water move in the set and movesets are not modelled.'
  },
  'purifying-salt': {
    types: ['ghost'],
    multiplier: 0.5,
    reason:
      'Halves Ghost damage. The status immunity is the larger half of this ability and is not a typing effect, so '
      + 'it stays recorded in abilityEffects.ts.'
  },
  'solid-rock': {
    superEffectiveOnly: true,
    multiplier: 0.75,
    reason: 'Reduces super-effective damage by a quarter, against whatever the Pokemon is weak to.'
  },
  filter: {
    superEffectiveOnly: true,
    multiplier: 0.75,
    reason: 'Identical to Solid Rock.'
  }
};

/**
 * The damage multiplier each bucket represents.
 *
 * `calculateDamageFromScore` weights these at exactly `multiplier - 1` — 4x
 * scores +3, 2x scores +1, 0.5x scores -0.5, 0.25x scores -0.75, 0x scores -1.
 * That identity is what lets a reduction be applied as arithmetic rather than as
 * a bucket shuffle, and it is why Solid Rock's 0.75x can be modelled at all: it
 * lands between buckets, and the residual below carries it exactly.
 */
const DAMAGE_FROM_BUCKETS = [
  { key: 'quadruple_damage_from', multiplier: 4 },
  { key: 'double_damage_from', multiplier: 2 },
  { key: 'half_damage_from', multiplier: 0.5 },
  { key: 'quarter_damage_from', multiplier: 0.25 },
  { key: 'no_damage_from', multiplier: 0 }
] as const;

/** Incoming damage multiplier for a type; 1 when it sits in no bucket. */
const getDamageTakenMultiplier = (dr: DamageRelations, typeName: string): number => {
  const bucket = DAMAGE_FROM_BUCKETS.find(
    (b) => (dr[b.key] || []).some((resource) => resource.name === typeName)
  );
  return bucket ? bucket.multiplier : 1;
};

/**
 * Moves a type to the bucket for `multiplier`, when one exists.
 *
 * @returns True when the multiplier landed on a real bucket. False means the
 *   value falls between buckets and the caller must carry the difference as a
 *   score residual instead.
 */
const setDamageTakenMultiplier = (dr: DamageRelations, typeName: string, multiplier: number): boolean => {
  const target = DAMAGE_FROM_BUCKETS.find((b) => b.multiplier === multiplier);
  if (!target && multiplier !== 1) return false;

  DAMAGE_FROM_BUCKETS.forEach((bucket) => {
    dr[bucket.key] = removeType(dr[bucket.key], typeName);
  });
  if (target) dr[target.key] = (dr[target.key] || []).concat({ name: typeName });
  return true;
};

/**
 * Applies a damage-reduction ability to a set of damage relations.
 *
 * @returns The residual to add to the bucket-derived score, non-zero only when a
 *   reduction lands between buckets.
 */
const applyDamageTakenRule = (dr: DamageRelations, rule: DamageTakenRule): number => {
  const affected = rule.superEffectiveOnly
    ? (dr.quadruple_damage_from || []).concat(dr.double_damage_from).map((resource) => resource.name)
    : (rule.types || []);

  let residual = 0;
  // Snapshot first: `superEffectiveOnly` reads the weakness buckets, and
  // rewriting them while iterating would drop types out from under the loop.
  [...new Set(affected)].forEach((typeName) => {
    const before = getDamageTakenMultiplier(dr, typeName);
    const after = before * rule.multiplier;
    if (!setDamageTakenMultiplier(dr, typeName, after)) {
      // Bucket unchanged; carry the exact score difference, since the bucket
      // weight is `multiplier - 1` and the constant terms cancel.
      residual += after - before;
    }
  });
  return residual;
};

/**
 * Reports whether an ability is modelled as a damage reduction here.
 *
 * @param abilityName PokeAPI ability name.
 * @returns True when the type layer already prices this ability.
 */
export const isDamageTakenAbility = (abilityName: string | undefined | null): boolean =>
  !!abilityName && abilityName in ABILITY_DAMAGE_TAKEN;

/**
 * Every ability that changes a typing's damage relations, immunity or reduction.
 *
 * Exported for `measure-damage-bounds.mjs`, which crosses these with all 171
 * type combinations to bound `damage_from_score`. The bound is only a superset
 * of what a real Pokemon reaches if this list is complete, so anything added to
 * either table above must appear here — which it does, by construction.
 */
export const TYPING_ABILITIES: readonly string[] = [
  ...Object.keys(ABILITY_IMMUNITIES),
  ...Object.keys(ABILITY_DAMAGE_TAKEN)
];

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

  // Reductions run under the same flag as immunities: both are ability effects
  // on the typing, and the raw profile exists to show the typing without them.
  const reduction = respectImmunities ? ABILITY_DAMAGE_TAKEN[abilityName] : undefined;
  const residual = reduction ? applyDamageTakenRule(nextDamageRelations, reduction) : 0;

  nextDamageRelations.damage_from_score = calculateDamageFromScore(nextDamageRelations, baseScore) + residual;
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

  const bestProfile = abilityProfiles.reduce<ReturnType<typeof createAbilityProfile> | null>((best, profile) => {
    if (!best) return profile;
    return pickBetterDamageRelations(best.damage_relations, profile.damage_relations) === profile.damage_relations ? profile : best;
  }, null);

  return {
    abilityProfiles,
    bestProfile: bestProfile || createAbilityProfile(dr, '', baseScore)
  };
};
