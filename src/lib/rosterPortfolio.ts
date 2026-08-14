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
 * Measured 2026-08-14 by `npm run measure:alternative-margin` as the score cost
 * of replacing exactly one member of the best roster a pool produces with that
 * pool's median candidate: 129 such downgrades across 42 scenarios — seven
 * pools including five cups, both formats, and the seeded cases of one and two
 * locked favourites. The median is 2.13, with a p25 of 1.07 and a p75 of 3.37.
 * The spread is wide because what a member is worth depends on the pool, which
 * is why the middle of it is the number and not one of the tails.
 *
 * ## Two checks, neither of them the derivation
 *
 * **Supply.** The margin has to admit enough candidates for `selectRosterPortfolio`
 * to find genuinely different rosters; too tight and the loop below falls back to
 * near-duplicates, which defeats the feature. At 2.13 about 92% of scenarios
 * offer at least two diverse options and 80% offer three. Widening to 3 buys
 * 100% and 98% — but every one of those extra options comes from a cup too
 * narrow to supply diversity honestly, where the only way to find a different
 * roster is to accept a worse one.
 *
 * **The exclusion ceiling.** A roster registers six and brings four, so its
 * worst member is never brought and reaches the score only through the brings it
 * would spoil. That caps what an entirely wasted slot can cost at roughly three
 * points, so a margin at or above the cap provably cannot exclude *anything* a
 * sixth slot does. The old value of 3 sat exactly on it, and the cost was
 * visible: the test in `useTeamBuilder.test.ts` that asserts a worthless sixth
 * member is never offered flipped four times across four consecutive
 * recalibrations, measuring 3.010, 2.950, 3.072 and 2.967. At 2.13 that test has
 * 0.84 of headroom against the lowest of those, roughly seven times the drift
 * recalibration has ever caused, so it stops being a coin flip.
 *
 * Reasoned against a measurement rather than validated against how many
 * alternatives people actually pick — the standing of `MEMBER_WEIGHTS` and
 * `TYPE_MODULATION`. Rerun the script after anything that moves roster scores.
 */
export const ROSTER_ALTERNATIVE_SCORE_MARGIN = 2.13;
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
