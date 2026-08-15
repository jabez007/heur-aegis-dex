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
import { effectiveOffense, hpAdjustedBulk } from './statMetrics';
import type { TeamCoverageAnalysis } from './teamCoverage';
import { getApplicableRoles, type AbilityRole, type TeamRoleAnalysis } from './abilityRoles';
import { getQualityMultipliers } from './abilityEffects';
import { getAttackerBias } from './coverageMoves';
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
  /** HP-adjusted effective bulk: see `hpAdjustedBulk`. */
  bulk: 150,
  speed: 150
} as const;

// `effectiveOffense` and its weight moved to `statMetrics.ts`, beside
// `hpAdjustedBulk` — the two are the same kind of thing and only one of them
// was there. The move was forced by `statusThreat.ts`, which needs to know what
// burn costs a stat line and cannot import this module: this one imports the
// ability tables, and the ability tables need statusThreat. Re-exported here
// because every existing caller reads them from this module.
export { effectiveOffense, SECONDARY_OFFENSE_WEIGHT } from './statMetrics';


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
 * These describe the real balance because the terms under them are rescaled
 * against the ranges they occupy first — see OBSERVED_STAT_TERMS.
 */
export const MEMBER_WEIGHTS = {
  offense: 0.35,
  bulk: 0.45,
  speed: 0.2
} as const;

/**
 * Reachable ranges of the three stat terms, measured across the legal pool.
 *
 * The third and innermost instance of the defect `pokedexScoring.ts` records
 * under OBSERVED_DAMAGE_FROM and COMPOSITE_BOUNDS records above. `STAT_CEILINGS`
 * fixed the *top* of each term — competitive ceilings rather than the theoretical
 * 255 — and nobody looked at the bottom. Every term turned out to have a floor
 * well above zero, and a different one each:
 *
 * | term    | floor | ceiling | realized share | nominal |
 * | ------- | ----- | ------- | -------------- | ------- |
  * | offense | 0.320 | 0.992   | 0.347          | 0.35    |
  * | bulk    | 0.264 | 0.785   | 0.355          | 0.45    |
  * | speed   | 0.133 | 1.000   | 0.298          | 0.20    |
 *
 * The floors are what matter here. An 85 Attack — unusable in a format where the
 * Pokemon worth bringing carry 130 — still collected **52%** of the offence term,
  * because the term's implicit zero was a Pokemon with no attacking stat at all
  * and nothing in the pool is close to that. Under the old additive bulk metric,
  * Steelix ranked 21st despite an attacking stat that cannot knock anything out.
 *
 * That is the third gate of this project's premise — defensive typing, then bulk
 * within it, then a real attacking stat — failing to bite, and it failed because
 * a floor nobody set was doing the work.
 *
 * ## Consequences, all pointing the same way
 *
 * Rescaling each term against its own range does three things at once, which is
 * why it is worth the churn:
 *
  * 1. MEMBER_WEIGHTS stays close to its intended balance (0.35 / 0.42 / 0.23
  *    against 0.35 / 0.45 / 0.20), so bulk leads without erasing the other terms.
  * 2. HP-rich tanks rise while low-HP Pokemon can no longer buy maximum bulk from
  *    high defenses they lack the HP to exploit.
  * 3. Speed remains a separate, softly weighted term rather than compensating for
  *    either offensive pressure or durability.
 *
 * ## Why min/max rather than percentiles
 *
 * Percentile bounds would land the shares exactly on nominal, and are rejected
 * for the reason already argued under COMPOSITE_BOUNDS: the 99th percentile of
 * offence is 0.841, which is *Dragonite* — clamping there would flatten the top
 * of the pool, which is the part anyone is choosing between. These bounds clamp
 * nothing and land within 0.02 of nominal anyway.
 *
 * ## Why speed tops out at exactly 1
 *
 * It is the one bound set by an ability rather than by a stat line. Speed Boost
 * takes Scolipede's 112 past the ceiling `STAT_CEILINGS.speed` establishes, and
 * `clamp01` catches it — so the reachable top of the term really is 1, not the
 * 0.9467 that Dragapult's 142 base speed used to define.
 *
 * The cost is worth naming: widening the denominator from 0.8134 to 0.8667
 * compresses every *other* Pokemon's speed term by about 6%. That is the correct
 * direction — the range genuinely got wider, so the same base speed is a smaller
 * share of it — but it means four Pokemon gaining an ability slightly discounted
 * the speed of the other 204. The effect is small and it is not a side effect
 * nobody chose.
 *
 * ## Why the bulk ceiling fell from 0.876 to 0.785
 *
 * Re-measured 2026-08-13, after the resist abilities — Thick Fat, Heatproof,
 * Water Bubble, Solid Rock and half of Purifying Salt — moved out of
 * `abilityEffects.ts` and into `pokedexAbilities.ts`, where each is computed from
 * the Pokemon's own damage relations instead of a flat multiplier on this term.
 *
 * The old ceiling was theirs. A bulk multiplier scales `hpAdjustedBulk`, so those
 * constants were inflating the top of this range — Snorlax's HP times Thick Fat's
 * 1.12 defined a ceiling that no stat line reaches. Removing them did not make
 * any Pokemon less bulky; it stopped an ability being counted as bulk.
 *
 * The cost is the mirror of the Speed Boost note above, in the other direction:
 * narrowing the denominator lifts every Pokemon's bulk term by about 10%. The
 * shape is right — the range genuinely got narrower — but it means the migration
 * slightly raised bulk across the pool while lowering it sharply for the seven
 * Pokemon that had been overpaid.
 *
 * Bulk's realized share fell to 0.355 against a nominal 0.45, and speed's rose to
 * 0.298 against 0.20, which is the widest this table has drifted from
 * MEMBER_WEIGHTS. That is not the migration mispricing anything — it is the
 * ability multipliers having quietly propped up bulk's spread, and it is recorded
 * rather than corrected because closing it means changing MEMBER_WEIGHTS or
 * STAT_CEILINGS, neither of which this change has a mandate to touch.
 *
  * Measured 2026-08-13 by `npm run measure:composite-bounds` over all 208 legal
 * species of Regulation M-B, computed exactly as `scoreMemberQuality` computes
 * them with ability multipliers applied. Rerun after changing STAT_CEILINGS,
 * SECONDARY_OFFENSE_WEIGHT, the ability tables or MEMBER_WEIGHTS.
 *
 * Rerun again the same day when Purifying Salt became a derived offence and
 * speed multiplier (`statusThreat.ts`), and **nothing moved**. Garganacl is the
 * only carrier, and it is neither fast enough for the speed credit to approach
 * the ceiling nor offensive enough to approach the offence one, so the reachable
 * extremes are still set by other Pokemon entirely. Recorded because a rerun
 * that confirms a bound is as much a result as one that moves it.
 */
