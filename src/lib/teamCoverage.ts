/**
 * Shared team coverage analysis.
 *
 * "Covered" means two different things in team building and conflating them
 * produces contradictory advice:
 *
 * - A *defensive* answer means somebody on the team resists the attacking type
 *   and can absorb the hit.
 * - An *offensive* answer means somebody hits that type super-effectively and
 *   can threaten whatever is exploiting the weakness.
 *
 * Hitting Fire super-effectively does not stop a Fire move from knocking you
 * out, so the two are tracked separately here and each consumer picks the one
 * it actually means.
 *
 * ## Not every type is worth the same, and this used to say they were
 *
 * The structural half of this module — who resists what, which weaknesses go
 * unanswered — is metagame-independent and stays that way. What was wrong was
 * the *pricing* built on top of it: every list here was consumed as a count, so
 * resisting Normal earned what resisting Fighting earned.
 *
 * That was the largest remaining instance of the error `typeThreat.ts` and
 * `defenderCensus.ts` each fixed one level down, and it was the expensive one.
 * Synergy is **68% of a roster's realized score in doubles** and 66% in singles,
 * so two thirds of the model was still counting type names while the third that
 * was already the most careful got two rounds of correction. Measured on the
 * best M-B bring line, its fourteen resistances were counted as 14.00 units and
 * are worth **8.03** once threat-weighted — Fighting is 3.76 times Normal and
 * both were paid a unit.
 *
 * ## Mean one, not maximum one
 *
 * `TypeThreatWeights` peaks at 1 so a weakness cannot cost more than a bucket.
 * The values here are normalized to a **mean** of 1 across the types in play
 * instead, which is what lets every denominator in `evaluateTeamSynergy` stay
 * exactly as it was: the eighteen values still sum to eighteen, so a team
 * resisting everything still scores exactly 1 and the terms keep the ranges
 * `COMPOSITE_BOUNDS` was measured against. Only the *distribution* moves. A
 * Fighting weakness now costs 1.69 of a typical one and a Normal weakness 0.45.
 *
 * ## Two measures, because there are two directions
 *
 * Incoming attacks — weaknesses, resistances — are priced by `threat`, which is
 * what the pool can bring. Outgoing ones — coverage, spread safety — are priced
 * by `presence`, which is what the pool *is*. That asymmetry is argued at length
 * in `typeThreat.ts` and `defenderCensus.ts`; this module just applies it.
 *
 * `typeDiversity` is deliberately left unweighted. It measures how spread out a
 * roster is across the chart, which is a property of the roster and not of the
 * format it is registered into.
 */

/**
 * What each type is worth in a particular metagame, mean-normalized to 1.
 *
 * Absent everywhere it is optional, and absent means "count them all the same",
 * which is what this module did before and what a caller with no pool to measure
 * still gets.
 */
export interface TypeMatchupValues {
  /** Attacking types, by how much of the pool can bring them. */
  readonly threat: Readonly<Record<string, number>>;
  /** Defending types, by how much of the pool carries them. */
  readonly presence: Readonly<Record<string, number>>;
}

/** Weighted numerators, one per synergy term whose numerator is type-based. */
export interface WeightedCoverageTotals {
  readonly coverageBreadth: number;
  readonly resistanceBreadth: number;
  readonly uncoveredWeakness: number;
  readonly uncoveredQuadrupleWeakness: number;
  readonly sharedWeakness: number;
  readonly quadrupleWeakness: number;
  readonly sharedQuadrupleWeakness: number;
  readonly enabledSpread: number;
  readonly spreadConflict: number;
}

export interface TeamCoverageProfile {
  /**
   * The member's own elemental types, which stand in for the types it attacks
   * with. Spread-move safety keys on these rather than on `coverages`: what
   * hurts your partner is the *type of the move you click*, not the list of
   * types you happen to hit super-effectively.
   */
  types?: string[];
  weaknesses?: string[];
  quadruple_weaknesses?: string[];
  resistances?: string[];
  /** Strict 0x subset of `resistances`. */
  immunities?: string[];
  coverages?: string[];
  /**
   * Types reachable super-effectively through any learnable move. Wider than
   * `coverages`, which is STAB only. Used for "does the team have an answer",
   * where reaching a type is exactly the question; `coverages` remains the
   * measure of how hard the team threatens it.
   */
  moveCoverages?: string[];
  /**
   * The member takes no damage from its ally's moves whatever their type, as
   * Telepathy grants. Kept as a damage fact rather than an ability name so this
   * module stays free of ability knowledge.
   */
  immuneToAllyMoves?: boolean;
}

