import { describe, expect, it } from 'vitest';
import { ROSTER_ALTERNATIVE_SCORE_MARGIN, selectRosterPortfolio } from './rosterPortfolio';

const roster = (names: string[], score: number) => ({
  members: names.map((name) => ({ name })),
  score
});

describe('ROSTER_ALTERNATIVE_SCORE_MARGIN', () => {
  it('stays clear of what a wasted roster slot can cost', () => {
    // The derivation's binding constraint, pinned so a re-measurement cannot
    // quietly cross it. A roster registers six and brings four, so its worst
    // member is never brought and can only cost the score what the brings it
    // spoils are worth — measured at 2.950, 2.963, 2.967, 3.010 and 3.072 in
    // doubles across five recalibrations, and at 2.786 in singles, which the
    // `useTeamBuilder` test that depends on this does not exercise. A margin at
    // or above that provably cannot exclude any sixth member at all, which is
    // what the old value of 3 did.
    const lowestMeasuredWastedSlot = 2.786;

    expect(ROSTER_ALTERNATIVE_SCORE_MARGIN).toBeLessThan(lowestMeasuredWastedSlot);
    // Headroom was 0.84 when the margin was derived at 2.13 and is 0.16 now, so
    // this no longer asserts comfort — it asserts the constraint. The narrowing
    // is the finding, and it is argued on the constant: the two numbers are both
    // roughly one roster slot's worth of score, measured on different pools, so
    // they were always going to converge as the candidate pool grew. Read the
    // docblock before widening this to make a failure go away.
    expect(lowestMeasuredWastedSlot - ROSTER_ALTERNATIVE_SCORE_MARGIN).toBeGreaterThan(0.1);
  });

  it('is large enough to be worth filtering with', () => {
    // The other side of the trade, and no longer the tight one. Below roughly
    // one point the portfolio runs out of candidates and falls back to
    // near-duplicate rosters, which defeats the feature — measured at 64% of
    // scenarios offering two or more diverse options at a margin of 1, against
    // at least 98% at 2.63.
    expect(ROSTER_ALTERNATIVE_SCORE_MARGIN).toBeGreaterThan(1);
  });
});

describe('selectRosterPortfolio', () => {
  it('keeps the best roster first and excludes options outside the score margin', () => {
    // Straddling ROSTER_ALTERNATIVE_SCORE_MARGIN, which is one member's worth of
    // roster quality — see the derivation on the constant. Written against the
    // constant rather than against 2.13 so a re-measurement moves the fixture
    // with it instead of failing on a number nobody chose.
    const best = roster(['a', 'b', 'c'], 90);
    const near = roster(['a', 'd', 'e'], 90 - ROSTER_ALTERNATIVE_SCORE_MARGIN + 0.01);
    const low = roster(['f', 'g', 'h'], 90 - ROSTER_ALTERNATIVE_SCORE_MARGIN - 0.01);

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
