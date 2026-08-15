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
 * replacing exactly one member of the best roster a pool produces with that
 * pool's median candidate, across 42 scenarios — seven pools including five
 * cups, both formats, and the seeded cases of one and two locked favourites.
 * The median is the number; the spread is wide because what a member is worth
 * depends on the pool, which is why the middle of it is taken and not a tail.
 *
 * | measured    | downgrades | p25  | **p50**  | p75  |
 * | ----------- | ---------- | ---- | -------- | ---- |
 * | 2026-08-14  | 129        | 1.07 | **2.13** | 3.37 |
 * | 2026-08-15  | 185        | 1.17 | **2.63** | 4.18 |
 *
 * The jump is a pool effect, not a scoring one, and most of it predates the
 * change it shipped with. Dropping the `maxDamageFromScore` filter took M-B from
 * 72 candidates to 147, which put more distance between the best candidate and
 * the median one, so downgrading a member costs more. That alone moved the
 * median to 2.27 and should have been caught then; allocating coverage slots by
 * what they buy took it the rest of the way.
 *
 * ## Two checks, neither of them the derivation
 *
 * **Supply.** The margin has to admit enough candidates for `selectRosterPortfolio`
 * to find genuinely different rosters; too tight and the loop below falls back to
 * near-duplicates, which defeats the feature. Supply rises with the margin, so
 * 2.63 inherits the 2.5 row: at least 98% of scenarios offer two diverse options
 * and at least 86% offer three. This check has stopped binding — it was the tight
 * side at 2.13 and is comfortable now.
 *
 * **The exclusion ceiling, which has become tight.** A roster registers six and
 * brings four, so its worst member is never brought and reaches the score only
 * through the brings it would spoil. That caps what an entirely wasted slot can
 * cost, so a margin at or above the cap provably cannot exclude *anything* a
 * sixth slot does. The old value of 3 sat exactly on it, and the cost was
 * visible: the test in `useTeamBuilder.test.ts` that asserts a worthless sixth
 * member is never offered flipped four times across four consecutive
 * recalibrations, measuring 3.010, 2.950, 3.072 and 2.967 — now 2.963, still
 * inside that band.
 *
 * Headroom against it has fallen from 0.84 to **0.33**, and to 0.16 against the
 * singles gap of 2.786, which that test does not exercise. Both still clear, and
 * the direction is worth stating plainly: the margin has moved most of the way
 * to the ceiling in one step, so the next pool change is likely to reach it.
 *
 * When it does, the thing to notice is that the check is not a bound. It
 * compares a median measured on the real 147-candidate pool against a maximum
 * measured on a synthetic eight-Pokemon fixture, and those two numbers sit near
 * each other because both are roughly one roster slot's worth of score, not
 * because either constrains the other. What it actually guards is whether one
 * unit test keeps passing. Crossing it is a reason to re-derive what "an
 * alternative" means, not a reason to hold the margin down by hand.
 *
 * Reasoned against a measurement rather than validated against how many
 * alternatives people actually pick — the standing of `MEMBER_WEIGHTS` and
 * `TYPE_MODULATION`. Rerun the script after anything that moves roster scores,
 * **including anything that changes the size of the candidate pool.**
 */
export const ROSTER_ALTERNATIVE_SCORE_MARGIN = 2.63;
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