export const OBSERVED_STAT_TERMS = {
  offense: { min: 0.32, max: 0.9923 },
  bulk: { min: 0.2642, max: 0.7849 },
  speed: { min: 0.1333, max: 1 }
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
  fieldConflict: 0.4,
  /**
   * A team with no credible threat off one of the two attacking stats.
   *
   * Every other term here is defensive: which types hit you, and how many of you
   * at once. This is the same failure on the offensive axis — one opposing
   * commitment blanking several members at once — and until it existed the model
   * could not see it at all. The case that surfaced it scored 88.77 in singles
   * with **zero shared weaknesses**, a defensively perfect triangle of
   * Annihilape, Mamoswine and Corviknight whose Special Attack stats are 50, 70
   * and 53. The model had found exactly what it was built to find and paid
   * nothing for the fact that a single Will-O-Wisp halves the whole team.
   *
   * Weighted at `sharedWeakness`, and for the same reason rather than by
   * analogy: both price one opposing choice reaching multiple members. Measured
   * against the legal pool, 22% of species can inflict burn and 7% carry
   * Intimidate — **27% can cut an all-physical team's offense unilaterally**,
   * which is comparable to how often a shared weakness is exploitable. Setting
   * it above that would make offensive shape outrank the defensive typing this
   * tool is built on; below it, the term does not survive the composite rescale.
   *
   * **The exposure is asymmetric and this term is not, deliberately.** Burn cuts
   * Attack and nothing in the game cuts Special Attack — the ailment table holds
   * burn, paralysis, poison and sleep, and only burn touches an attacking stat.
   * So an all-physical team is genuinely more punished than an all-special one,
   * by roughly the 22% that burn adds. Recorded and not applied: an all-special
   * team is still walled by special walls, that half has not been measured, and
   * a one-sided constant would be asserting a ratio nobody has derived.
   *
   * Reasoned against a measured exposure rather than validated against match
   * outcomes — the standing of MEMBER_WEIGHTS and TYPE_MODULATION.
   */
  monochromeOffense: 0.5
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
  * | member quality | 0.45           | 8.5             |
  * | team synergy   | 0.55           | 30.4            |
 *
 * A stated 45/55 split behaving as **4 to 1**. Half of all large member-quality
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
 * `scripts/measure-composite-bounds.mjs`, run 2026-08-13 against Regulation M-B,
 * and **rerun whenever `scoreMemberQuality` changes** — these bounds are measured
 * on its output, so a change to OBSERVED_STAT_TERMS invalidates them. That
 * dependency is an ordering constraint, not just a trigger: the run that sets
 * OBSERVED_STAT_TERMS must be pasted in and the script run *again* before these
 * numbers mean anything, because the first run measures quality against the old
 * term ranges. Details:
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
 * That difference decides what happens on a rerun. The quality bounds are
 * replaced outright, because the closed form makes the new numbers strictly more
 * correct than the old ones. **The synergy maxima are only ever widened.** 200,000
 * samples out of C(208,4) is a small fraction of the space, so its observed
 * maximum wanders between runs — doubles has read 0.8124, 0.7629 and 0.7770 across
 * three — and taking the latest would narrow the bound on nothing but the luck of
 * the draw, clamping teams a previous run proved reachable. Widen on evidence,
 * never narrow on its absence.
 *
 * ## What this does and does not fix
 *
 * Percentile bounds would land the ratio on the nominal 1.22:1, and were
 * rejected: the top 0.1% of *random* teams are where the roster generator
 * actually operates, and generated brings reach synergy 0.678 against a 99.9th
 * percentile of 0.635. Clamping there would blind the search at exactly the point
 * it does its work. These bounds clamp nothing.
 *
  * The residual is **1.85:1 in doubles and 1.68:1 in singles**, against a nominal
 * 1.22:1 — recorded rather than tuned away. Synergy keeps roughly half again the
 * influence the weights claim, because its own -1 clamp compresses the bottom of
 * its range and normalizing cannot undo that. Closing the rest means changing
 * `scoreTeamSynergy`, not these constants. Unnormalized, doubles runs 3.57:1;
 * these bounds take the error against nominal from 193% to 52%.
 *
 * The 2026-08-13 rerun, after the resist abilities moved to the type layer,
 * moved both quality bounds up — doubles 0.145..0.567 to 0.154..0.614 — because
 * `OBSERVED_STAT_TERMS` narrowed the bulk denominator and lifted every Pokemon's
 * bulk term with it. Singles synergy widened 0.8078 to 0.8189 on a new observed
 * maximum; doubles observed 0.7770 and **kept its 0.8124**, per the widen-only
 * rule above.
 */
/**
 * ## Re-measured 2026-08-14, for threat weighting
 *
 * `typeThreat.ts` scales each type's contribution to the defensive score by how
 * much of the pool can attack with it, which changes what `scoreMemberQuality`
 * produces and so invalidates any bound measured on its output. The rerun was
 * mandatory rather than diligent.
 *
 * The quality bounds are replaced outright, per the rule above: they have a
 * closed form, so a fresh run is strictly more correct. They barely moved —
 * doubles 0.154..0.6137 to 0.1559..0.6249 — because typing enters quality
 * through `TYPE_MODULATION`, which scales a stat term rather than standing on
 * its own. A change that reorders the defensive ranking is still a small change
 * to the extremes of the blend that contains it.
 *
 * **Both synergy maxima are unchanged, and that is a result rather than an
 * oversight.** Doubles sampled 0.7770 against the recorded 0.8124 and singles
 * hit 0.8189 exactly; the first is kept under the widen-only rule and the second
 * confirms it. Synergy is computed by `analyzeTeamCoverage`, which still counts
 * weaknesses without weighting them, so it *should* be invariant here. If a
 * later change teaches the coverage analysis about threat weights, these two
 * numbers move and this paragraph stops being true.
 *
 * ## Re-measured again 2026-08-14, for IMMUNITY_VALUE
 *
 * Pricing a true immunity at -4 rather than -1 changes `damage_from_score` for
 * every typing that has one, so it changes what `scoreMemberQuality` produces
 * and these bounds had to be taken again. Quality fell at both ends — doubles
 * 0.1559..0.6249 to 0.1521..0.6024, singles 0.1367..0.6338 to 0.1314..0.6108 —
 * because `OBSERVED_DAMAGE_FROM` widened from 11.25..26 to 0.25..26 and a
 * normalized defensive score is a smaller share of a bigger range.
 *
 * The narrowing is real but small, and it is not the compression this file warns
 * about. The realized swing of the defensive-typing term across the M-B pool
 * went from 7.5 points of final ranking to 7.3, so `TYPE_MODULATION` still puts
 * typing where it was deliberately placed: a peer of the stats, able to decide
 * between Pokemon whose stats are close and unable to overturn a large stat gap.
 * The bigger raw spread between typings and the bigger denominator very nearly
 * cancel, which is the reason no constant beyond these bounds needed to move.
 *
 * Synergy maxima unchanged for the third time, for the same reason as above.
 *
 * ## Re-measured twice more the same day
 *
 * First for the coverage-slot rule: `typeThreat.ts` stopped counting a move type
 * as coverage unless something is weak to it, which drops Normal from the
 * heaviest attacking type to the lightest and re-prices every weight against a
 * new maximum.
 *
 * Then for `IMMUNITY_VALUE` being corrected from -4 to -2, a unit error rather
 * than a change of mind — the derivation's -3 was in log units, where a
 * resistance is worth -1, and this scale prices a resistance at -0.5. The
 * numbers below are that final state. Quality landed at doubles
 * 0.1558..0.6221 and singles 0.1368..0.6330, which is within 0.01 of where it
 * sat before any of the immunity work; the -4 pass had pushed the doubles
 * ceiling down to 0.6024.
 *
 * Synergy unchanged throughout, now for the fifth measurement, for the reason
 * given above.
 *
 * `OBSERVED_DAMAGE_FROM` needed re-running for the immunity value and **not**
 * for the coverage rule, which is worth stating so nobody goes looking. It is
 * measured with uniform weights, so a change to the threat weights cannot move
 * it; a change to a bucket coefficient can.
 *
 * ## Re-measured for the coverage allocation
 *
 * `typeThreat.ts` now shares a Pokemon's free moveslots out in proportion to
 * what each coverage type would buy it, rather than evenly. That widens the
 * threat-weighted damage-from range from 12.42..24.35 to **12.17..24.72**,
 * because weight concentrates on fewer types instead of spreading thin.
 *
 * Quality barely moved — doubles 0.1558..0.6221 to 0.1556..0.6225, singles
 * 0.1368..0.6330 to 0.1365..0.6331 — which is the expected shape: the typing
 * term is one modulated input among three stats.
 *
 * ## Re-measured for regulation-aware team coverage, and singles finally moved
 *
 * `analyzeTeamCoverage` now prices each type by what it is worth in the
 * metagame instead of counting names, which is the largest single change to
 * this score any of these reruns has covered — synergy is two thirds of it.
 *
 * **Singles synergy widens for the first time, 0.8189 to 0.8247.** It had held
 * through six consecutive measurements, and the widen-only rule exists exactly
 * so a real new maximum like this is taken while sampling noise is not. Doubles
 * sampled 0.7863 against its recorded 0.8124 and keeps it, for the eighth time.
 * Quality is untouched in both, as it must be: quality does not read synergy.
 *
 * The floors dropped further — doubles p01 from -0.7351 to -0.8945, singles from
 * -0.7150 to -0.8408 — because a badly-matched team is now charged the real
 * price of its weaknesses rather than an averaged one. Synergy's residual
 * influence rises again with them, to **2.39:1** in doubles and 2.14:1 in
 * singles against a nominal 1.22:1. That number has now moved three times in one
 * day, always the same way, and the cause is always the same: every correction
 * has added information to the penalty side. It is the clearest signal yet that
 * closing the residual means revisiting `scoreTeamSynergy`'s -1 clamp rather
 * than these bounds — the clamp is what stops the bottom of the range from
 * being measured at all.
 *
 * ## Re-measured for the regulation-aware offensive score
 *
 * `defenderCensus.ts` replaced the chart count with a measurement against the
 * typings a regulation actually fields, which widens the raw offensive range
 * from 16..27 to **14.67..29.73** — real dual defenders produce the 4x and 0.25x
 * matchups a census of pure single types never reaches.
 *
 * The quality *ceiling* falls in both formats, doubles 0.6225 to 0.6155 and
 * singles 0.6331 to 0.6264, and the floors barely move. That is the shape to
 * expect: the wider denominator means only the genuinely best offensive typing
 * still normalizes to 1, where the chart count had eight typings tied at its
 * maximum of 27 and several more within half a point. Ground/Ice keeps the top
 * — against M-B it is resisted by one legal species, Araquanid — and everything
 * that used to tie with it now sits below.
 *
 * Both synergy maxima unchanged again, now for the fifth consecutive rerun.
 *
 * ## Re-measured for `monochromeOffense`
 *
 * Both synergy maxima are unchanged again, for the same reason as the last two
 * reruns and with the same caveat. Doubles sampled 0.7770 against the recorded
 * 0.8124 and keeps it under the widen-only rule; singles hit 0.8189 exactly for
 * the third time. `analyzeTeamCoverage` still counts weaknesses without
 * weighting them, so an allocation change inside `typeThreat.ts` cannot reach
 * it, and the invariance is evidence the two are as separate as claimed.
 *
 * ## Re-measured for `monochromeOffense`, and nothing moved
 *
 * Adding a synergy penalty is exactly the kind of change these bounds exist to
 * absorb, so the rerun was mandatory. **Every one of the four numbers below is
 * unchanged.** Quality does not touch synergy, so its exact bounds could not
 * move. Singles synergy hit 0.8189 for the fourth time; doubles sampled 0.7576,
 * below the recorded 0.8124, and keeps it under the widen-only rule.
 *
 * A maximum is the wrong place to look for this term's effect, and that is worth
 * saying rather than reading the stability as "no effect". `monochromeOffense`
 * is a penalty, so it can only push the *bottom* of the distribution down, and
 * the best teams — the ones setting the maximum — are balanced already. What
 * moved is the low end: doubles p01 went from -0.5483 to -0.7351 and singles
 * from -0.5256 to -0.7150.
 *
 * That has a cost, recorded and not corrected. Synergy's residual influence
 * against nominal rises from 1.85:1 to **2.15:1** in doubles and 1.68:1 to
 * 1.95:1 in singles, because a wider penalty side means synergy occupies more of
 * its fixed -1..1 range while quality occupies the same slice of its own. The
 * same argument that has always applied applies here: closing it means changing
 * `scoreTeamSynergy`'s clamp, not these constants. It is now a third again over
 * nominal rather than a half again.
 */
export const COMPOSITE_BOUNDS = {
  doubles: {
    quality: { min: 0.1557, max: 0.6155 },
    synergy: { min: -1, max: 0.8124 }
  },
  singles: {
    quality: { min: 0.1367, max: 0.6264 },
    synergy: { min: -1, max: 0.8247 }
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

  // Multiscale, Speed Boost and their kin change what a stat line is worth
  // without changing the stats, so they scale the component they actually
  // affect. Applied before the rescale, so an ability cannot push a term past
  // the reachable ceiling the pool was measured against — which is also what
  // gives an already-fast Speed Boost carrier less credit than a slow one.
  const ability = getQualityMultipliers(member.abilityName, stats);

  // Each term is put on its own reachable range, not on 0..1. Every one of them
  // has a floor well above zero — an unusable 85 Attack collected 52% of the
  // offence term before this — so a nominal 0..1 credited every Pokemon for
  // stats no Pokemon in the pool actually lacks. See OBSERVED_STAT_TERMS.
  const rescale = (value: number, { min, max }: { min: number; max: number }) =>
    clamp01((clamp01(value) - min) / (max - min));

  const offense = rescale(
    (effectiveOffense(stats) / STAT_CEILINGS.offense) * ability.offense,
    OBSERVED_STAT_TERMS.offense
  );
  const bulk = rescale(
    (hpAdjustedBulk(stats) / STAT_CEILINGS.bulk) * ability.bulk,
    OBSERVED_STAT_TERMS.bulk
  );
  const speed = rescale(
    (stats.speed / STAT_CEILINGS.speed) * ability.speed,
    OBSERVED_STAT_TERMS.speed
  );

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
  /**
   * Base stats per member, in roster order, for the offensive-class term.
   *
   * Stats rather than a pre-computed classification, so callers cannot disagree
   * about where the physical/special line falls — `getAttackerBias` draws it
   * once. A member whose stats are unknown resolves to `mixed` there and so
   * counts as a threat either way, which is the same refusal-to-guess the
   * coverage table makes.
   *
   * Omitted, or of the wrong length, scores the term at zero rather than
   * penalizing a team it cannot see. It is the one penalty that needs data
   * outside the coverage analysis, so it is the one that can go missing.
   */
  memberStats?: readonly (PokemonStats | null | undefined)[];
  /** Distinct elemental types across the team. */
  typesTotal: number;
  teamSize: number;
  /** Number of elemental types in play, used to scale breadth and gap counts. */
  typeCount: number;
}

export type SynergyBonusTermId =
  | 'coverageBreadth'
  | 'resistanceBreadth'
  | 'typeDiversity'
  | 'enabledSpread'
  | 'supportRoles';

export type SynergyPenaltyTermId =
  | 'uncoveredWeakness'
  | 'uncoveredQuadrupleWeakness'
  | 'sharedWeakness'
  | 'quadrupleWeakness'
  | 'sharedQuadrupleWeakness'
  | 'spreadConflict'
  | 'fieldConflict'
  | 'monochromeOffense';

export interface SynergyContribution<Id extends string = string> {
  readonly id: Id;
  readonly direction: 'bonus' | 'penalty';
  readonly weight: number;
  readonly numerator: number;
  readonly denominator: number;
  readonly normalizedValue: number;
  readonly contribution: number;
  readonly facts: readonly string[];
}

export interface TeamSynergyBreakdown {
  readonly status: 'scored' | 'degenerate';
  readonly formatId: BattleFormat['id'];
  readonly maxDistinctTypes: number;
  readonly applicableRoleCount: number;
  readonly bonusTerms: readonly SynergyContribution<SynergyBonusTermId>[];
  readonly penaltyTerms: readonly SynergyContribution<SynergyPenaltyTermId>[];
  readonly bonus: number;
  readonly penalty: number;
  readonly unclampedScore: number;
  readonly score: number;
}

const sortedKeys = (counts: Record<string, number>): string[] => Object.keys(counts).sort();

function evaluateTeamSynergy(
  input: SynergyInput,
  collect?: (breakdown: TeamSynergyBreakdown) => void
): number {
  const { coverage, roles, typesTotal, teamSize, typeCount } = input;
  const format = input.format ?? BATTLE_FORMATS[DEFAULT_BATTLE_FORMAT];
  const applicableRoleCount = getApplicableRoles(format.hasAlly).length;
  if (typeCount <= 0 || teamSize <= 0) {
    collect?.({
      status: 'degenerate',
      formatId: format.id,
      maxDistinctTypes: 0,
      applicableRoleCount,
      bonusTerms: [],
      penaltyTerms: [],
      bonus: 0,
      penalty: 0,
      unclampedScore: 0,
      score: 0
    });
    return 0;
  }

  const bonusWeights = SYNERGY_BONUS_WEIGHTS_BY_FORMAT[format.id];
  const spreadConflictWeight = format.hasAlly ? SYNERGY_PENALTY_WEIGHTS.spreadConflict : 0;
  const sumBeyondFirst = (counts: Record<string, number>, names: string[]): number =>
    names.reduce((total, name) => total + (counts[name] - 1), 0);
  const sumAll = (counts: Record<string, number>): number =>
    Object.values(counts).reduce((total, count) => total + count, 0);
  const maxDistinctTypes = Math.min(teamSize * 2, typeCount);

  // Priced by what each type is worth in this metagame when the analysis carries
  // that, and by a plain count when it does not. The weighted totals average the
  // same as the counts they replace — see the mean-1 argument on
  // `getTypeMatchupValues` — so every denominator below is unchanged.
  const w = coverage.weighted;
  const coverageBreadthValue = clamp01((w?.coverageBreadth ?? coverage.uniqueCoverages) / typeCount);
  const resistanceBreadthValue = clamp01((w?.resistanceBreadth ?? coverage.uniqueResistances) / typeCount);
  const typeDiversityValue = clamp01(typesTotal / maxDistinctTypes);
  const enabledSpreadValue =
    clamp01((w?.enabledSpread ?? coverage.enabledSpreadTypes.length) / maxDistinctTypes);
  const supportRolesValue = clamp01((roles?.roles.length ?? 0) / applicableRoleCount);
  const coverageBreadth = bonusWeights.coverageBreadth * coverageBreadthValue;
  const resistanceBreadth = bonusWeights.resistanceBreadth * resistanceBreadthValue;
  const typeDiversity = bonusWeights.typeDiversity * typeDiversityValue;
  const enabledSpread = bonusWeights.enabledSpread * enabledSpreadValue;
  const supportRoles = bonusWeights.supportRoles * supportRolesValue;
  const bonus = coverageBreadth + resistanceBreadth + typeDiversity + enabledSpread + supportRoles;

  const sharedWeaknessNumerator = w?.sharedWeakness
    ?? sumBeyondFirst(coverage.weaknessCounts, coverage.sharedWeaknesses);
  const quadrupleWeaknessNumerator = w?.quadrupleWeakness ?? sumAll(coverage.quadrupleWeaknessCounts);
  const sharedQuadrupleNumerator = w?.sharedQuadrupleWeakness ?? sumBeyondFirst(
    coverage.quadrupleWeaknessCounts,
    coverage.sharedQuadrupleWeaknesses
  );
  const uncoveredWeaknessValue =
    (w?.uncoveredWeakness ?? coverage.uncoveredWeaknesses.length) / typeCount;
  const uncoveredQuadrupleValue =
    (w?.uncoveredQuadrupleWeakness ?? coverage.uncoveredQuadrupleWeaknesses.length) / typeCount;
  const sharedWeaknessValue = sharedWeaknessNumerator / (teamSize * 2);
  const quadrupleWeaknessValue = quadrupleWeaknessNumerator / teamSize;
  const sharedQuadrupleValue = sharedQuadrupleNumerator / teamSize;
  const spreadConflictValue =
    clamp01((w?.spreadConflict ?? coverage.spreadConflicts.length) / maxDistinctTypes);
  const fieldConflictValue = clamp01((roles?.fieldConflicts.length ?? 0) / applicableRoleCount);

  // How thin the team's minority attacking stat is. Mixed attackers count on
  // both sides, so a team of them is maximally flexible and scores zero here —
  // the reason this counts threats rather than a majority, which would have
  // called an all-mixed team monochrome.
  //
  // The denominator is what a balanced team of this size would hold, which for a
  // singles bring of three is one: with three slots, a single off-stat threat is
  // enough to deny an opponent a free defensive commitment. That makes the term
  // effectively binary in singles and graded in doubles, and the cliff is in the
  // format rather than in the measure — with three members you either have a
  // second angle of attack or you do not.
  const memberStats = input.memberStats;
  const offensiveClasses = memberStats?.length === teamSize
    ? memberStats.map((stats) => getAttackerBias(stats))
    : null;
  const physicalThreats = offensiveClasses?.filter((bias) => bias !== 'special').length ?? 0;
  const specialThreats = offensiveClasses?.filter((bias) => bias !== 'physical').length ?? 0;
  const minorityThreats = Math.min(physicalThreats, specialThreats);
  const balancedMinority = Math.floor(teamSize / 2);
  const monochromeOffenseValue = offensiveClasses && balancedMinority > 0
    ? clamp01(1 - (minorityThreats / balancedMinority))
    : 0;
  const uncoveredWeakness = SYNERGY_PENALTY_WEIGHTS.uncoveredWeakness * uncoveredWeaknessValue;
  const uncoveredQuadrupleWeakness =
    SYNERGY_PENALTY_WEIGHTS.uncoveredQuadrupleWeakness * uncoveredQuadrupleValue;
  const sharedWeakness = SYNERGY_PENALTY_WEIGHTS.sharedWeakness * sharedWeaknessValue;
  const quadrupleWeakness = SYNERGY_PENALTY_WEIGHTS.quadrupleWeakness * quadrupleWeaknessValue;
  const sharedQuadrupleWeakness =
    SYNERGY_PENALTY_WEIGHTS.sharedQuadrupleWeakness * sharedQuadrupleValue;
  const spreadConflict = spreadConflictWeight * spreadConflictValue;
  const fieldConflict = SYNERGY_PENALTY_WEIGHTS.fieldConflict * fieldConflictValue;
  const monochromeOffense = SYNERGY_PENALTY_WEIGHTS.monochromeOffense * monochromeOffenseValue;
  const penalty = uncoveredWeakness + uncoveredQuadrupleWeakness + sharedWeakness +
    quadrupleWeakness + sharedQuadrupleWeakness + spreadConflict + fieldConflict +
    monochromeOffense;
  const unclampedScore = bonus - penalty;
  const score = Math.min(1, Math.max(-1, unclampedScore));

  if (collect) {
    const bonusTerm = (
      id: SynergyBonusTermId,
      weight: number,
      numerator: number,
      denominator: number,
      normalizedValue: number,
      contribution: number,
      facts: readonly string[]
    ): SynergyContribution<SynergyBonusTermId> => ({
      id, direction: 'bonus', weight, numerator, denominator, normalizedValue, contribution, facts
    });
    const penaltyTerm = (
      id: SynergyPenaltyTermId,
      weight: number,
      numerator: number,
      denominator: number,
      normalizedValue: number,
      contribution: number,
      facts: readonly string[]
    ): SynergyContribution<SynergyPenaltyTermId> => ({
      id, direction: 'penalty', weight, numerator, denominator, normalizedValue, contribution, facts
    });

    collect({
      status: 'scored',
      formatId: format.id,
      maxDistinctTypes,
      applicableRoleCount,
      bonusTerms: [
        bonusTerm('coverageBreadth', bonusWeights.coverageBreadth, coverage.uniqueCoverages, typeCount,
          coverageBreadthValue, coverageBreadth, sortedKeys(coverage.coverageCounts)),
        bonusTerm('resistanceBreadth', bonusWeights.resistanceBreadth, coverage.uniqueResistances, typeCount,
          resistanceBreadthValue, resistanceBreadth, sortedKeys(coverage.resistanceCounts)),
        bonusTerm('typeDiversity', bonusWeights.typeDiversity, typesTotal, maxDistinctTypes,
          typeDiversityValue, typeDiversity, []),
        bonusTerm('enabledSpread', bonusWeights.enabledSpread, coverage.enabledSpreadTypes.length,
          maxDistinctTypes, enabledSpreadValue, enabledSpread, [...coverage.enabledSpreadTypes].sort()),
        bonusTerm('supportRoles', bonusWeights.supportRoles, roles?.roles.length ?? 0,
          applicableRoleCount, supportRolesValue, supportRoles,
          [...(roles?.roles ?? [])].sort() as AbilityRole[])
      ],
      penaltyTerms: [
        penaltyTerm('uncoveredWeakness', SYNERGY_PENALTY_WEIGHTS.uncoveredWeakness,
          coverage.uncoveredWeaknesses.length, typeCount, uncoveredWeaknessValue, uncoveredWeakness,
          [...coverage.uncoveredWeaknesses].sort()),
        penaltyTerm('uncoveredQuadrupleWeakness', SYNERGY_PENALTY_WEIGHTS.uncoveredQuadrupleWeakness,
          coverage.uncoveredQuadrupleWeaknesses.length, typeCount, uncoveredQuadrupleValue,
          uncoveredQuadrupleWeakness, [...coverage.uncoveredQuadrupleWeaknesses].sort()),
        penaltyTerm('sharedWeakness', SYNERGY_PENALTY_WEIGHTS.sharedWeakness, sharedWeaknessNumerator,
          teamSize * 2, sharedWeaknessValue, sharedWeakness, [...coverage.sharedWeaknesses].sort()),
        penaltyTerm('quadrupleWeakness', SYNERGY_PENALTY_WEIGHTS.quadrupleWeakness,
          quadrupleWeaknessNumerator, teamSize, quadrupleWeaknessValue, quadrupleWeakness,
          sortedKeys(coverage.quadrupleWeaknessCounts)),
        penaltyTerm('sharedQuadrupleWeakness', SYNERGY_PENALTY_WEIGHTS.sharedQuadrupleWeakness,
          sharedQuadrupleNumerator, teamSize, sharedQuadrupleValue, sharedQuadrupleWeakness,
          [...coverage.sharedQuadrupleWeaknesses].sort()),
        penaltyTerm('spreadConflict', spreadConflictWeight, coverage.spreadConflicts.length,
          maxDistinctTypes, spreadConflictValue, spreadConflict, [...coverage.spreadConflicts].sort()),
        penaltyTerm('fieldConflict', SYNERGY_PENALTY_WEIGHTS.fieldConflict,
          roles?.fieldConflicts.length ?? 0, applicableRoleCount, fieldConflictValue, fieldConflict,
          [...(roles?.fieldConflicts ?? [])].sort()),
        penaltyTerm('monochromeOffense', SYNERGY_PENALTY_WEIGHTS.monochromeOffense,
          minorityThreats, balancedMinority, monochromeOffenseValue, monochromeOffense,
          offensiveClasses ? [...offensiveClasses].sort() : [])
      ],
      bonus,
      penalty,
      unclampedScore,
      score
    });
  }

  return score;
}

/**
 * Scores how well a team's members complement each other.
 *
 * @param input Coverage analysis plus the team shape needed to scale it.
 * @returns A value in -1..1, where negative means the gaps outweigh the synergy.
 */
export function scoreTeamSynergy(input: SynergyInput): number {
  return evaluateTeamSynergy(input);
}

/** Returns the exact weighted terms used by `scoreTeamSynergy`. */
export function getTeamSynergyBreakdown(input: SynergyInput): TeamSynergyBreakdown {
  let breakdown: TeamSynergyBreakdown | undefined;
  evaluateTeamSynergy(input, (value) => {
    breakdown = value;
  });
  return breakdown!;
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
