/**
 * Team scoring model.
 *
 * Every weight below is a calibration knob, not a derived constant. They are
 * gathered here so the balance between "these are strong Pokemon" and "these
 * Pokemon work together" is a deliberate choice that can be inspected, tested
 * and tuned, rather than an accident of two expressions on unrelated scales.
 *
 * The previous model summed raw base stats (hundreds) against synergy bonuses
 * (tens), so ranking among teams that passed the filters was mostly base stat
 * total. Both halves are now normalized to 0..1 before being combined, and the
 * final score is a 0..100 figure read as "percent of an ideal team".
 */

import type { PokemonStats } from './pokedexTypes';
import type { TeamCoverageAnalysis } from './teamCoverage';
import { getApplicableRoles, type TeamRoleAnalysis } from './abilityRoles';
import { BATTLE_FORMATS, DEFAULT_BATTLE_FORMAT, type BattleFormat } from './battleFormats';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Practical ceilings used to normalize base stats.
 *
 * These are competitive ceilings rather than the theoretical 255 per stat.
 * Normalizing against the theoretical maximum would compress every realistic
 * Pokemon into a narrow band and cost the model most of its discrimination.
 * Values above a ceiling clamp to 1.
 */
export const STAT_CEILINGS = {
  /** attack + special-attack */
  offense: 300,
  /** hp + defense + special-defense */
  bulk: 400,
  speed: 150
} as const;

/**
 * Weights for a single member's quality. These sum to 1, so member quality is
 * always in 0..1.
 */
export const MEMBER_WEIGHTS = {
  offense: 0.4,
  bulk: 0.4,
  speed: 0.2
} as const;

/**
 * How strongly a typing modulates the raw stats it applies to.
 *
 * Typing scales its stat term between (1 - modulation) and 1 rather than
 * multiplying it outright. A poor offensive typing should discount a big
 * attack stat, not erase it.
 */
export const TYPE_MODULATION = 0.5;

/**
 * Positive synergy weights per format. Each set sums to 1, so the bonus is
 * always in 0..1 whichever format is being scored.
 *
 * Singles has no ally on the field, so spread-move safety cannot occur and its
 * weight is zero rather than being scored on a property the format does not
 * have. That share is redistributed across the terms that do apply, which is
 * why the two sets are written out in full rather than derived — an explicit
 * pair of tables is easier to check than redistribution arithmetic.
 */
export const SYNERGY_BONUS_WEIGHTS_BY_FORMAT = {
  doubles: {
    coverageBreadth: 0.35,
    resistanceBreadth: 0.25,
    typeDiversity: 0.15,
    /** Attacking types a partner's immunity makes free to spread. */
    enabledSpread: 0.13,
    /** Breadth of doubles support roles the team's abilities cover. */
    supportRoles: 0.12
  },
  singles: {
    coverageBreadth: 0.4,
    resistanceBreadth: 0.3,
    typeDiversity: 0.17,
    enabledSpread: 0,
    supportRoles: 0.13
  }
} as const;

/** Doubles weights, kept as the default for callers that omit a format. */
export const SYNERGY_BONUS_WEIGHTS = SYNERGY_BONUS_WEIGHTS_BY_FORMAT.doubles;

/**
 * Penalty weights, expressed on the same 0..1 scale as the bonus. A weight
 * above 1 means that single failure can wipe out every bonus the team earned.
 */
export const SYNERGY_PENALTY_WEIGHTS = {
  /** A weakness with neither a defensive nor an offensive answer. */
  uncoveredWeakness: 0.6,
  /** As above, but the weakness is 4x. */
  uncoveredQuadrupleWeakness: 1.2,
  /** Members beyond the first sharing a weakness. */
  sharedWeakness: 0.5,
  /** Any 4x weakness on the team, answered or not. */
  quadrupleWeakness: 0.6,
  /** Members beyond the first sharing a 4x weakness — the worst failure mode. */
  sharedQuadrupleWeakness: 1.5,
  /**
   * Attacking types with no safe partner to spread alongside. Weighted well
   * below the defensive terms: it costs the team an option rather than losing
   * it a game, since single-target moves of that type remain available.
   */
  /**
   * Only meaningful in doubles; zeroed for singles alongside the enabledSpread
   * bonus so neither side of the spread model scores a format that lacks it.
   */
  spreadConflict: 0.25,
  /**
   * Members competing to set incompatible weather or terrain. Weighted heavily
   * because it is a build error rather than a missed bonus: the abilities
   * actively overwrite each other every time either switches in.
   */
  fieldConflict: 0.4
} as const;

/**
 * Split between raw member quality and team synergy in the final score.
 * These sum to 1.
 */
export const COMPOSITE_WEIGHTS = {
  memberQuality: 0.45,
  synergy: 0.55
} as const;

export interface MemberQualityInput {
  stats: PokemonStats;
  /** Normalized offensive score, 0..1, higher is broader coverage. */
  normalizedDamageToScore: number;
  /** Normalized defensive score, 0..1, higher is more vulnerable. */
  normalizedDamageFromScore: number;
}

/**
 * Scores a single team member's raw quality.
 *
 * @param member Base stats plus the normalized type scores that modulate them.
 * @returns A value in 0..1.
 */
