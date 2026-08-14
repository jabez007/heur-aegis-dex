import { describe, expect, it } from 'vitest';
import { selectRosterPortfolio } from './rosterPortfolio';

const roster = (names: string[], score: number) => ({
  members: names.map((name) => ({ name })),
  score
});

describe('selectRosterPortfolio', () => {
  it('keeps the best roster first and excludes options outside the score margin', () => {
    const best = roster(['a', 'b', 'c'], 90);
    const near = roster(['a', 'd', 'e'], 87);
    const low = roster(['f', 'g', 'h'], 86.9);

    expect(selectRosterPortfolio([best, near, low])).toEqual([best, near]);
  });

  it('prefers meaningful replacements over a slightly higher-scoring substitution', () => {
    const best = roster(['a', 'b', 'c', 'd', 'e', 'f'], 90);
    const oneReplacement = roster(['a', 'b', 'c', 'd', 'e', 'g'], 89.9);
    const twoReplacements = roster(['a', 'b', 'c', 'd', 'h', 'i'], 89.5);

    expect(selectRosterPortfolio([best, oneReplacement, twoReplacements], { limit: 2 }))
      .toEqual([best, twoReplacements]);
  });

  it('falls back to the strongest closer option when no distinct choice remains', () => {
    const best = roster(['a', 'b', 'c'], 90);
    const first = roster(['a', 'b', 'd'], 89);
    const second = roster(['a', 'b', 'e'], 88);

    expect(selectRosterPortfolio([best, first, second])).toEqual([best, first, second]);
  });

  it('maximizes distance from the closest roster already selected', () => {
    const best = roster(['a', 'b', 'c', 'd'], 90);
    const second = roster(['a', 'b', 'e', 'f'], 89);
    const closeToSecond = roster(['a', 'b', 'e', 'g'], 88.5);
    const spread = roster(['c', 'd', 'g', 'h'], 88);

    expect(selectRosterPortfolio([best, second, closeToSecond, spread], { limit: 3 }))
      .toEqual([best, second, spread]);
  });

  it('caps the number of alternatives', () => {
    const rosters = Array.from({ length: 10 }, (_, index) =>
      roster([`a-${index}`, `b-${index}`], 90 - (index * 0.1)));

    expect(selectRosterPortfolio(rosters)).toHaveLength(6);
  });
});
