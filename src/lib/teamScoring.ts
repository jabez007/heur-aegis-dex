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
import { getQualityMultipliers } from './abilityEffects';
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
  /** Effective offence: see `effectiveOffense`. Not the raw sum of both stats. */
  offense: 195,
  /** hp + defense + special-defense */
  bulk: 400,
  speed: 150
} as const;

/**
 * How much the weaker attacking stat counts toward offence.
 *
 * The weaker side is not worthless — it is the angle a Pokemon has left when
 * something walls its primary — but it is not a second attacker either, because
 * moveslots and the stat that powers them are both finite.
 *
 * Reasoned, not validated against usage data, like `MIXED_ATTACKER_RATIO`.
 */
export const SECONDARY_OFFENSE_WEIGHT = 0.3;

/**
 * Offensive stat value a Pokemon can actually bring to bear.
 *
 * `attack + special-attack` was the previous measure and it is blind to whether
 * a Pokemon can use both halves. Azumarill swings the 100 Attack Huge Power
 * built for it and never touches its 60 Special Attack; Blastoise has 83/85,
 * neither of them notable. Summed, Blastoise scored *higher* — 168 against 160.
 *
 * `coverageMoves.ts` already rejected this reasoning at the layer above. Its
 * `getAttackerBias` reads Azumarill's movepool as physical, on the argument that
 * crediting Pelipper with physical coverage it cannot use at 50 Attack describes
 * a Pokemon that does not exist. That argument stopped at the coverage layer and
 * never reached the term that scores the stats themselves.
 *
 * There was a second half to it. A 300 ceiling on the sum is only approachable
 * by a mixed attacker — the highest sum anywhere in the validation fixture is
 * 234 — so a one-sided attacker was capped near its own total no matter how
 * elite its real attacking stat, because half the numerator was a stat it never
 * used.
 *
 * ## Why this is smooth rather than a classification
 *
 * `getAttackerBias` returns a category, and reusing it here would put a cliff at
 * the boundary: two Pokemon either side of `MIXED_ATTACKER_RATIO` would score
 * very differently over a single point of difference. A category is right for
 * "which moves would this Pokemon run", where the answer really is discrete. It
 * is wrong for a magnitude. Discounting the weaker stat gives the same ordering
 * without the discontinuity.
 *
 * The rescaled ceiling is chosen so genuinely mixed attackers land where they
 * already did — Lucario moves 0.750 to 0.759, Simisear 0.653 to 0.653 — and only
 * one-sided attackers move. This is meant to stop under-rating them, not to
 * re-scale everything.
 *
 * @param stats Base stats of the form the Pokemon fights in, ability applied.
 * @returns Primary attacking stat plus the discounted secondary.
 */
export function effectiveOffense(stats: PokemonStats): number {
  const physical = stats.attack;
  const special = stats['special-attack'];
  return Math.max(physical, special) + (SECONDARY_OFFENSE_WEIGHT * Math.min(physical, special));
}

/**
 * Weights for a single member's quality. These sum to 1, so member quality is
 * always in 0..1.
 *
 * Bulk carries the largest share deliberately. A Pokemon has to threaten
 * something to win, but it only gets to threaten anything on turns it is still
 * alive — the one that survives is the one that wins. That is also the premise
 * this project started from: it began as a theorycrafter for *defensive*
 * typings, and weighting bulk over offence keeps the scoring pointed at the
 * question it was built to answer.
 *
 * Speed is left where it is, and is the weakest part of this model: it is
 * treated as linearly good, which is wrong for a format where Trick Room makes
 * low Speed an asset. Correcting that needs move data the scan does not have,
 * so the bias is recorded here rather than papered over.
 */
export const MEMBER_WEIGHTS = {
  offense: 0.35,
  bulk: 0.45,
  speed: 0.2
} as const;

/**
 * How strongly a typing modulates the raw stats it applies to.
 *
 * Typing scales its stat term between (1 - modulation) and 1 rather than
 * multiplying it outright. A poor offensive typing should discount a big
 * attack stat, not erase it.
 *
 * ## Why this moved from 0.5 to 0.4
 *
 * It did not move because 0.5 was too strong. It moved because 0.5 was never
 * actually in effect: the scores feeding it were normalized against formula
 * extremes no real typing approaches, so the defensive signal occupied 17.7% of
 * its nominal range and this constant halved what survived. The best defensive
 * typing in the game beat the worst by 2.7 points of final ranking — less than a
 * quarter of the Speed spread — in a tool built to rank defensive typings.
 *
 * `pokedexScoring.ts` now bounds those scores empirically, which widens the
 * defensive signal to 86% of range. At the old 0.5 that alone would swing 13.4
 * points and make typing the single largest term in the model, overshooting in
 * the opposite direction. 0.4 puts the defensive-typing swing at 10.7 points,
 * against 12.7 for bulk, 12.1 for Speed and 10.6 for offence.
 *
 * The intent is that typing is a **peer** of the stats: able to decide between
 * Pokemon whose stats are close, never able on its own to overturn a large stat
 * gap. That is what this project's premise asks for — typing central, stats
 * real. Raising it back toward 0.5 makes typing lead outright, which is now a
 * knob with a known consequence rather than a setting that quietly did nothing.
 *
 * Reasoned against measured term swings, not validated against match outcomes —
 * the same standing as MEMBER_WEIGHTS.
 */
export const TYPE_MODULATION = 0.4;

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
  /**
   * Ability selected for battle. Some abilities change what a stat line is
   * worth without changing the stats — see abilityEffects.ts. Omitting it
   * scores the Pokemon as though its ability does nothing.
   */
  abilityName?: string;
}

/**
 * Scores a single team member's raw quality.
 *
 * @param member Base stats plus the normalized type scores that modulate them.
 * @returns A value in 0..1.
 */
export function scoreMemberQuality(member: MemberQualityInput): number {
  const { stats, normalizedDamageToScore, normalizedDamageFromScore } = member;

  // Multiscale, Unaware and their kin change what a stat line is worth without
  // changing the stats, so they scale the component they actually affect.
  const ability = getQualityMultipliers(member.abilityName);

  const offense = clamp01(
    (effectiveOffense(stats) / STAT_CEILINGS.offense) * ability.offense
  );
  const bulk = clamp01(
    ((stats.hp + stats.defense + stats['special-defense']) / STAT_CEILINGS.bulk) * ability.bulk
  );
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
