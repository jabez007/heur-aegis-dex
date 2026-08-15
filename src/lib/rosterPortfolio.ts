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
 * ## Two checks, neither of them the derivation
 *
 * **Supply.** The margin has to admit enough candidates for `selectRosterPortfolio`
 * to find genuinely different rosters; too tight and the loop below falls back to
 * near-duplicates, which defeats the feature. At 1.99 it inherits the 1.75 row:
 * at least 95% of scenarios offer two diverse options and at least 86% offer
 * three, against 83% and 60% at a margin of 1.
 *
 * **The exclusion ceiling.** A roster registers six and brings four, so its
 * worst member is never brought and reaches the score only through the brings it
 * would spoil. That caps what an entirely wasted slot can cost, so a margin at or
 * above the cap provably cannot exclude *anything* a sixth slot does. The old
 * value of 3 sat exactly on it, and the cost was visible: the test in
 * `useTeamBuilder.test.ts` that asserts a worthless sixth member is never offered
 * flipped four times across four consecutive recalibrations, measuring 3.010,
 * 2.950, 3.072 and 2.967. It measures 2.963 in doubles and 2.786 in singles now.
 *
 * This check is what caught the bad counterfactual. At 2.94 the margin had gone
 * *through* the singles ceiling and sat 0.02 below the doubles one, which would
 * have meant offering rosters with an entirely wasted slot in them. The check is
 * not a bound — it compares a real-pool median against a synthetic-fixture
 * maximum — but a derivation that walks through it is a derivation measuring
 * something other than what it claims. At 1.99 there is 0.80 of headroom against
 * the tighter of the two, restored to where it was when this constant was first
 * derived.
 *
 * Reasoned against a measurement rather than validated against how many
 * alternatives people actually pick — the standing of `MEMBER_WEIGHTS` and
 * `TYPE_MODULATION`. Rerun the script after anything that moves roster scores.
 */
export const ROSTER_ALTERNATIVE_SCORE_MARGIN = 1.99;
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
