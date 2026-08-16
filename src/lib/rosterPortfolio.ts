/**
 * How far behind the best a roster may score and still be offered as an
 * alternative. One roster member's worth of quality, measured.
 *
 * ## Why a member is the right unit
 *
 * An alternative has to replace at least `MINIMUM_ROSTER_REPLACEMENTS` members
 * to count as one, so the question this answers is how much those replacements
 * may give up before the roster stops being an equal choice and becomes a worse
 * one. The natural unit is what a single member contributes: set the margin
 * there and an alternative swapping two or more members may still only give up
 * what one member is worth, so the swaps are close to lateral. Set it higher and
 * "alternative" quietly starts meaning "worse roster".
 *
 * Measured by `npm run measure:alternative-margin` as the score cost of
 * replacing exactly one member of the best roster a pool produces with the best
 * candidate not already on it, across 42 scenarios — seven pools including five
 * cups, both formats, and the seeded cases of one and two locked favourites.
 * The median is the number; the spread is wide because what a member is worth
 * depends on the pool, which is why the middle of it is taken and not a tail.
 *
 * | measured   | counterfactual        | p25  | **p50**  | p75  |
 * | ---------- | --------------------- | ---- | -------- | ---- |
 * | 2026-08-14 | pool median           | 1.07 | **2.13** | 3.37 |
 * | 2026-08-15 | pool median           | 1.17 | **2.63** | 4.18 |
 * | 2026-08-15 | pool median           | 1.33 | **2.94** | 4.57 |
 * | 2026-08-15 | best off-roster       | 0.96 | **1.99** | 3.36 |
 * | 2026-08-15 | best off-roster       | 1.01 | **2.05** | 4.00 |
 * | 2026-08-15 | best off-roster       | 1.25 | **2.49** | 4.70 |
 * | 2026-08-15 | best off-roster       | 1.16 | **2.31** | 3.94 |
 * | 2026-08-16 | best off-roster       | 1.06 | **2.06** | 3.55 |
 *
 * ## The counterfactual was wrong, and the drift is how it showed
 *
 * The first three rows are the same measurement on a growing pool, and the drift
 * has no scoring change behind it worth that size. Replacing a member with the
 * pool's *median* candidate describes a downgrade no alternative ever makes: the
 * portfolio's alternatives come out of the same beam search, off the same top of
 * the pool, and never reach down to the 74th-best of 147. Worse, the size of
 * that downgrade tracks the size of the pool, because a bigger pool has a worse
 * middle. Dropping the `maxDamageFromScore` filter took M-B from 72 candidates
 * to 147 and walked this constant from 2.13 to 2.94 while nothing about what an
 * alternative *is* had changed.
 *
 * The best off-roster candidate is the swap the next alternative actually makes,
 * and it moves the right way: a bigger pool has a *better* next-best candidate,
 * so one member is worth less, not more. The number is anchored to the part of
 * the pool the portfolio uses.
 *
 * The fourth row is the regulation-aware offensive score, and the 0.06 it moved
 * is the corrected counterfactual earning its keep: a scoring change that
 * reorders the browser moves this constant by a rounding error, where the old
 * one walked 0.5 on a pool-size change that meant nothing at all.
 *
 * The fifth is regulation-aware *team coverage*, and 0.44 is the largest honest
 * move this constant has made. It is not drift. Synergy is two thirds of a
 * roster's score and it had been pricing every type the same; charging real
 * prices spread the scores apart, so one member is genuinely worth more than it
 * was. A downgrade costs more when the thing being downgraded is measured
 * better.
 *
 * ## Two checks, neither of them the derivation
 *
 * **Supply.** The margin has to admit enough candidates for `selectRosterPortfolio`
 * to find genuinely different rosters; too tight and the loop below falls back to
 * near-duplicates, which defeats the feature. At 2.06 it inherits the 2 row:
 * at least 93% of scenarios offer two diverse options and at least 86% offer
 * three, against 71% and 29% at a margin of 1.
 *
 * **The exclusion ceiling.** A roster registers six and brings four, so its
 * worst member is never brought and reaches the score only through the brings it
 * would spoil. That caps what an entirely wasted slot can cost, so a margin at or
 * above the cap provably cannot exclude *anything* a sixth slot does. The old
 * value of 3 sat exactly on it, and the cost was visible: the test in
 * `useTeamBuilder.test.ts` that asserts a worthless sixth member is never offered
 * flipped four times across four consecutive recalibrations, measuring 3.010,
 * 2.950, 3.072 and 2.967.
 *
 * This check is what caught the bad counterfactual. At 2.94 the margin had gone
 * *through* the singles ceiling and sat 0.02 below the doubles one, which would
 * have meant offering rosters with an entirely wasted slot in them. The check is
 * not a bound — it compares a real-pool median against a synthetic-fixture
 * maximum — but a derivation that walks through it is a derivation measuring
 * something other than what it claims.
 *
 * The seventh row is firepower entering member quality, and it moves this
 * constant *down*, 2.49 to 2.31. That is the first correction to walk it away from the
 * ceiling rather than toward it, and the mechanism is worth recording because it
 * is the opposite of the coverage rerun above. Charging real prices for type
 * weaknesses spread roster scores apart, so a member was worth more; firepower
 * is a multiplier capped at 1 that mostly discounts the *weak* end of the pool,
 * which compresses the candidates a beam search actually reaches into. When the
 * next-best off-roster candidate is closer in score, replacing one member costs
 * less.
 *
 * The last row is move-sourced support roles entering team synergy, moving this
 * from 2.31 to 2.06 — the second consecutive fall, and the same mechanism as the
 * first. Anything that lets more of the pool score well compresses the gap
 * between a roster and its best replacement, and 130 varieties gained a role
 * they did not have.
 *
 * The ceilings re-measure at 3.009 in doubles and 2.825 in singles, so 2.06
 * clears the tighter of them by **0.765**. The previous value cleared by 0.335
 * and the assertion in `rosterPortfolio.test.ts` had been loosened to admit it;
 * the loosened form is kept rather than tightened back, because it is anchored
 * to observed drift and re-tightening it on a favourable measurement is how a
 * threshold ends up tracking the data instead of bounding it.
 *
 * The round 0.5 that assertion used was never derived; it was the headroom that
 * happened to exist, rounded down. What the check is actually protecting against
 * is a recalibration walking the margin over the ceiling, so the honest unit is
 * observed drift in the ceiling itself. Across seven measurements that is 2.786,
 * 2.825, 2.950, 2.963, 3.009, 3.010 and 3.072 — the singles pair spans 0.04 and
 * the doubles run spans 0.12. The clearance is asserted as a multiple of that
 * largest recorded drift instead of against a round number, so the check scales
 * with how much the ceiling has actually been seen to move. It stood at 2.8x
 * when the margin was 2.49, 4.3x at 2.31, and stands at 6.4x now, so crossing
 * would take several consecutive worst-case recalibrations all in the same
 * direction.
 *
 * Reasoned against a measurement rather than validated against how many
 * alternatives people actually pick — the standing of `MEMBER_WEIGHTS` and
 * `TYPE_MODULATION`. Rerun the script after anything that moves roster scores.
 */
