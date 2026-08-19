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
import { getStabPower } from './stabPower';
import { BATTLE_FORMATS, DEFAULT_BATTLE_FORMAT, type BattleFormat } from './battleFormats';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Puts a normalized stat term on its own reachable range rather than on 0..1.
 *
 * Every one of these terms has a floor well above zero — an unusable 85 Attack
 * collected 52% of the offence term before this — so a nominal 0..1 credited
 * every Pokemon for stats no Pokemon in the pool actually lacks. See
 * OBSERVED_STAT_TERMS.
 */
const rescaleStatTerm = (value: number, { min, max }: { min: number; max: number }): number =>
  clamp01((clamp01(value) - min) / (max - min));

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
 * Speed is treated as linearly good, which is wrong for a format where Trick
 * Room makes low Speed an asset. Correcting that needs move data the scan does
 * not have, so the bias is recorded here rather than papered over — and the
 * weight below is set low partly because of it.
 *
 * These describe the real balance because the terms under them are rescaled
 * against the ranges they occupy first — see OBSERVED_STAT_TERMS.
 *
 * ## Why speed fell 0.20 -> 0.15 and bulk rose 0.45 -> 0.50
 *
 * Because the paragraphs above described an intent the numbers did not deliver.
 * `npm run measure:ranking-terms` moves one input from its 5th to its 95th
 * percentile across the pool being ranked and reports the points of
 * `candidatePriority` between them. At 0.45 / 0.20, speed was the **second
 * largest influence on the Browser's order**, in a tool built to rank defensive
 * typings, and it was second largest while carrying the smallest nominal weight
 * of the three:
 *
 * | input            | before | after |
 * | ---------------- | ------ | ----- |
 * | effective bulk   | 13.75  | 14.76 |
 * | speed            | 12.31  | 9.23  |
 * | effective offence| 8.88   | 8.88  |
 * | defensive typing | 4.54   | 6.30  |
 * | STAB power       | 5.33   | 5.33  |
 *
 * That is not a contradiction. A weight applies to a *rescaled* term, and speed
 * occupies nearly all of its range — p05..p95 spans 0.62 of it — while a typing
 * occupies under half of its own. The weakest-understood term in the model was
 * deciding the most, because base Speed spreads further across real Pokemon than
 * anything else here does. See `TYPE_MODULATION` for the same argument from the
 * other side.
 *
 * Bulk takes the whole 0.05. Defensive typing modulates the bulk term rather
 * than standing beside it, so the two move together and part of typing's rise
 * comes from here rather than from `TYPE_MODULATION.defensive` — which is why
 * raising bulk is the cheaper of the two ways to raise typing.
 *
 * Speed is reduced rather than removed. Outspeeding decides games; the objection
 * is to its size, not its presence. At 0.15 it still separates Pokemon whose
 * bulk and typing are close, which is the job it should have.
 *
 * ## Why not further, which is the more useful half of this note
 *
 * 0.57 / 0.08 was measured first and is not what shipped. Together with a
 * defensive modulation of 0.7 it produced exactly the order this project's
 * premise asks for — bulk, then defensive typing, then offence, with speed
 * fifth — and **broke three assertions in `scoringValidation.test.ts`**,
 * including the one that holds gate three of that same premise: a team of walls
 * whose best attacking stats top out at 100 scored above a team of bulky
 * attackers. A model that ranks defensive typing highly enough to prefer
 * Pokemon that cannot KO has stopped expressing the premise rather than
 * expressing it harder.
 *
 * The frontier those assertions drew, measured by sweeping:
 *
 * | guard                                | binds at                       |
 * | ------------------------------------ | ------------------------------ |
 * | Azumarill/Blastoise stay close       | bulk >= 0.52, or def mod > 0.55|
 * | bulky attackers beat walls (team)    | bulk >= 0.55, or def mod >= 0.7|
 * | Feraligatr beats Skarmory on quality | def mod >= 0.65                |
 *
 * ## That frontier was measured with firepower switched off, and is wrong
 *
 * Superseded 2026-08-18. `scoringValidation.test.ts` called
 * `scoreMemberQuality(mon(name))` with a `PokemonEntry`, which carries no
 * `varietyName` — so every quality assertion bounding these weights scored at
 * full firepower for every Pokemon. Production never does; see the `quality`
 * helper there. The table above is what the fixture said with FIREPOWER_MODULATION
 * effectively at 0 for the pool it was measuring, and two of its three rows do
 * not survive the correction:
 *
 * - **Feraligatr beats Skarmory** is gone. Skarmory's Brave Bird at 120 off 80
 *   Attack out-damages Liquidation at 85 off 105 — 9,600 to 8,925 — so the
 *   judgement was wrong rather than the model, and it was resting on "25 more
 *   Attack" as though Attack were damage.
 * - **Azumarill/Blastoise** has inverted. With firepower on, Blastoise leads,
 *   and the old symmetric expression stopped constraining a bulk *ceiling* at
 *   all: it reads 13.0 at these weights, 25.6 at bulk 0.54, 97.1 at 0.57 and
 *   2.5e+08 at 0.60, because an absolute-gap guard reports its best number
 *   exactly where two Pokemon swap places. It is now a directional floor and
 *   binds on Speed instead.
 *
 * The frontier as it actually stands, re-swept by running the fixture at each
 * point rather than by reasoning about it:
 *
 * | guard                                | binds at                        |
 * | ------------------------------------ | ------------------------------- |
 * | Azumarill floor (Speed it can answer)| speed >= 0.21                   |
 * | bulky attackers beat walls (team)    | bulk >= 0.55 at def mod 0.5     |
 * | discounts rather than erases         | def mod >= 0.70                 |
 *
 * The Speed weight is now bounded from *below* by this fixture, and 0.15 sits
 * inside that bound with 0.20 as the last passing value — the weight this file
 * shipped until 2026-08-17, reached there from measured term swings and reached
 * here from a judgement about Belly Drum.
 *
 * ## A correction to the row this table used to carry
 *
 * It read `def mod >= 0.75 at bulk 0.50`, from a sweep that changed the
 * modulation and ran the fixture without re-measuring COMPOSITE_BOUNDS. Those
 * bounds are downstream of the modulation — deepening it narrows the quality
 * range, and refreshing them re-expands what the composite score can see — so
 * the sweep was reading an intermediate state that would never ship. Refreshed
 * at every point, the team gate does not bind until 0.85, and the guard that
 * actually stops this is `teamScoring.test.ts`'s erase check at 0.70. The
 * ordering rule that catches this is already written down under
 * OBSERVED_STAT_TERMS: measure the stat terms, then the composite bounds, then
 * the roster margin. A frontier sweep has to obey it too.
 *
 * `TYPE_MODULATION.defensive` was raised 0.5 -> 0.6 on 2026-08-18 against this
 * frontier; see that constant.
 *
 * ## Why speed then fell 0.15 -> 0.10, and why the other 0.05 had to split
 *
 * Same day. Speed was still second in the ranking that a bulky-defensive tool
 * produces, which is the objection that took it from 0.20 to 0.15 and had not
 * been answered — only reduced. At 0.10 it is fourth:
 *
 * | input             | 0.35/0.50/0.15 | 0.38/0.52/0.10 |
 * | ----------------- | -------------- | -------------- |
 * | effective bulk    | 14.13          | 14.69          |
 * | speed             | **9.23** (2nd) | **6.15** (4th) |
 * | effective offence | 8.88           | 9.64           |
 * | defensive typing  | 7.56           | 7.87           |
 * | STAB power        | 5.33           | 5.78           |
 *
 * Premise share 51.4% -> 54.7%, alignment 0.706 -> 0.707, top-20 overlap
 * 12/20 -> 13/20, and 133 of the 146 entries in a default view change position.
 *
 * The interesting part is where the freed 0.05 went, because it was not a
 * preference. Every attempt to give it to bulk failed the team gate, and the
 * reason is a property of the fixture nobody had noticed: **the "bulky
 * attackers" team is fast and the wall team is slow.** Garchomp, Sneasler,
 * Lucario and Kingambit sit against Skarmory, Forretress, Klefki and Clefable.
 * So cutting the Speed weight hurts the side the gate exists to protect, and
 * only more offence weight pays it back.
 *
 * Measured as the gate's margin in composed team points, with COMPOSITE_BOUNDS
 * refreshed at every point:
 *
 * | weights        | margin | verdict                             |
 * | 0.35/0.50/0.15 | 0.692  | the setting this replaced           |
 * | 0.375/0.505/0.12| 0.825 | *rises* — offence outruns the cut   |
 * | 0.38/0.52/0.10 | 0.471  | **taken**                           |
 * | 0.39/0.53/0.08 | 0.312  |                                     |
 * | 0.375/0.525/0.10| 0.283 |                                     |
 * | 0.37/0.53/0.10 | 0.095  | knife edge                          |
 * | 0.35/0.55/0.10 | fails  | all of it to bulk                   |
 *
 * The second row is the cleanest statement of the mechanism: raising offence by
 * 0.025 while cutting speed by 0.03 leaves the gate *safer* than before. The
 * gate is not a bulk ceiling; it is a constraint on the offence-to-defence
 * balance that both of the other two weights move.
 *
 * 0.38 / 0.52 / 0.10 keeps 68% of the margin it started with. The alternatives
 * that push speed lower all trade that for less than 1.5 points of extra swing
 * on a term already in fourth place, and the 0.095 row is the knife edge this
 * file has twice refused.
 *
 * Speed at 0.10 still swings 6.15 points — more than STAB power, more than
 * offensive typing, three times the coverage tiebreak. "Outspeeding decides
 * games; the objection is to its size, not its presence" still holds, and the
 * Azumarill floor at 0.21 still bounds it from the other side, so the weight now
 * sits between two arguments rather than against one.
 *
 * ## The ladder pays back what the modulation cost, with interest
 *
 * `TYPE_MODULATION.defensive` going to 0.6 cost correlation, and it was shipped
 * knowing that: defensive typing on its own anti-correlates with win rate at
 * -0.159 on the 166,311 battles `measure:usage-correlation` reads. Speed
 * anti-correlates too, at -0.114, so cutting its weight moves the other way.
 * Across the pair:
 *
 * | measure                        | before | after 0.6 | after the cut |
 * | `scoreMemberQuality` vs usage  | 0.255  | 0.253     | 0.253         |
 * | `scoreMemberQuality` vs win    | 0.277  | 0.270     | **0.293**     |
 * | `candidatePriority` vs usage   | 0.253  | 0.246     | 0.249         |
 * | `candidatePriority` vs win     | 0.277  | 0.251     | **0.273**     |
 *
 * The win-rate column is the highest this model has recorded. That is a pleasant
 * result and not the reason for the change — the premise ordering was, and it
 * would have shipped against a worse number the same way the modulation did.
 * Recorded because the honest version of "usage is the secondary check" includes
 * reporting it when it agrees, not only when it is being overruled.
 *
 * Reasoned against measured term swings and bounded by the validation fixture,
 * not validated against match outcomes. Rerun `measure:composite-bounds`,
 * `measure:alternative-margin` and `measure:ranking-terms` after touching these.
 */
