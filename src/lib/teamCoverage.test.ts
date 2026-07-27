import { describe, expect, it } from 'vitest';
import { analyzeTeamCoverage } from './teamCoverage';

describe('analyzeTeamCoverage', () => {
  it('separates defensive answers from offensive ones', () => {
    // Nobody resists fire, but the second member hits fire super-effectively.
    const analysis = analyzeTeamCoverage([
      { weaknesses: ['fire'], resistances: ['grass'], coverages: ['water'] },
      { weaknesses: ['electric'], resistances: ['electric'], coverages: ['fire'] }
    ]);

    expect(analysis.defensivelyUncoveredWeaknesses).toEqual(['fire']);
    expect(analysis.uncoveredWeaknesses).toEqual([]);
  });

  it('reports a weakness with neither answer as uncovered under both definitions', () => {
    const analysis = analyzeTeamCoverage([
      { weaknesses: ['ground'], resistances: ['rock'], coverages: ['flying'] }
    ]);

    expect(analysis.defensivelyUncoveredWeaknesses).toEqual(['ground']);
    expect(analysis.uncoveredWeaknesses).toEqual(['ground']);
  });

  it('tallies shared weaknesses and quadruple weaknesses', () => {
    const analysis = analyzeTeamCoverage([
      { weaknesses: ['fire', 'rock'], quadruple_weaknesses: ['fire'], resistances: [], coverages: [] },
      { weaknesses: ['fire'], quadruple_weaknesses: ['fire'], resistances: [], coverages: [] },
      { weaknesses: ['water'], quadruple_weaknesses: [], resistances: [], coverages: [] }
    ]);

    expect(analysis.weaknessCounts).toEqual({ fire: 2, rock: 1, water: 1 });
    expect(analysis.sharedWeaknesses).toEqual(['fire']);
    expect(analysis.sharedQuadrupleWeaknesses).toEqual(['fire']);
    expect(analysis.uncoveredQuadrupleWeaknesses).toEqual(['fire']);
  });

  it('counts unique resistances and coverages across the team', () => {
    const analysis = analyzeTeamCoverage([
      { weaknesses: [], resistances: ['fire', 'grass'], coverages: ['water'] },
      { weaknesses: [], resistances: ['fire', 'steel'], coverages: ['water', 'ice'] }
    ]);

    expect(analysis.uniqueResistances).toBe(3);
    expect(analysis.uniqueCoverages).toBe(2);
  });

  it('tolerates members with missing profile fields', () => {
    const analysis = analyzeTeamCoverage([{}, { weaknesses: ['fire'] }]);

    expect(analysis.uncoveredWeaknesses).toEqual(['fire']);
    expect(analysis.uniqueResistances).toBe(0);
  });
});
