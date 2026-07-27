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

  describe('doubles spread safety', () => {
    // The canonical case: a Ground attacker paired with a Levitate or Flying
    // partner. Earthquake goes from "hits my own side" to free to click.
    const groundAttacker = { types: ['ground'], weaknesses: ['water'], resistances: [], immunities: [], coverages: [] };

    it('enables a spread type when a partner is immune to it', () => {
      const analysis = analyzeTeamCoverage([
        groundAttacker,
        { types: ['flying'], weaknesses: ['electric'], resistances: ['ground'], immunities: ['ground'], coverages: [] }
      ]);

      expect(analysis.enabledSpreadTypes).toEqual(['ground']);
      expect(analysis.spreadConflicts).toEqual([]);
    });

    it('does not enable a spread type when the partner merely resists it', () => {
      // Resisting Earthquake at 0.5x still means eating it. Only 0x is free.
      const analysis = analyzeTeamCoverage([
        groundAttacker,
        { types: ['grass'], weaknesses: ['fire'], resistances: ['ground'], immunities: [], coverages: [] }
      ]);

      expect(analysis.enabledSpreadTypes).toEqual([]);
    });

    it('flags a conflict only when no partner is a safe pairing', () => {
      const noSafePartner = analyzeTeamCoverage([
        groundAttacker,
        { types: ['fire'], weaknesses: ['ground'], resistances: [], immunities: [], coverages: [] }
      ]);
      expect(noSafePartner.spreadConflicts).toContain('ground');

      // Doubles puts one ally on the field at a time, so a single safe partner
      // is enough to make the spread type usable.
      const oneSafePartner = analyzeTeamCoverage([
        groundAttacker,
        { types: ['fire'], weaknesses: ['ground'], resistances: [], immunities: [], coverages: [] },
        { types: ['flying'], weaknesses: ['ice'], resistances: ['ground'], immunities: ['ground'], coverages: [] }
      ]);
      expect(oneSafePartner.spreadConflicts).not.toContain('ground');
      expect(oneSafePartner.enabledSpreadTypes).toContain('ground');
    });

    it('reports nothing for a solo team rather than a vacuous bonus', () => {
      // With no partner, "every partner is immune" is trivially true. Guarding
      // this stops a one-member team collecting a free spread bonus.
      const analysis = analyzeTeamCoverage([groundAttacker]);

      expect(analysis.enabledSpreadTypes).toEqual([]);
      expect(analysis.spreadConflicts).toEqual([]);
    });

    it('treats a partner immune to ally moves as safe against every spread type', () => {
      // Telepathy blocks the ally's damage whatever its type, so it enables the
      // attacker's whole STAB set rather than one matching immunity.
      const analysis = analyzeTeamCoverage([
        { types: ['ground', 'fire'], weaknesses: ['water'], resistances: [], immunities: [], coverages: [] },
        { types: ['psychic'], weaknesses: ['ground', 'fire'], resistances: [], immunities: [], coverages: [], immuneToAllyMoves: true }
      ]);

      expect(analysis.enabledSpreadTypes).toEqual(expect.arrayContaining(['ground', 'fire']));
      // The partner is weak to both, but cannot be hit by them, so neither is a
      // conflict.
      expect(analysis.spreadConflicts).toEqual([]);
    });

    it('keys on the attacker own types, not its coverage list', () => {
      // The member hits rock super-effectively but attacks with water. A partner
      // weak to rock is irrelevant; what matters is the type actually clicked.
      const analysis = analyzeTeamCoverage([
        { types: ['water'], weaknesses: [], resistances: [], immunities: [], coverages: ['rock', 'fire'] },
        { types: ['ice'], weaknesses: ['rock'], resistances: [], immunities: ['water'], coverages: [] }
      ]);

      expect(analysis.enabledSpreadTypes).toEqual(['water']);
      expect(analysis.spreadConflicts).toEqual([]);
    });
  });

  it('tolerates members with missing profile fields', () => {
    const analysis = analyzeTeamCoverage([{}, { weaknesses: ['fire'] }]);

    expect(analysis.uncoveredWeaknesses).toEqual(['fire']);
    expect(analysis.uniqueResistances).toBe(0);
  });
});