export const ROSTER_ALTERNATIVE_SCORE_MARGIN = 2.06;
export const ROSTER_PORTFOLIO_LIMIT = 6;
export const MINIMUM_ROSTER_REPLACEMENTS = 2;

interface RosterPortfolioCandidate {
  members: readonly { name: string }[];
  score: number;
}

export interface RosterPortfolioOptions {
  scoreMargin?: number;
  minimumReplacements?: number;
  limit?: number;
}

const replacementDistance = (
  left: RosterPortfolioCandidate,
  right: RosterPortfolioCandidate
): number => {
  const rightNames = new Set(right.members.map((member) => member.name));
  const shared = left.members.filter((member) => rightNames.has(member.name)).length;
  return Math.max(left.members.length, right.members.length) - shared;
};

/**
 * Keeps the strongest result first, then prefers near-best rosters that replace
 * meaningfully different members. Closer options remain as a fallback when the
 * search did not find enough distinct choices.
 */
export function selectRosterPortfolio<T extends RosterPortfolioCandidate>(
  rosters: readonly T[],
  options: RosterPortfolioOptions = {}
): T[] {
  if (rosters.length === 0) return [];

  const scoreMargin = Math.max(0, options.scoreMargin ?? ROSTER_ALTERNATIVE_SCORE_MARGIN);
  const minimumReplacements = Math.max(0, options.minimumReplacements ?? MINIMUM_ROSTER_REPLACEMENTS);
  const limit = Math.max(0, Math.floor(options.limit ?? ROSTER_PORTFOLIO_LIMIT));
  if (limit === 0) return [];

  const bestScore = rosters[0].score;
  const remaining = rosters
    .slice(1)
    .filter((roster) => bestScore - roster.score <= scoreMargin);
  const selected = [rosters[0]];

  while (selected.length < limit && remaining.length > 0) {
    const distances = remaining.map((candidate) => Math.min(
      ...selected.map((chosen) => replacementDistance(candidate, chosen))
    ));
    const hasDistinctCandidate = distances.some((distance) => distance >= minimumReplacements);
    let nextIndex = 0;

    if (hasDistinctCandidate) {
      for (let index = 1; index < remaining.length; index++) {
        if (distances[index] > distances[nextIndex]) nextIndex = index;
      }
    }

    selected.push(remaining.splice(nextIndex, 1)[0]);
  }

  return selected;
}
