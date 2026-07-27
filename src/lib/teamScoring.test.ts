import { describe, expect, it } from 'vitest';
import { analyzeTeamCoverage } from './teamCoverage';
import { analyzeTeamRoles } from './abilityRoles';
import {
  COMPOSITE_WEIGHTS,
  MEMBER_WEIGHTS,
  SYNERGY_BONUS_WEIGHTS,
  composeTeamScore,
  scoreMemberQuality,
  scoreTeamSynergy
} from './teamScoring';
import { normalizeDamageFromScore, normalizeDamageToScore } from './pokedexScoring';

const statsOf = (overrides: Partial<Record<string, number>> = {}) => ({
  hp: 80, attack: 100, defense: 90, 'special-attack': 100, 'special-defense': 90, speed: 80,
  ...overrides
});

describe('teamScoring weights', () => {
  // Summed over every value rather than a hand-written list, so adding a weight
  // without rebalancing the others fails here instead of silently inflating the
  // achievable maximum.
  const sumWeights = (weights: Record<string, number>) =>
    Object.values(weights).reduce((total, weight) => total + weight, 0);

  it('keeps member weights on a unit scale so quality is always 0..1', () => {
    expect(sumWeights(MEMBER_WEIGHTS)).toBeCloseTo(1);
  });

  it('keeps synergy bonus weights on a unit scale', () => {
    expect(sumWeights(SYNERGY_BONUS_WEIGHTS)).toBeCloseTo(1);
  });

  it('splits the composite score entirely between quality and synergy', () => {
    expect(COMPOSITE_WEIGHTS.memberQuality + COMPOSITE_WEIGHTS.synergy).toBeCloseTo(1);
  });
});

describe('scoreMemberQuality', () => {
  it('returns a value within 0..1 even for stats above the ceilings', () => {
    const quality = scoreMemberQuality({
      stats: statsOf({ hp: 255, attack: 255, defense: 255, 'special-attack': 255, 'special-defense': 255, speed: 255 }),
      normalizedDamageToScore: 1,
      normalizedDamageFromScore: 0
    });

    expect(quality).toBeGreaterThan(0);
    expect(quality).toBeLessThanOrEqual(1);
  });

  it('discounts rather than erases stats behind a poor typing', () => {
    const stats = statsOf();
    const goodTyping = scoreMemberQuality({ stats, normalizedDamageToScore: 1, normalizedDamageFromScore: 0 });
    const badTyping = scoreMemberQuality({ stats, normalizedDamageToScore: 0, normalizedDamageFromScore: 1 });

    expect(badTyping).toBeLessThan(goodTyping);
    // A bad typing must not zero out the member's stats entirely.
    expect(badTyping).toBeGreaterThan(goodTyping * 0.5);
  });
});