export interface TeamCoverageAnalysis {
  weaknessCounts: Record<string, number>;
  quadrupleWeaknessCounts: Record<string, number>;
  resistanceCounts: Record<string, number>;
  coverageCounts: Record<string, number>;
  /** Tally of types reachable through learnable moves. */
  moveCoverageCounts: Record<string, number>;
  /** Weaknesses no member resists. These are the types that actually threaten the team. */
  defensivelyUncoveredWeaknesses: string[];
  /** Weaknesses no member resists and no member answers offensively. */
  uncoveredWeaknesses: string[];
  /** 4x weaknesses with neither a defensive nor an offensive answer. */
  uncoveredQuadrupleWeaknesses: string[];
  /** Weaknesses carried by more than one member. */
  sharedWeaknesses: string[];
  /** 4x weaknesses carried by more than one member. */
  sharedQuadrupleWeaknesses: string[];
  uniqueResistances: number;
  uniqueCoverages: number;
  /**
   * Attacking types for which some teammate is immune, so a spread move of that
   * type can be clicked freely alongside that partner. This is the positive
   * synergy singles has no concept of: a Ground-immune partner is what makes
   * Earthquake usable rather than merely survivable.
   */
  enabledSpreadTypes: string[];
  /**
   * Attacking types for which *every* teammate is weak, leaving no safe partner
   * to pair with. Doubles puts one ally on the field at a time, so a type is
   * only a real problem when there is no viable pairing at all.
   */
  spreadConflicts: string[];
  /**
   * The same tallies priced by what each type is worth in this metagame, for
   * the terms that have a metagame reading. Absent when no values were given,
   * in which case every consumer falls back to the counts beside them.
   */
  weighted?: WeightedCoverageTotals;
}

/**
 * Works out which attacking types are safe to use as spread moves.
 *
 * @param members Effective profiles for each team member.
 * @returns The enabled and conflicting attacking types.
 */
function analyzeSpreadSafety(members: TeamCoverageProfile[]) {
  // With no partner there is nothing to hit by accident, so neither list means
  // anything. Returning empty avoids handing a solo team a free bonus from the
  // vacuous truth that "every partner is immune".
  if (members.length < 2) {
    return { enabledSpreadTypes: [], spreadConflicts: [] };
  }

  const enabled = new Set<string>();
  const conflicting = new Set<string>();

  members.forEach((member, index) => {
    const partners = members.filter((_, partnerIndex) => partnerIndex !== index);

    // A partner immune to ally damage outright is safe against every spread
    // type, not just the ones its typing resists.
    const isSafePartner = (partner: TeamCoverageProfile, attackingType: string) =>
      partner.immuneToAllyMoves === true || (partner.immunities || []).includes(attackingType);

    (member.types || []).forEach((attackingType) => {
      if (partners.some((partner) => isSafePartner(partner, attackingType))) {
        enabled.add(attackingType);
      }
      if (partners.every((partner) =>
        partner.immuneToAllyMoves !== true && (partner.weaknesses || []).includes(attackingType)
      )) {
        conflicting.add(attackingType);
      }
    });
  });

  return {
    enabledSpreadTypes: [...enabled],
    spreadConflicts: [...conflicting]
  };
}

const countOccurrences = (
  members: TeamCoverageProfile[],
  select: (member: TeamCoverageProfile) => string[] | undefined
): Record<string, number> =>
  members.reduce((counts: Record<string, number>, member) => {
    (select(member) || []).forEach((typeName) => {
      counts[typeName] = (counts[typeName] || 0) + 1;
    });
    return counts;
  }, {});

const namesWhere = (
  counts: Record<string, number>,
  predicate: (typeName: string, count: number) => boolean
): string[] =>
  Object.entries(counts)
    .filter(([typeName, count]) => predicate(typeName, count))
    .map(([typeName]) => typeName);

/** Sums a per-type value over a list of type names, defaulting an absent type to 1. */
const sumValue = (
  types: readonly string[],
  values: Readonly<Record<string, number>>,
  countFor: (typeName: string) => number = () => 1
): number => types.reduce((total, typeName) => total + (countFor(typeName) * (values[typeName] ?? 1)), 0);

