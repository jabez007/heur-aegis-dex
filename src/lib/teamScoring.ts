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
 *
 * ## These were checked against the ranges they actually occupy
 *
 * A weight only means what it says if the term under it uses its range — the
 * defect COMPOSITE_BOUNDS records one level up, and the reason to look here too.
 * Measured across all 208 legal species of Regulation M-B on 2026-07-28, over the
 * 1st-to-99th percentile band:
 *
 * | term    | span  | weight | realized swing | share |
 * | ------- | ----- | ------ | -------------- | ----- |
 * | offense | 0.502 | 0.35   | 0.176          | 0.34  |
 * | bulk    | 0.475 | 0.45   | 0.214          | 0.41  |
 * | speed   | 0.673 | 0.20   | 0.135          | 0.26  |
 *
 * Against a nominal 0.35 / 0.45 / 0.20. **These hold up**, unlike the composite
 * weights above: bulk really is the largest term, which is what this project's
 * premise asks for. `STAT_CEILINGS` having been set to competitive rather than
 * theoretical maxima is why, and this is the evidence that it worked.
 *
 * The one drift worth recording: Speed swings 0.26 of the total against a nominal
 * 0.20, because base Speed spreads wider across the pool than either other term.
 * Left alone deliberately — correcting a 6-point overshoot on a term already
 * known to be modelled wrong for Trick Room would be tuning the symptom.
 *
 * Rerun `npm run measure:composite-bounds` after changing STAT_CEILINGS,
 * SECONDARY_OFFENSE_WEIGHT or these weights.
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
 *
 * They only mean what they say because both halves are normalized against their
 * reachable ranges first — see COMPOSITE_BOUNDS. Read that before touching
 * these numbers: for a long time this said 45/55 and behaved like 16/84.
 */
export const COMPOSITE_WEIGHTS = {
  memberQuality: 0.45,
  synergy: 0.55
} as const;

/**
 * Reachable ranges of the two halves of the composite score, measured.
 *
 * This is the same calibration error `pokedexScoring.ts` records under
 * OBSERVED_DAMAGE_FROM, in the same model, found the same way — and the argument
 * there applies unchanged. Normalizing against a range the quantity cannot
 * actually occupy compresses it, and a compressed term is a term that does not
 * decide anything however large its nominal weight.
 *
 * ## What was wrong
 *
 * `composeTeamScore` combined an average member quality on 0..1 with a synergy
 * remapped from its nominal -1..1. Neither used its range. Member quality is a
 * weighted mean of clamped terms, then averaged again across the team, so it
 * bunches hard around 0.5; synergy is a bonus-minus-penalty difference that
 * genuinely spans almost all of -1..1.
 *
 * Measured over 200,000 random brings from the 208 legal species of Regulation
 * M-B, across the 1st-to-99th percentile band where real comparisons happen:
 *
 * | half           | nominal weight | points of swing |
 * | -------------- | -------------- | --------------- |
 * | member quality | 0.45           | 5.9             |
 * | team synergy   | 0.55           | 31.0            |
 *
 * A stated 45/55 split behaving as **5.2 to 1**. Half of all large member-quality
 * gaps were overturned by synergy, so how good the Pokemon were was close to a
 * coin flip against how tidily they fitted together.
 *
 * The visible symptom: four Pokemon of Watchog/Audino/Emolga/Dedenne calibre
 * scored **55.28**, against **43.59** for Dragonite, Metagross, Garchomp and
 * Tyranitar. Synergy was right in direction — two shared quadruple Ice
 * weaknesses is a genuinely poor four — but it outvoted a 0.19 quality gap that
 * should have been decisive. The roster generator was picking Emolga and Dedenne
 * into its best rosters for the same reason.
 *
 * ## How these were measured
 *
 * `scripts/measure-composite-bounds.mjs`, run 2026-07-28 against Regulation M-B:
 * every legal species in its default form, resolved through the species endpoint
 * so the dozen that exist only under a form suffix are included, then 200,000
 * random brings per format. Rerun it after any change to MEMBER_WEIGHTS,
 * SYNERGY_*_WEIGHTS or the coverage analysis — all of them move these.
 *
 * Both halves are bounded per format, because both depend on it: quality is an
 * average over `broughtToBattle` members, and synergy uses a different weight
 * table and role count in singles.
 *
 * ## Why quality is exact and synergy is observed
 *
 * Average member quality has a **closed-form** range: the best a team average can
 * be is the mean of the pool's highest individual qualities, the worst is the
 * mean of its lowest. No sampling needed, and no team can fall outside it. Both
 * ends are also perfectly ordinary teams — the four best legal Pokemon is a
 * normal thing to register — which is the property the old formula extremes
 * lacked.
 *
 * Synergy has no such form, so its bounds are the extremes observed across the
 * sample, and values outside them clamp as they do for STAT_CEILINGS. Its floor
 * sits at exactly -1 because `scoreTeamSynergy` already clamps there; teams worse
 * than that are indistinguishable, which costs nothing worth having.
 *
 * ## What this does and does not fix
 *
 * Percentile bounds would land the ratio on the nominal 1.22:1, and were
 * rejected: the top 0.1% of *random* teams are where the roster generator
 * actually operates, and generated brings reach synergy 0.678 against a 99.9th
 * percentile of 0.641. Clamping there would blind the search at exactly the point
 * it does its work. These bounds clamp nothing.
 *
 * The residual is **1.79:1 in doubles and 1.71:1 in singles**, against a nominal
 * 1.22:1 — recorded rather than tuned away. Synergy keeps roughly half again the
 * influence the weights claim, because its own -1 clamp compresses the bottom of
 * its range and normalizing cannot undo that. Closing the rest means changing
 * `scoreTeamSynergy`, not these constants. This takes the error from 330% to 46%.
 */
