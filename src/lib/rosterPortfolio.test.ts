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
    // This assertion has already earned its keep once. A recalibration walked
    // the margin to 2.94 — past the singles gap and 0.02 short of the doubles
    // one — and that is how the derivation's counterfactual was found to be
    // measuring a downgrade no alternative makes. See the constant. The right
    // response was to fix what was measured, not to widen this line.
    expect(lowestMeasuredWastedSlot - ROSTER_ALTERNATIVE_SCORE_MARGIN).toBeGreaterThan(0.5);
  });

  it('is large enough to be worth filtering with', () => {
    // The other side of the trade. Below roughly one point the portfolio runs
    // out of candidates and falls back to near-duplicate rosters, which defeats
    // the feature — measured at 83% of scenarios offering two or more diverse
    // options at a margin of 1 and 60% offering three, against at least 95% and
    // 86% at 1.99.
    expect(ROSTER_ALTERNATIVE_SCORE_MARGIN).toBeGreaterThan(1);
  });
});

describe('selectRosterPortfolio', () => {
  it('keeps the best roster first and excludes options outside the score margin', () => {
    // Straddling ROSTER_ALTERNATIVE_SCORE_MARGIN, which is one member's worth of
    // roster quality — see the derivation on the constant. Written against the
    // constant rather than against a literal so a re-measurement moves the fixture
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
    // Spread across the margin rather than across fixed points, so a
    // re-measurement moves the fixture with it. All three are inside it.
    const step = ROSTER_ALTERNATIVE_SCORE_MARGIN / 3;
    const best = roster(['a', 'b', 'c'], 90);
    const first = roster(['a', 'b', 'd'], 90 - step);
    const second = roster(['a', 'b', 'e'], 90 - (2 * step));

    expect(selectRosterPortfolio([best, first, second])).toEqual([best, first, second]);
  });

  it('maximizes distance from the closest roster already selected', () => {
    const step = ROSTER_ALTERNATIVE_SCORE_MARGIN / 4;
    const best = roster(['a', 'b', 'c', 'd'], 90);
    const second = roster(['a', 'b', 'e', 'f'], 90 - step);
    const closeToSecond = roster(['a', 'b', 'e', 'g'], 90 - (2 * step));
    const spread = roster(['c', 'd', 'g', 'h'], 90 - (3 * step));

    expect(selectRosterPortfolio([best, second, closeToSecond, spread], { limit: 3 }))
      .toEqual([best, second, spread]);
  });

  it('caps the number of alternatives', () => {
    const rosters = Array.from({ length: 10 }, (_, index) =>
      roster([`a-${index}`, `b-${index}`], 90 - (index * 0.1)));

    expect(selectRosterPortfolio(rosters)).toHaveLength(6);
  });
});