/**
 * Analyses how a set of team member profiles cover each other.
 *
 * @param members Effective profiles for each team member.
 * @param values What each type is worth in the metagame being prepared against.
 *   Omit to weight every type equally, which is what a caller without a pool
 *   gets and what this returned before the values existed.
 * @returns Weakness, resistance and coverage tallies plus the derived gap lists.
 */
export function analyzeTeamCoverage(
  members: TeamCoverageProfile[],
  values?: TypeMatchupValues
): TeamCoverageAnalysis {
  const weaknessCounts = countOccurrences(members, (member) => member.weaknesses);
  const quadrupleWeaknessCounts = countOccurrences(members, (member) => member.quadruple_weaknesses);
  const resistanceCounts = countOccurrences(members, (member) => [
    ...new Set([...(member.resistances || []), ...(member.immunities || [])])
  ]);
  const coverageCounts = countOccurrences(members, (member) => member.coverages);
  const moveCoverageCounts = countOccurrences(members, (member) => member.moveCoverages);

  const hasDefensiveAnswer = (typeName: string) => !!resistanceCounts[typeName];
  // An offensive answer only needs a move that reaches the type. STAB coverage
  // counts too, since a member always has its own types available.
  const hasOffensiveAnswer = (typeName: string) =>
    !!coverageCounts[typeName] || !!moveCoverageCounts[typeName];
  const hasAnyAnswer = (typeName: string) => hasDefensiveAnswer(typeName) || hasOffensiveAnswer(typeName);

  // Most threatening first when there is a metagame to say what that means, so
  // the guided builder and the workbench name the weakness worth fixing before
  // the one that merely exists. Insertion order otherwise, unchanged.
  const byThreat = (types: string[]): string[] => values
    ? [...types].sort((left, right) =>
      (values.threat[right] ?? 1) - (values.threat[left] ?? 1) || left.localeCompare(right))
    : types;

  const spread = analyzeSpreadSafety(members);
  const defensivelyUncoveredWeaknesses = byThreat(
    namesWhere(weaknessCounts, (typeName) => !hasDefensiveAnswer(typeName)));
  const uncoveredWeaknesses = byThreat(
    namesWhere(weaknessCounts, (typeName) => !hasAnyAnswer(typeName)));
  const uncoveredQuadrupleWeaknesses = byThreat(
    namesWhere(quadrupleWeaknessCounts, (typeName) => !hasAnyAnswer(typeName)));
  const sharedWeaknesses = byThreat(namesWhere(weaknessCounts, (_typeName, count) => count > 1));
  const sharedQuadrupleWeaknesses = byThreat(
    namesWhere(quadrupleWeaknessCounts, (_typeName, count) => count > 1));

  return {
    weaknessCounts,
    quadrupleWeaknessCounts,
    resistanceCounts,
    coverageCounts,
    moveCoverageCounts,
    defensivelyUncoveredWeaknesses,
    uncoveredWeaknesses,
    uncoveredQuadrupleWeaknesses,
    sharedWeaknesses,
    sharedQuadrupleWeaknesses,
    uniqueResistances: Object.keys(resistanceCounts).length,
    uniqueCoverages: Object.keys(coverageCounts).length,
    ...spread,
    // One entry per synergy term whose numerator counts types. Each mirrors the
    // unweighted expression `evaluateTeamSynergy` uses beside it, so the two can
    // be read against each other; the denominators stay there and stay as they
    // were, which the mean-1 normalization is what makes safe.
    weighted: values && {
      coverageBreadth: sumValue(Object.keys(coverageCounts), values.presence),
      resistanceBreadth: sumValue(Object.keys(resistanceCounts), values.threat),
      uncoveredWeakness: sumValue(uncoveredWeaknesses, values.threat),
      uncoveredQuadrupleWeakness: sumValue(uncoveredQuadrupleWeaknesses, values.threat),
      sharedWeakness: sumValue(sharedWeaknesses, values.threat, (t) => weaknessCounts[t] - 1),
      quadrupleWeakness: sumValue(
        Object.keys(quadrupleWeaknessCounts), values.threat, (t) => quadrupleWeaknessCounts[t]),
      sharedQuadrupleWeakness: sumValue(
        sharedQuadrupleWeaknesses, values.threat, (t) => quadrupleWeaknessCounts[t] - 1),
      enabledSpread: sumValue(spread.enabledSpreadTypes, values.presence),
      spreadConflict: sumValue(spread.spreadConflicts, values.presence)
    } || undefined
  };
}
