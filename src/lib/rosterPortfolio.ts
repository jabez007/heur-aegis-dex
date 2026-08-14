export const ROSTER_ALTERNATIVE_SCORE_MARGIN = 3;
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
