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
 */

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
}

export interface TeamCoverageAnalysis {
  weaknessCounts: Record<string, number>;
  quadrupleWeaknessCounts: Record<string, number>;
  resistanceCounts: Record<string, number>;
  coverageCounts: Record<string, number>;
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

    (member.types || []).forEach((attackingType) => {
      if (partners.some((partner) => (partner.immunities || []).includes(attackingType))) {
        enabled.add(attackingType);
      }
      if (partners.every((partner) => (partner.weaknesses || []).includes(attackingType))) {
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

/**
 * Analyses how a set of team member profiles cover each other.
 *
 * @param members Effective profiles for each team member.
 * @returns Weakness, resistance and coverage tallies plus the derived gap lists.
 */
export function analyzeTeamCoverage(members: TeamCoverageProfile[]): TeamCoverageAnalysis {
  const weaknessCounts = countOccurrences(members, (member) => member.weaknesses);
  const quadrupleWeaknessCounts = countOccurrences(members, (member) => member.quadruple_weaknesses);
  const resistanceCounts = countOccurrences(members, (member) => member.resistances);
  const coverageCounts = countOccurrences(members, (member) => member.coverages);

  const hasDefensiveAnswer = (typeName: string) => !!resistanceCounts[typeName];
  const hasAnyAnswer = (typeName: string) => hasDefensiveAnswer(typeName) || !!coverageCounts[typeName];

  return {
    weaknessCounts,
    quadrupleWeaknessCounts,
    resistanceCounts,
    coverageCounts,
    defensivelyUncoveredWeaknesses: namesWhere(weaknessCounts, (typeName) => !hasDefensiveAnswer(typeName)),
    uncoveredWeaknesses: namesWhere(weaknessCounts, (typeName) => !hasAnyAnswer(typeName)),
    uncoveredQuadrupleWeaknesses: namesWhere(quadrupleWeaknessCounts, (typeName) => !hasAnyAnswer(typeName)),
    sharedWeaknesses: namesWhere(weaknessCounts, (_typeName, count) => count > 1),
    sharedQuadrupleWeaknesses: namesWhere(quadrupleWeaknessCounts, (_typeName, count) => count > 1),
    uniqueResistances: Object.keys(resistanceCounts).length,
    uniqueCoverages: Object.keys(coverageCounts).length,
    ...analyzeSpreadSafety(members)
  };
}