export const MEMBER_WEIGHTS = {
  offense: 0.38,
  bulk: 0.52,
  speed: 0.1
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
 * | offense | 0.320 | 0.992   | 0.403          | 0.38    |
 * | bulk    | 0.264 | 0.785   | 0.438          | 0.52    |
 * | speed   | 0.133 | 1.000   | 0.159          | 0.10    |
 *
 * The two right-hand columns are as of 2026-08-18, at `MEMBER_WEIGHTS`
 * 0.38 / 0.52 / 0.10; the floors and ceilings are the measurement this constant
 * exists for and have not moved since 2026-08-13. Read the sections below
 * against the weights they were written under, 0.35 / 0.45 / 0.20.
 *
 * The gap between the last two columns is the whole point of this constant and
 * has never closed: Speed realizes 0.159 of the composite against a nominal
 * 0.10, and bulk realizes 0.438 against 0.52. A weight is what you ask for; a
 * realized share is what the pool gives you, and Speed keeps taking more than it
 * is given because base Speed spreads further across real Pokemon than either
 * other stat. That is also why cutting the Speed weight by a third moves the
 * Browser's order as much as it does.
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
 *
 * ## The drift the section above declined to close, closed
 *
 * That section recorded bulk realizing 0.355 against a nominal 0.45 and speed
 * 0.298 against 0.20, and left it because closing it meant changing
 * `MEMBER_WEIGHTS` without a mandate. `measure:ranking-terms` supplied the
 * mandate on 2026-08-17 by measuring the same gap from the other end — as points
 * of the Browser's actual ordering rather than as a share of the quality term —
 * and the weights moved to 0.35 / 0.57 / 0.08.
 *
 * The realized shares are now 0.379 / 0.491 / 0.130. The drift is smaller in
 * absolute terms and points the same way it always did, because it is a property
 * of how far each term spreads and not of the weights: speed spreads widest, so
 * it over-realizes at any weight, and bulk spreads least, so it under-realizes at
 * any weight. Every rerun since 2026-08-13 has reproduced the six floors and
 * ceilings exactly, which is what says this is the pool's shape rather than a
 * mismeasurement.
 *
 * Rerun 2026-08-17; the six bounds reproduced exactly again.
 */
export const OBSERVED_STAT_TERMS = {
  offense: { min: 0.32, max: 0.9923 },
  bulk: { min: 0.2642, max: 0.7849 },
  speed: { min: 0.1333, max: 1 }
} as const;

/**
 * Expected power of the best STAB move in the pool, at both extremes.
 *
 * Measured by `npm run measure:usage-correlation` over every variety Regulation
 * M-B permits, not over the browser's filtered view — the filters are a choice
 * about what to display and the metagame does not respect them. 232 of 236
 * varieties have a usable STAB move; the four without are handled below.
 *
 * The range is narrow, 77..120 for a ratio of 1.56, and that is the honest shape
 * of the thing rather than a defect. A third of the pool sits at exactly 120,
 * because 120 is what a good STAB move is worth and a great many Pokemon have
 * one. What this term separates is the bottom: Beartic at 77 and Pinsir, Scizor
 * and Lycanroc at 80 against everything with a real move.
 *
 * See `stabPower.ts` for what "usable" excludes and why an unrestricted maximum
 * over the movepool is the wrong measure.
 */
export const OBSERVED_STAB_POWER = { min: 77, max: 120 } as const;

/**
 * What a support role is worth when it comes from a move rather than an ability.
 *
 * The two are the same capability at different prices. Lightning Rod redirects
 * every turn and costs nothing; Follow Me redirects because one of four
 * moveslots holds it, and that slot is not attacking, not Protecting and not
 * providing coverage. Counting them equally would say a Pokemon can support for
 * free, which is the whole reason `analyzeTeamRoles` returns the two lists
 * separately instead of merging them.
 *
 * Set to a half: a discretionary moveslot is roughly half of what a competitive
 * set has spare once STAB and a coverage move are placed.
 *
 * ## The sweep found nothing, and the reason is the interesting part
 *
 * Swept 0 to 1 against both harnesses. Neither moves:
 *
 * | credit | vs usage | vs win rate |
 * | ------ | -------- | ----------- |
 * | 0.00   | 0.245    | 0.255       |
 * | 0.50   | 0.240    | 0.250       |
 * | 1.00   | 0.245    | 0.252       |
 *
 * Corviknight ranks 44th at every value; Pelipper moves one place and Whimsicott
 * moves one place the wrong way. Against real tournament teams the
 * composition-matched AUC goes from 65.8% to 65.9%.
 *
 * That is not the data failing. It is two structural ceilings:
 *
 * 1. **In `candidatePriority`, the channel is a rounding error.**
 *    `CANDIDATE_WEIGHTS.supportRole` is 1 point against a quality term spanning
 *    roughly 30, deliberately — it fell 4 to 2 to 1 to hold the invariant that a
 *    role never offsets a quadruple weakness. A team-dependent role scores 0.5 of
 *    that, and this halves it again, so speed control is worth **0.25 points**.
 *    Widening it is a change to that invariant, not to this constant.
 * 2. **In `scoreTeamSynergy`, the validation cannot see it.** The
 *    composition-matched baseline draws from the same Pokemon the real teams use,
 *    so it inherits the same utility roles. That test isolates *combinations*,
 *    and a utility role is a member property.
 *
 * So this is kept at a reasoned half and recorded as unvalidated, rather than
 * tuned against a number that does not respond. What the table does buy today is
 * generation: the beam search prunes to `DEFAULT_CANDIDATE_LIMIT` by
 * `candidatePriority`, and with filters opened Pelipper sits at 214 and
 * Whimsicott at 198 — cut before team synergy, which weighs roles properly, ever
 * sees them. That is the failure the `supportRole` docblock warns about, and
 * this is the data needed to fix it whenever that weight is revisited.
 */
export const MOVE_ROLE_CREDIT = 0.5;

/**
 * What a move-sourced role is worth to a Prankster carrier.
 *
 * ## Splitting the constant above into the two things it bundles
 *
 * `MOVE_ROLE_CREDIT` discounts a move-sourced role for two reasons at once, and
 * pricing Prankster forces them apart. One is the **moveslot**: a Pokemon that
 * spends a slot on Tailwind is not spending it on an attack, and no ability
 * charges that. The other is **delivery**: an ability fires the moment its holder
 * is on the field, while a status move only works if the Pokemon is still alive
 * and untaunted when its turn comes, and the Pokemon that want these moves are
 * mostly slow.
 *
 * Prankster refunds the second and not the first. It gives status moves +1
 * priority, so Grimmsnarl at 60 Speed sets screens before anything happens to
 * it — as reliably as an ability, for the same slot cost. That is why this sits
 * between `MOVE_ROLE_CREDIT` and 1 rather than at either: half the discount was
 * timing and is bought back, half was the slot and is not.
 *
 * It applies to every move-sourced role the model has, which is not a
 * coincidence worth glossing over. Tailwind, Trick Room, Reflect, Light Screen,
 * Wide Guard, Quick Guard, Ally Switch, Follow Me, Rage Powder, Will-O-Wisp and
 * Spore are all status moves. The tables this reads were selected for supplying
 * a support role, and support in this format is overwhelmingly status — so the
 * ability that accelerates status accelerates all of it.
 *
 * Reasoned, not measured, and small in reach: three Pokemon in a default scan
 * carry Prankster. Recorded as an even split of a constant that was itself
 * reasoned, which is honest about being two guesses deep rather than one.
 */
export const PRANKSTER_ROLE_CREDIT = 0.75;

/**
 * How strongly firepower modulates the attacking stat it applies to.
 *
 * ## Why the offence axis has three factors and not two
 *
 * Damage in the actual game is a stat, a type matchup and a move. This model had
 * the first two — `effectiveOffense` measures the stat, `normalizedDamageToScore`
 * measures the typing — and nothing at all for the third, so two Pokemon with the
 * same Attack and the same typing scored identically even when one leads with
 * Close Combat and the other has nothing above Brick Break. Firepower is that
 * missing factor, and it enters the same way typing does: scaling the term
 * between (1 - modulation) and 1 rather than multiplying it outright, so a weak
 * best move discounts a big attacking stat instead of erasing it.
 *
 * ## Why 0.4, and the first constant here with outside support
 *
 * Set to match `TYPE_MODULATION` because it is the same kind of thing in the
 * same place: a property of what the attack *does*, modifying the stat that
 * throws it. Two peers on one axis should not be weighted differently without a
 * reason, and there is no reason.
 *
 * What is new is that the choice was checked against data from outside this
 * codebase — 166,311 ladder battles of this regulation, via
 * `npm run measure:usage-correlation`. Sweeping the depth against how much each
 * Pokemon actually wins:
 *
 * | depth   | vs usage | vs win rate |
 * | ------- | -------- | ----------- |
 * | 0.0     | 0.213    | 0.196       |
 * | 0.1     | 0.228    | 0.217       |
 * | 0.2     | 0.227    | 0.246       |
 * | 0.3     | 0.229    | 0.264       |
 * | **0.4** | **0.221**| **0.271**   |
 * | 0.5     | 0.222    | 0.272       |
 * | 0.6     | 0.217    | 0.264       |
 *
 * Depth 0 is the model as it stood, and it is the worst row. Win rate is not
 * significantly correlated at all until this term is switched on, and the
 * optimum is a plateau across 0.4..0.5 — so the value picked by analogy landed
 * inside the range picked by measurement, which is the outcome worth having.
 * Taking the argmax instead would be fitting a constant to 91 data points.
 *
 * Two limits on how much that supports. The sample is one ladder, one fortnight,
 * and 91 matched Pokemon; and the correlation it improves is still weak in
 * absolute terms — 0.271 is a better ranking, not a good one. This raises the
 * term from "reasoned" to "reasoned and not contradicted", which is a lower bar
 * than it sounds and still more than any other constant here has.
 *
 * ## The validation fixture could not see this term until 2026-08-18
 *
 * `scoringValidation.test.ts` scored member quality without a `varietyName`, so
 * every judgement in the file bounding these constants was made with firepower
 * resolved to 1 for every Pokemon. Switching it on moved three assertions and
 * rewrote the frontier recorded under MEMBER_WEIGHTS.
 *
 * That the fixture was blind to it is a fixture bug, not evidence against the
 * constant, and the direction matters: this is the one value here with support
 * from outside the codebase, and the judgements it collided with have none. So
 * the judgements moved. Recorded because the reverse — softening a measured
 * constant until unmeasured judgements pass — is the tempting repair and is
 * exactly backwards.
 *
 * ## Singles is unvalidated, and the reason is worth reading
 *
 * The measurement is doubles. No comparable singles dataset was reachable when
 * this was written — the one public singles ranking is a six-voter community
 * poll — so this constant is applied to singles on the strength of a doubles
 * result.
 *
 * That transfers further than it sounds, and for an uncomfortable reason. The
 * script measures the two formats' member rankings agreeing at **0.9994**, with
 * a median rank move of zero, because `candidatePriority` separates them through
 * exactly one flag: whether redirection and ally-protection roles count. So
 * firepower provably is not doing something different in singles that nobody
 * checked — but only because almost nothing here does anything different in
 * singles. Real singles and doubles metagames share few of their strongest
 * Pokemon, and a model that ranks them near-identically cannot be right about
 * both. Format differentiation lives in `scoreTeamSynergy` and
 * `COMPOSITE_BOUNDS`; at the member level there is essentially none, and that is
 * a gap this constant inherits rather than creates.
 */
export const FIREPOWER_MODULATION = 0.4;

/**
 * How strongly a typing modulates the raw stats it applies to, per side.
 *
 * Typing scales its stat term between (1 - modulation) and 1 rather than
 * multiplying it outright. A poor offensive typing should discount a big
 * attack stat, not erase it.
 *
 * The two sides are deliberately unequal; the last section explains why. Read
 * the history below as being about the offensive value, which has not moved.
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
 *
 * ## Those four figures are potential swings, and the realized ones are smaller
 *
 * 10.7 against 12.1 is the swing across the *full* 0..1 of each normalized
 * score. `npm run measure:ranking-terms` measures what the inputs actually do
 * across the pool being ranked, and the two readings disagree sharply — because
 * a Pokemon's typing occupies less of its range than its Speed does:
 *
 * | input            | potential | realized (p05..p95, M-B) |
 * | ---------------- | --------- | ------------------------ |
 * | bulk             | 12.7      | 13.75                    |
 * | speed            | 12.1      | 12.31                    |
 * | offence          | 10.6      | 8.88                     |
 * | defensive typing | 10.7      | **4.54**                 |
 *
 * Speed realizes nearly all of its potential and defensive typing realizes 42%
 * of its own, so the term this project is built on decides 8.7% of its Browser's
 * order against Speed's 23.7%. Pool-relative bounds recovered part of that —
 * the realized swing was 3.83 before them — and the rest is not a normalization
 * error: it is that real defensive typings cluster, while base Speed spans 20 to
 * 142. Closing it further means changing this constant or `MEMBER_WEIGHTS`,
 * deliberately, with the measurement in hand rather than the potential swings.
 *
 * ## Why it became two constants, and why the defensive one is 0.5
 *
 * It was one number on the argument that the two typings are peers doing the
 * same job on opposite sides of the score. They are not peers of this project.
 * The premise names defensive typing and does not name offensive typing: the
 * tool exists to find bulky Pokemon with strong defensive typings and good
 * offensive **STAB**, and offensive typing is a breadth measure that arrived
 * later as the mirror of the defensive one. One constant made "raise defensive
 * typing" impossible to ask for without also raising a term nobody asked to
 * raise.
 *
 * It also made the raise cost more than it should. Both factors enter
 * multiplicatively, so lifting the modulation lowers the modulator's value at
 * the median and shrinks the *stat* swing under it. Raising the shared constant
 * to 0.7 buys 4.16 points of defensive typing and pays 2.79 of it straight back
 * out of effective offence and STAB power — and STAB power is a premise term.
 * Raising only the defensive half buys the same 4.16 and the offence axis does
 * not move at all:
 *
 * | input            | 0.4 both | 0.7 both | 0.4 / 0.7 |
 * | ---------------- | -------- | -------- | --------- |
 * | effective bulk   | 16.88    | 14.84    | 14.84     |
 * | defensive typing | 5.55     | 9.71     | 9.71      |
 * | effective offence| 8.88     | 7.14     | **8.88**  |
 * | STAB power       | 5.33     | 4.28     | **5.33**  |
 * | offensive typing | 3.52     | 6.16     | **3.52**  |
 *
 * (The three columns are a sweep at `MEMBER_WEIGHTS` 0.35 / 0.55 / 0.10, so they
 * differ only in this constant. Those are not the shipping weights — see the
 * shipping figures below, and `MEMBER_WEIGHTS` for why 0.55 / 0.10 was not
 * taken either.)
 *
 * The table is the argument for splitting. It is **not** the argument for 0.7,
 * which is where the sweep started and is not what shipped.
 *
 * ## Why it was 0.5, and why three of those four reasons are gone
 *
 * The case for stopping at 0.5 was: `scoringValidation.test.ts` rejected
 * everything above it — at 0.65 the model put Skarmory above Feraligatr on
 * quality, and at 0.7 with bulk at 0.57 a team of walls outscored a team of
 * bulky attackers — the Azumarill/Blastoise pair cleared by 16% at 0.5 against
 * 3% at 0.55, and the modulator spanning 0.5..1 left the worst typing half its
 * bearer's bulk.
 *
 * Three of those four did not survive 2026-08-18:
 *
 * - **Skarmory above Feraligatr is no longer a failure.** Brave Bird at 120 off
 *   80 Attack out-damages Liquidation at 85 off 105 — 9,600 to 8,925 — so the
 *   judgement was treating Attack as damage. The assertion was re-argued onto
 *   Swampert, a pair with matched STAB power.
 * - **The Azumarill/Blastoise pair never constrained this from above.** Its
 *   expression measured distance to a crossover, so it reported its best number
 *   exactly where the two swapped places. It is now a directional floor on the
 *   Speed weight and has nothing to say about this constant.
 * - **The team-of-walls result was measured against stale COMPOSITE_BOUNDS.**
 *   Those bounds are downstream of this modulation: deepening it narrows the
 *   quality range, and re-measuring re-expands the differences the composite
 *   score sees. Sweeping without refreshing them was measuring an intermediate
 *   state nobody would ship. Refreshed at every point, that gate does not bind
 *   until 0.85.
 *
 * ## What binds now, which is a design claim rather than a judgement
 *
 * The fourth reason is the one that survived, and it turns out to be encoded
 * already: `teamScoring.test.ts` asserts that a bad typing **discounts rather
 * than erases** the stats behind it, at `badTyping > goodTyping * 0.5`. That is
 * this constant's own stated shape, written as a test, and it is now the
 * binding guard:
 *
 * | depth | bad/good | team-of-walls margin | clears erase by |
 * | ----- | -------- | -------------------- | --------------- |
 * | 0.50  | 0.5977   | 0.863                | 20%             |
 * | 0.60  | 0.5440   | 0.692                | **8.8%**        |
 * | 0.65  | 0.5171   | 0.604                | 3.4%            |
 * | 0.70  | 0.4903   | 0.511                | fails           |
 * | 0.75  | 0.4634   | 0.407                | fails           |
 * | 0.85  | ~0.42    | ~0.0                 | fails           |
 *
 * 0.6 is taken and 0.65 is not, on the precedent this file already set: 0.55 was
 * rejected at 3% clearance for being a knife edge rather than a setting, and
 * 0.65 clears by 3.4%. 0.6 clears by 8.8% and leaves the team gate — the premise
 * gate that a roster which cannot KO does not win — clearing by 0.692 of a
 * margin that was 0.863 before the change.
 *
 * One argument for going further was considered and not taken. The erase guard
 * scores a Pokemon at `normalizedDamageFromScore` of exactly 1, and no Pokemon
 * in a default view reaches it — the pool maxes at 0.672, so the *realized*
 * floor at 0.6 is 0.597 rather than the nominal 0.40. By that reading the guard
 * is an unanchored absolute of the kind this repo has removed elsewhere. It was
 * left standing because the opened view does reach 1.000, the validation fixture
 * is deliberately scoped to the unfiltered ranking, and relitigating a second
 * guard in the same change as spending the headroom the first one freed is how
 * a model ends up with no guards at all.
 *
 * At 0.6 defensive typing swings 7.56 points against bulk's 14.13 — able to
 * decide between close Pokemon, still unable to overturn a large bulk gap, which
 * is the shape this constant has always claimed. It is now 14.4% of the
 * Browser's order against 12.1% at 0.5 and 8.7% before the split.
 *
 * The offensive half stays at 0.4 and keeps its argument-by-analogy with
 * `FIREPOWER_MODULATION`, which is now a real analogy rather than a shared
 * variable: both sit on the offence axis, and that axis is unchanged.
 *
 * ## The shipping figures
 *
 * At `MEMBER_WEIGHTS` 0.38 / 0.52 / 0.10 and 0.4 / 0.6 here, `measure:
 * ranking-terms` reads:
 *
 * | input              | pts   | share | at 0.5 | before the split |
 * | ------------------ | ----- | ----- | ------ | ---------------- |
 * | effective bulk     | 14.69 | 28.3% | 28.4%  | 26.4%            |
 * | effective offence  | 9.64  | 18.6% | 17.1%  | 17.1%            |
 * | defensive typing   | 7.87  | 15.2% | 12.1%  | 8.7%             |
 * | speed              | 6.15  | 11.9% | 17.8%  | 23.7%            |
 * | STAB power         | 5.78  | 11.2% | 10.3%  | 10.2%            |
 * | offensive typing   | 3.82  | 7.4%  | 6.8%   | 6.8%             |
 * | reachable coverage | 2.37  | 4.6%  | 4.6%   | 4.2%             |
 * | support role       | 1.50  | 2.9%  | 2.9%   | 2.9%             |
 *
 * (The "at 0.5" column is this constant at 0.5 under the *old* weights, so it
 * differs from the shipping column by both changes. The three premise terms
 * decide 54.7% of the order against 50.9% then and 45.4% before the split;
 * premise alignment is 0.707 against 0.706 and 0.634; top-20 overlap 13/20
 * against 12/20.)
 *
 * Note what the offence column does across a change that raised defensive typing
 * by 1.26 points: nothing. That is the split doing its job — the whole cost is
 * paid out of the bulk term this modulates, which is the term it is supposed to
 * come out of.
 *
 * ## Speed was still second, and this lever could not fix it
 *
 * At 0.6 with the old weights, defensive typing needed 9.23 points to pass speed
 * and reached 7.56. Extrapolating the sweep it would have needed a depth near
 * 0.735 — well past where the erase guard fails at 0.70 — so the premise's
 * ordering was not reachable on this constant at any depth its own design claim
 * permits.
 *
 * `MEMBER_WEIGHTS` was the lever, and it was pulled the same day: speed 0.15 to
 * 0.10, which drops it to fourth. Defensive typing is third, above speed and
 * below offence, which is the order the premise asks for except that offence and
 * defensive typing are the wrong way round. Closing *that* gap needs defensive
 * typing above 9.64, which is 0.735 again and still on the wrong side of the
 * erase guard. So the note stands in a narrower form: this constant got
 * defensive typing past speed by making room, not by out-swinging it, and it
 * cannot pass offence at all.
 *
 * ## The ladder disagrees, and that was priced in
 *
 * `measure:usage-correlation` after the change: `candidatePriority` against
 * usage 0.253 -> 0.246, against win rate 0.277 -> 0.251. Both fell.
 *
 * This is not a surprise and not a reason to revert. On the same 166,311
 * battles, defensive typing on its own correlates with win rate at **-0.159** —
 * a better defensive typing predicts a slightly *worse* record in this
 * fortnight's metagame. Weighting it more therefore has to cost correlation,
 * arithmetically, whatever else it does.
 *
 * That trade is the project's stated order of priorities rather than an
 * accident. The premise is a preference about what the Browser should surface,
 * usage is a description of what one ladder played over two weeks, and a Pokemon
 * that does poorly today can do well tomorrow as the field around it changes.
 * Premise alignment rose 0.683 -> 0.706 in the same change. Where the two
 * measures point opposite ways this model follows the premise, which is exactly
 * why `measure-usage-correlation` documents itself as the secondary check.
 *
 * The contrast with FIREPOWER_MODULATION is worth holding onto. That constant
 * was kept because the ladder supported it and nothing in the premise objected.
 * This one is moved because the premise asks for it and the ladder's objection
 * is small, understood, and about a different question. Neither is "the data
 * decides"; both are the same rule applied to different evidence.
 *
 * One thing the sweep established that is worth keeping: this constant
 * **redistributes within the premise rather than growing it**. Holding
 * `MEMBER_WEIGHTS` fixed and moving the shared modulation across 0.4, 0.55 and
 * 0.7 left the premise share at exactly 55.5% every time — defensive typing rose
 * and bulk and STAB power fell by the same total. Only `MEMBER_WEIGHTS` moves
 * that number. Which of the two premise terms leads is what this constant sets.
 */
export const TYPE_MODULATION = {
  offensive: 0.4,
  defensive: 0.6
} as const;

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
 *
 * ## Re-measured for firepower
 *
 * `FIREPOWER_MODULATION` added a third factor to the offence axis, so quality
 * had to be taken again. Both formats move down at both ends — doubles
 * 0.1557..0.6155 to **0.1511..0.6130**, singles 0.1367..0.6264 to
 * **0.1346..0.6245** — and moving down at *both* ends is the shape this
 * particular term must produce. Firepower is a multiplier that never exceeds 1,
 * so it can only subtract; the ceiling barely moves because the best Pokemon
 * mostly have a 120-power STAB and keep the full multiplier, while the floor
 * falls further because the Pokemon already at the bottom tend to be the ones
 * with nothing to click.
 *
 * The narrowing is smaller than the offensive-census rerun above and for the
 * same underlying reason: a third of the pool sits at the top of the firepower
 * range, so the term reprices the tail rather than the whole distribution.
 * `OBSERVED_STAT_TERMS` is untouched and could not have moved — firepower
 * multiplies the offence term after it is rescaled, rather than entering it.
 *
 * Both synergy maxima unchanged for the sixth consecutive rerun, and necessarily
 * so: quality does not read synergy. Doubles sampled 0.7863 against its recorded
 * 0.8124 and keeps it; singles hit 0.8247 exactly.
 *
 * ## Re-measured for move-sourced support roles, and nothing moved
 *
 * `speed-control` joined the role vocabulary and `analyzeTeamRoles` began
 * reporting roles a Pokemon can fill with a move. That changes the support-role
 * term in two opposing directions at once — the breadth denominator grows from
 * five roles to six, while move-sourced roles add to the numerator — so the
 * rerun was mandatory rather than optional.
 *
 * **All four numbers are unchanged.** Quality could not move: it does not read
 * roles at all. Both synergy maxima sampled *below* what is recorded — singles
 * 0.8139 against 0.8247, doubles 0.7883 against 0.8124 — and the widen-only rule
 * keeps the recorded pair, now for the seventh consecutive measurement.
 *
 * Sampling below is the expected shape here and worth saying so it is not read
 * as the term doing nothing. A sixth role widens the denominator for every team,
 * and the teams that set the maximum are the ones already covering the roles
 * they can; a role most of them cannot fill lowers their share slightly. The
 * effect on the *middle* is the opposite and larger: the doubles median rises
 * from 0.0881 to 0.1007.
 *
 * ## Re-measured for weather abusers, and nothing moved again
 *
 * Sand Rush and its kin became a seventh role, so the breadth denominator grew
 * once more and the rerun was mandatory. Quality is untouched for the same
 * structural reason as last time, and both synergy maxima sampled below what is
 * recorded — singles 0.8074 against 0.8247, doubles 0.7812 against 0.8124 —
 * keeping the pair for an **eighth** consecutive measurement.
 *
 * Two reruns in a row where every number holds is worth stating rather than
 * passing over. These bounds have absorbed a firepower term, a Palafin
 * correction, move-sourced roles and now weather abusers without moving, which
 * is what a well-set bound is supposed to do: the middle of the distribution
 * shifts and the extremes are held by teams that were already at them.
 *
 * ## Re-measured for screens and status infliction — a third time, unchanged
 *
 * Two more roles, taking the vocabulary to nine, and still nothing moves.
 * Quality cannot; both synergy maxima sampled below the recorded pair again
 * (singles 0.8185 against 0.8247, doubles 0.7850 against 0.8124) for a **ninth**
 * consecutive measurement.
 *
 * The medians keep climbing while the maxima hold — doubles from 0.0881 through
 * 0.0962 to 0.1031 across the three role additions — which is exactly the shape
 * to expect and worth stating so the stability is not misread as inertia. Each
 * new role is one more thing an ordinary team can be credited for, so the middle
 * rises; the teams setting the maximum were already covering what they could,
 * and a wider denominator offsets what they gain.
 *
 * ## Re-measured for pool-relative typing bounds
 *
 * `damageBounds.ts` stopped normalizing the two typing scores against every
 * profile the game can express and started bounding them over the Pokemon a
 * regulation can field, so `scoreMemberQuality` produces different numbers and
 * these had to be taken again.
 *
 * Quality rises at both ends — doubles 0.1511..0.6130 to **0.1553..0.6333**,
 * singles 0.1346..0.6245 to **0.1374..0.6443** — and rising at both ends is the
 * shape this particular change must produce. The defensive floor moved up (the
 * worst profile a real M-B Pokemon presents is milder than the worst the lattice
 * can express, so every Pokemon's defensive term improves) while the ceiling did
 * not (Aurorus and Avalugg-Hisui are exactly as bad as the lattice's worst, so
 * nothing at the top was rescaled away).
 *
 * **`OBSERVED_STAT_TERMS` did not move and could not have**, which is worth
 * stating because the ordering constraint above says to check: the three stat
 * terms are rescaled before typing touches them, and typing enters through
 * `TYPE_MODULATION` afterwards. The rerun reproduced all six numbers exactly.
 *
 * Both synergy maxima unchanged for the tenth consecutive rerun — singles
 * sampled 0.8185 against the recorded 0.8247, doubles 0.7850 against 0.8124 —
 * and necessarily so, since quality does not read synergy.
 *
 * ### The script was measuring one thing and normalizing against another
 *
 * Found while making the change above, and it moves these numbers more than the
 * change did. `measure-composite-bounds.mjs` built its types through
 * `getBaseTypes(BASE, weights)`, which takes no census, so every
 * `damage_to_score` it scored was counted against the **chart** census and then
 * normalized against **census-derived** bounds. `measure-stab-power.mjs` carries
 * a comment warning about exactly this — "a census that does not reach here
 * silently produces chart-weighted offensive scores while every label says
 * otherwise" — and this script had been doing it since the census was
 * introduced.
 *
 * So every COMPOSITE_BOUNDS measurement taken between the offensive-census work
 * and 2026-08-17 was read off a formula the app does not run. The correction is
 * worth 0.006 at the doubles ceiling against the 0.014 the bounds change itself
 * was worth, in the same direction — small, and the point is that nothing said
 * it was there. A bound measured on the wrong scale looks exactly like one
 * measured on the right scale.
 *
 * Measured 2026-08-17, with the census reaching the type construction.
 *
 * ## Re-measured for the speed/bulk transfer and the split modulation
 *
 * `MEMBER_WEIGHTS` moved to 0.35 / 0.50 / 0.15 and `TYPE_MODULATION` became a
 * pair at 0.4 offensive / 0.5 defensive, so quality is a different function
 * again.
 *
 * Both quality ranges **widen at the bottom and are flat at the top** — doubles
 * 0.1553..0.6333 to **0.1457..0.6328**, singles 0.1374..0.6443 to
 * **0.1251..0.6426**. The floors fell by 0.010 and 0.012 while the ceilings
 * moved 0.0005 and 0.0017, and that is the shape a deeper defensive modulation
 * has to produce. Taking it from 0.4 to 0.5 drops the multiplier's floor from
 * 0.6 to 0.5,
 * so the worst defensive typings lose more of their bulk term than they did and
 * the bottom of the pool falls away. The ceiling barely moves because a Pokemon
 * at the *good* end of the defensive score was already near a multiplier of 1
 * and there is nothing above it to gain.
 *
 * That is the cost of the change stated in the one place it shows up as a
 * number: the pool spreads out at the bad end, which is what a stronger typing
 * signal means, and it is why this bound has to be retaken rather than left.
 *
 * The rejected 0.57 / 0.08 with a 0.7 modulation was measured too, and shows the
 * same effect four times over — doubles 0.1292, singles 0.1058. Recorded because
 * it is the clearest available evidence that the floor movement tracks the
 * modulation depth rather than anything else in the change.
 *
 * `OBSERVED_STAT_TERMS` did not move again, for the same reason as the entry
 * above: the stat terms are rescaled before any of this applies. Six numbers
 * reproduced exactly. Their *realized shares* did move, and are recorded there.
 *
 * Both synergy maxima unchanged for an eleventh rerun — singles sampled 0.8185
 * against 0.8247, doubles 0.7850 against 0.8124.
 *
 * Measured 2026-08-17.
 */
export const COMPOSITE_BOUNDS = {
  doubles: {
    quality: { min: 0.1336, max: 0.6256 },
    synergy: { min: -1, max: 0.8124 }
  },
  singles: {
    quality: { min: 0.1115, max: 0.6390 },
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
  /**
   * PokeAPI variety name, used to look up how hard its best STAB move hits.
   *
   * Omitting it, or passing a name the table has never heard of, scores the
   * Pokemon at full firepower rather than none. Absence here means the table
   * does not know, and a model that penalized what it has not been told would
   * make missing data look like weakness — the four varieties in the pool with
   * no usable STAB move at all are handled the same way, and deliberately.
   */
  varietyName?: string;
}

/**
 * How much attacking stat a Pokemon has, on the pool-relative 0..1 scale the
 * offence term inside `scoreMemberQuality` uses.
 *
 * Exported because a second caller needs the same number and must not compute
 * its own. `candidatePriority` prices reachable coverage by it: a move that can
 * be learned is only a threat if something can be hurt with it, and the two
 * places that ask "how hard does this hit" have to agree on the answer or the
 * ranking contradicts the quality score it is built on.
 *
 * This is the stat alone. It deliberately excludes the two things the offence
 * term multiplies it by:
 *
 * - `offensiveTyping`, because that measures STAB reach, and non-STAB coverage
 *   is precisely the complement of it. Folding it in here would reintroduce the
 *   double count `coverageBeyondStab` was written to remove.
 * - `firepower`, because that is the base power of the best *STAB* move, and a
 *   coverage move does not get STAB. The coverage table records only that a
 *   qualifying move exists at `COVERAGE_MOVE_MIN_POWER` or better, so there is
 *   no honest per-move power to substitute.
 *
 * @param stats Base stats of the form the Pokemon fights in.
 * @param abilityName Selected ability, whose offence multiplier applies as it does in member quality.
 * @returns The rescaled offence term, 0..1.
 */
export function offenseStatTerm(stats: PokemonStats, abilityName?: string): number {
  const ability = getQualityMultipliers(abilityName, stats);
  return rescaleStatTerm(
    (effectiveOffense(stats) / STAT_CEILINGS.offense) * ability.offense,
    OBSERVED_STAT_TERMS.offense
  );
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

  // Each term is put on its own reachable range, not on 0..1 — see
  // `rescaleStatTerm` and OBSERVED_STAT_TERMS.
  const offense = offenseStatTerm(stats, member.abilityName);
  const bulk = rescaleStatTerm(
    (hpAdjustedBulk(stats) / STAT_CEILINGS.bulk) * ability.bulk,
    OBSERVED_STAT_TERMS.bulk
  );
  const speed = rescaleStatTerm(
    (stats.speed / STAT_CEILINGS.speed) * ability.speed,
    OBSERVED_STAT_TERMS.speed
  );

  const modulate = (depth: number, quality: number) =>
    (1 - depth) + (depth * clamp01(quality));
  const offensiveTyping = modulate(TYPE_MODULATION.offensive, normalizedDamageToScore);
  const defensiveTyping = modulate(TYPE_MODULATION.defensive, 1 - normalizedDamageFromScore);

  // The third factor on the offence axis, beside the stat and the typing: how
  // hard the move it would actually click hits. Unknown scores as full credit
  // rather than none — see `varietyName`.
  const stabPower = getStabPower(member.varietyName, stats);
  const firepower = stabPower === null || stabPower <= 0
    ? 1
    : (1 - FIREPOWER_MODULATION) + (FIREPOWER_MODULATION * clamp01(
      (stabPower - OBSERVED_STAB_POWER.min) / (OBSERVED_STAB_POWER.max - OBSERVED_STAB_POWER.min)
    ));

  return clamp01(
    (MEMBER_WEIGHTS.offense * offense * offensiveTyping * firepower) +
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
  // Move-sourced roles count for less than ability-sourced ones. Lightning Rod
  // redirects every turn for nothing; Follow Me redirects because one of four
  // moveslots was spent, and that slot is not attacking.
  // Prankster-backed roles are counted at the higher credit and then removed
  // from the ordinary tally, so a role is paid once at the rate it earned.
  const pranksterRoleCount = roles?.pranksterRoles.length ?? 0;
  const supportRoleCount = (roles?.roles.length ?? 0) +
    (MOVE_ROLE_CREDIT * ((roles?.moveRoles.length ?? 0) - pranksterRoleCount)) +
    (PRANKSTER_ROLE_CREDIT * pranksterRoleCount);
  const supportRolesValue = clamp01(supportRoleCount / applicableRoleCount);
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
        bonusTerm('supportRoles', bonusWeights.supportRoles, supportRoleCount,
          applicableRoleCount, supportRolesValue, supportRoles,
          [...(roles?.roles ?? []), ...(roles?.moveRoles ?? [])].sort() as AbilityRole[])
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