export function scoreMemberQuality(member: MemberQualityInput): number {
  const { stats, normalizedDamageToScore, normalizedDamageFromScore } = member;

  const offense = clamp01((stats.attack + stats['special-attack']) / STAT_CEILINGS.offense);
  const bulk = clamp01((stats.hp + stats.defense + stats['special-defense']) / STAT_CEILINGS.bulk);
  const speed = clamp01(stats.speed / STAT_CEILINGS.speed);

  const modulate = (quality: number) => (1 - TYPE_MODULATION) + (TYPE_MODULATION * clamp01(quality));
  const offensiveTyping = modulate(normalizedDamageToScore);
  const defensiveTyping = modulate(1 - normalizedDamageFromScore);

  return clamp01(
    (MEMBER_WEIGHTS.offense * offense * offensiveTyping) +
    (MEMBER_WEIGHTS.bulk * bulk * defensiveTyping) +
    (MEMBER_WEIGHTS.speed * speed)
  );
}

export interface SynergyInput {
  coverage: TeamCoverageAnalysis;
  /** Battle format being scored. Defaults to doubles. */
  format?: BattleFormat;
  /** Ability-derived support roles. Omit when abilities are unknown. */
  roles?: TeamRoleAnalysis;
  /** Distinct elemental types across the team. */
  typesTotal: number;
  teamSize: number;
  /** Number of elemental types in play, used to scale breadth and gap counts. */
  typeCount: number;
}

/**
 * Scores how well a team's members complement each other.
 *
 * @param input Coverage analysis plus the team shape needed to scale it.
 * @returns A value in -1..1, where negative means the gaps outweigh the synergy.
 */
export function scoreTeamSynergy(input: SynergyInput): number {
  const { coverage, roles, typesTotal, teamSize, typeCount } = input;
  if (typeCount <= 0 || teamSize <= 0) return 0;

  const format = input.format ?? BATTLE_FORMATS[DEFAULT_BATTLE_FORMAT];
  const bonusWeights = SYNERGY_BONUS_WEIGHTS_BY_FORMAT[format.id];
  // With no ally on the field, neither half of the spread model can occur.
  const spreadConflictWeight = format.hasAlly ? SYNERGY_PENALTY_WEIGHTS.spreadConflict : 0;
  // Normalizing by the roles the format can actually use keeps full breadth
  // reachable in singles, where two of the five roles are inert.
  const applicableRoleCount = getApplicableRoles(format.hasAlly).length;

  const sumBeyondFirst = (counts: Record<string, number>, names: string[]): number =>
    names.reduce((total, name) => total + (counts[name] - 1), 0);
  const sumAll = (counts: Record<string, number>): number =>
    Object.values(counts).reduce((total, count) => total + count, 0);

  // A team of N distinct dual types can show at most 2N elemental types, but
  // never more than the number of types in play.
  const maxDistinctTypes = Math.min(teamSize * 2, typeCount);

  const bonus =
    (bonusWeights.coverageBreadth * clamp01(coverage.uniqueCoverages / typeCount)) +
    (bonusWeights.resistanceBreadth * clamp01(coverage.uniqueResistances / typeCount)) +
    (bonusWeights.typeDiversity * clamp01(typesTotal / maxDistinctTypes)) +
    (bonusWeights.enabledSpread * clamp01(coverage.enabledSpreadTypes.length / maxDistinctTypes)) +
    (bonusWeights.supportRoles * clamp01((roles?.roles.length ?? 0) / applicableRoleCount));

  const penalty =
    (SYNERGY_PENALTY_WEIGHTS.uncoveredWeakness * (coverage.uncoveredWeaknesses.length / typeCount)) +
    (SYNERGY_PENALTY_WEIGHTS.uncoveredQuadrupleWeakness * (coverage.uncoveredQuadrupleWeaknesses.length / typeCount)) +
    (SYNERGY_PENALTY_WEIGHTS.sharedWeakness * (sumBeyondFirst(coverage.weaknessCounts, coverage.sharedWeaknesses) / (teamSize * 2))) +
    (SYNERGY_PENALTY_WEIGHTS.quadrupleWeakness * (sumAll(coverage.quadrupleWeaknessCounts) / teamSize)) +
    (SYNERGY_PENALTY_WEIGHTS.sharedQuadrupleWeakness * (sumBeyondFirst(coverage.quadrupleWeaknessCounts, coverage.sharedQuadrupleWeaknesses) / teamSize)) +
    (spreadConflictWeight * clamp01(coverage.spreadConflicts.length / maxDistinctTypes)) +
    (SYNERGY_PENALTY_WEIGHTS.fieldConflict * clamp01((roles?.fieldConflicts.length ?? 0) / applicableRoleCount));

  return Math.min(1, Math.max(-1, bonus - penalty));
}

/**
 * Combines member quality and synergy into the ranking score.
 *
 * Synergy is remapped from -1..1 onto 0..1 so the result is always a 0..100
 * figure, readable as a percentage of an ideal team.
 *
 * @param memberQualities Per-member quality scores in 0..1.
 * @param synergy Team synergy in -1..1.
 * @returns The composite score in 0..100.
 */
export function composeTeamScore(memberQualities: number[], synergy: number): number {
  const averageQuality = memberQualities.length === 0
    ? 0
    : memberQualities.reduce((total, quality) => total + quality, 0) / memberQualities.length;

  const synergyOnUnitScale = (Math.min(1, Math.max(-1, synergy)) + 1) / 2;

  return 100 * (
    (COMPOSITE_WEIGHTS.memberQuality * averageQuality) +
    (COMPOSITE_WEIGHTS.synergy * synergyOnUnitScale)
  );
}