export const COMPOSITE_BOUNDS = {
  doubles: {
    quality: { min: 0.3336, max: 0.6396 },
    synergy: { min: -1, max: 0.7873 }
  },
  singles: {
    quality: { min: 0.3184, max: 0.6443 },
    synergy: { min: -1, max: 0.8078 }
  }
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
 * Both halves are rescaled onto 0..1 against their reachable ranges before being
 * weighted, so COMPOSITE_WEIGHTS describes the balance the score actually has.
 * See COMPOSITE_BOUNDS for the measurement and for what it does not fix.
 *
 * The result is still a 0..100 figure, but it is now read against real teams
 * rather than against arithmetic limits: a team scoring 0 is as weak as the
 * legal pool allows, not infinitely weak. Scores are therefore not comparable
 * across a change to the bounds. No cache key moves with them — team scores are
 * computed live in the workbench, and only the scan output is cached.
 *
 * @param memberQualities Per-member quality scores in 0..1.
 * @param synergy Team synergy in -1..1.
 * @param format Battle format the bounds are taken from. Defaults to doubles.
 * @returns The composite score in 0..100.
 */
export function composeTeamScore(
  memberQualities: number[],
  synergy: number,
  format: BattleFormat = BATTLE_FORMATS[DEFAULT_BATTLE_FORMAT]
): number {
  const bounds = COMPOSITE_BOUNDS[format.id];

  const averageQuality = memberQualities.length === 0
    ? 0
    : memberQualities.reduce((total, quality) => total + quality, 0) / memberQualities.length;

  const rescale = (value: number, { min, max }: { min: number; max: number }) =>
    max === min ? 0.5 : clamp01((value - min) / (max - min));

  return 100 * (
    (COMPOSITE_WEIGHTS.memberQuality * rescale(averageQuality, bounds.quality)) +
    (COMPOSITE_WEIGHTS.synergy * rescale(synergy, bounds.synergy))
  );
}