describe('scoreTeamSynergy', () => {
  const synergyFor = (members: Parameters<typeof analyzeTeamCoverage>[0]) =>
    scoreTeamSynergy({
      coverage: analyzeTeamCoverage(members),
      typesTotal: members.length * 2,
      teamSize: members.length,
      typeCount: 18
    });

  it('rewards broad coverage and resistance over narrow', () => {
    const broad = synergyFor([
      { weaknesses: [], resistances: ['fire', 'water', 'grass'], coverages: ['rock', 'ice', 'steel'] },
      { weaknesses: [], resistances: ['ghost', 'dark'], coverages: ['fairy', 'bug'] }
    ]);
    const narrow = synergyFor([
      { weaknesses: [], resistances: ['fire'], coverages: ['rock'] },
      { weaknesses: [], resistances: ['fire'], coverages: ['rock'] }
    ]);

    expect(broad).toBeGreaterThan(narrow);
  });

  it('drives synergy negative when the team shares a quadruple weakness', () => {
    const shared = synergyFor([
      { weaknesses: ['fire'], quadruple_weaknesses: ['fire'], resistances: ['grass'], coverages: ['grass'] },
      { weaknesses: ['fire'], quadruple_weaknesses: ['fire'], resistances: ['water'], coverages: ['water'] }
    ]);

    expect(shared).toBeLessThan(0);
  });

  it('stays within -1..1 for pathological teams', () => {
    const awful = synergyFor([
      { weaknesses: ['fire', 'water'], quadruple_weaknesses: ['fire', 'water'], resistances: [], coverages: [] },
      { weaknesses: ['fire', 'water'], quadruple_weaknesses: ['fire', 'water'], resistances: [], coverages: [] },
      { weaknesses: ['fire', 'water'], quadruple_weaknesses: ['fire', 'water'], resistances: [], coverages: [] }
    ]);

    expect(awful).toBeGreaterThanOrEqual(-1);
    expect(awful).toBeLessThanOrEqual(1);
  });

  it('rewards a partner immunity that frees up a spread move', () => {
    const withImmunePartner = synergyFor([
      { types: ['ground'], weaknesses: ['water'], resistances: [], immunities: [], coverages: ['fire'] },
      { types: ['flying'], weaknesses: ['ice'], resistances: ['ground'], immunities: ['ground'], coverages: ['grass'] }
    ]);
    const withoutImmunePartner = synergyFor([
      { types: ['ground'], weaknesses: ['water'], resistances: [], immunities: [], coverages: ['fire'] },
      { types: ['grass'], weaknesses: ['ice'], resistances: ['ground'], immunities: [], coverages: ['grass'] }
    ]);

    expect(withImmunePartner).toBeGreaterThan(withoutImmunePartner);
  });

  it('penalises an attacking type with no safe partner', () => {
    const noSafePartner = synergyFor([
      { types: ['ground'], weaknesses: ['water'], resistances: [], immunities: [], coverages: ['fire'] },
      { types: ['fire'], weaknesses: ['ground'], resistances: [], immunities: [], coverages: ['grass'] }
    ]);
    const safePartner = synergyFor([
      { types: ['ground'], weaknesses: ['water'], resistances: [], immunities: [], coverages: ['fire'] },
      { types: ['fire'], weaknesses: ['rock'], resistances: [], immunities: [], coverages: ['grass'] }
    ]);

    expect(noSafePartner).toBeLessThan(safePartner);
  });

  it('rewards breadth of doubles support roles', () => {
    const coverage = analyzeTeamCoverage([
      { types: ['fire'], weaknesses: [], resistances: [], immunities: [], coverages: [] },
      { types: ['water'], weaknesses: [], resistances: [], immunities: [], coverages: [] }
    ]);
    const withRoles = scoreTeamSynergy({
      coverage,
      roles: analyzeTeamRoles([{ abilityName: 'intimidate' }, { abilityName: 'lightning-rod' }]),
      typesTotal: 2, teamSize: 2, typeCount: 18
    });
    const withoutRoles = scoreTeamSynergy({
      coverage,
      roles: analyzeTeamRoles([{ abilityName: 'blaze' }, { abilityName: 'torrent' }]),
      typesTotal: 2, teamSize: 2, typeCount: 18
    });

    expect(withRoles).toBeGreaterThan(withoutRoles);
  });

  it('penalises members fighting over the same field state', () => {
    const coverage = analyzeTeamCoverage([
      { types: ['fire'], weaknesses: [], resistances: [], immunities: [], coverages: [] },
      { types: ['water'], weaknesses: [], resistances: [], immunities: [], coverages: [] }
    ]);
    const clashing = scoreTeamSynergy({
      coverage,
      roles: analyzeTeamRoles([{ abilityName: 'drought' }, { abilityName: 'drizzle' }]),
      typesTotal: 2, teamSize: 2, typeCount: 18
    });
    const agreeing = scoreTeamSynergy({
      coverage,
      roles: analyzeTeamRoles([{ abilityName: 'drought' }, { abilityName: 'drought' }]),
      typesTotal: 2, teamSize: 2, typeCount: 18
    });

    expect(clashing).toBeLessThan(agreeing);
  });

  it('scores identically whether roles are omitted or empty', () => {
    const coverage = analyzeTeamCoverage([
      { types: ['fire'], weaknesses: [], resistances: [], immunities: [], coverages: [] },
      { types: ['water'], weaknesses: [], resistances: [], immunities: [], coverages: [] }
    ]);
    const omitted = scoreTeamSynergy({ coverage, typesTotal: 2, teamSize: 2, typeCount: 18 });
    const empty = scoreTeamSynergy({
      coverage, roles: analyzeTeamRoles([]), typesTotal: 2, teamSize: 2, typeCount: 18
    });

    expect(omitted).toBeCloseTo(empty);
  });

  it('returns a neutral score when the team shape is degenerate', () => {
    expect(scoreTeamSynergy({ coverage: analyzeTeamCoverage([]), typesTotal: 0, teamSize: 0, typeCount: 18 })).toBe(0);
  });
});

describe('composeTeamScore', () => {
  it('produces a 0..100 score', () => {
    expect(composeTeamScore([1], 1)).toBeCloseTo(100);
    expect(composeTeamScore([0], -1)).toBeCloseTo(0);
  });

  it('lets synergy outrank raw member quality', () => {
    // This is the property the old model lost: base stat totals ran to the
    // hundreds while synergy bonuses ran to the tens, so ranking among teams
    // that passed the filters was effectively base stat total.
    const strongButIncoherent = composeTeamScore([0.9, 0.9, 0.9], -0.6);
    const weakerButCohesive = composeTeamScore([0.5, 0.5, 0.5], 0.6);

    expect(weakerButCohesive).toBeGreaterThan(strongButIncoherent);
  });

  it('treats an empty team as zero quality rather than NaN', () => {
    expect(Number.isFinite(composeTeamScore([], 0))).toBe(true);
  });
});

describe('damage score normalization', () => {
  it('is independent of which other types are in the pool', () => {
    // Same raw score, same baseline, same normalized value — regardless of what
    // else the user has filtered in or out.
    expect(normalizeDamageFromScore(18, 18)).toBeCloseTo(normalizeDamageFromScore(18, 18));
    expect(normalizeDamageFromScore(18, 18)).toBeCloseTo(0.25);
    expect(normalizeDamageToScore(18, 18)).toBeCloseTo(0.5);
  });

  it('maps the formula extremes onto 0 and 1', () => {
    expect(normalizeDamageFromScore(0, 18)).toBeCloseTo(0);
    expect(normalizeDamageFromScore(72, 18)).toBeCloseTo(1);
    expect(normalizeDamageToScore(0, 18)).toBeCloseTo(0);
    expect(normalizeDamageToScore(36, 18)).toBeCloseTo(1);
  });

  it('clamps out-of-range scores and defaults unknown ones to the midpoint', () => {
    expect(normalizeDamageFromScore(-50, 18)).toBe(0);
    expect(normalizeDamageFromScore(500, 18)).toBe(1);
    expect(normalizeDamageFromScore(undefined, 18)).toBe(0.5);
    expect(normalizeDamageToScore(undefined, 18)).toBe(0.5);
  });
});
