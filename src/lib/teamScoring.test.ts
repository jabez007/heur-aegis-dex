import { describe, expect, it } from 'vitest';
import { analyzeTeamCoverage } from './teamCoverage';
import { analyzeTeamRoles } from './abilityRoles';
import { BATTLE_FORMATS } from './battleFormats';
import {
  COMPOSITE_WEIGHTS,
  MEMBER_WEIGHTS,
  SYNERGY_BONUS_WEIGHTS_BY_FORMAT,
  composeTeamScore,
  getTeamSynergyBreakdown,
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

  it('keeps synergy bonus weights on a unit scale for every format', () => {
    Object.entries(SYNERGY_BONUS_WEIGHTS_BY_FORMAT).forEach(([format, weights]) => {
      expect(sumWeights(weights), `${format} weights must sum to 1`).toBeCloseTo(1);
    });
  });

  it('zeroes the spread bonus in singles, which has no ally to hit', () => {
    expect(SYNERGY_BONUS_WEIGHTS_BY_FORMAT.singles.enabledSpread).toBe(0);
    expect(SYNERGY_BONUS_WEIGHTS_BY_FORMAT.doubles.enabledSpread).toBeGreaterThan(0);
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

  it('does not treat low HP and high defenses as equivalent durable bulk', () => {
    const quality = (stats: ReturnType<typeof statsOf>) => scoreMemberQuality({
      stats,
      normalizedDamageToScore: 0.5,
      normalizedDamageFromScore: 0.5
    });

    const lowHp = statsOf({ hp: 40, defense: 85, 'special-defense': 85 });
    const balanced = statsOf({ hp: 70, defense: 70, 'special-defense': 70 });

    // Both additive lines total 210; effective durability is about 58 vs 70.
    expect(quality(balanced)).toBeGreaterThan(quality(lowHp));
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

  describe('monochromeOffense', () => {
    // Deliberately past MIXED_ATTACKER_RATIO in both directions, so these are
    // classified rather than borderline.
    const physical = { hp: 80, attack: 130, defense: 80, 'special-attack': 50, 'special-defense': 80, speed: 80 };
    const special = { hp: 80, attack: 50, defense: 80, 'special-attack': 130, 'special-defense': 80, speed: 80 };
    const mixed = { hp: 80, attack: 100, defense: 80, 'special-attack': 100, 'special-defense': 80, speed: 80 };
    const member = { weaknesses: [], resistances: ['fire'], coverages: ['rock'] };

    const scoreWith = (memberStats: (typeof physical)[], format = BATTLE_FORMATS.singles) => {
      const members = memberStats.map(() => member);
      return scoreTeamSynergy({
        coverage: analyzeTeamCoverage(members),
        format,
        typesTotal: members.length * 2,
        teamSize: members.length,
        typeCount: 18,
        memberStats
      });
    };

    it('penalizes a team with no threat off one attacking stat', () => {
      // The case this exists for. Annihilape, Mamoswine and Corviknight share
      // zero weaknesses — a defensively perfect singles bring — and have Special
      // Attack stats of 50, 70 and 53, so one Will-O-Wisp halves all of it.
      // Every other penalty here is defensive and none of them could see it.
      expect(scoreWith([physical, physical, physical]))
        .toBeLessThan(scoreWith([physical, physical, special]));
      expect(scoreWith([special, special, special]))
        .toBeLessThan(scoreWith([physical, physical, special]));
    });

    it('leaves a team with one off-stat threat alone', () => {
      // Identical teams but for the third member's stat spread, so the whole
      // difference is this term: with three brings, one second angle is enough.
      expect(scoreWith([physical, physical, special]))
        .toBe(scoreWith([physical, physical, mixed]));
      expect(scoreWith([physical, special, special]))
        .toBe(scoreWith([physical, physical, special]));
    });

    it('counts a mixed attacker on both sides, so an all-mixed team is not monochrome', () => {
      // The reason the term counts threats rather than taking a majority. Every
      // member of an all-mixed team is on the majority side of both classes at
      // once, so a majority reading would call the most flexible possible team
      // the most one-dimensional.
      expect(scoreWith([mixed, mixed, mixed])).toBe(scoreWith([physical, physical, special]));
    });

    it('grades in doubles, where a bring of four can be half committed', () => {
      const none = scoreWith([physical, physical, physical, physical], BATTLE_FORMATS.doubles);
      const one = scoreWith([physical, physical, physical, special], BATTLE_FORMATS.doubles);
      const two = scoreWith([physical, physical, special, special], BATTLE_FORMATS.doubles);

      expect(none).toBeLessThan(one);
      expect(one).toBeLessThan(two);
      // Halfway, because a balanced bring of four holds two of each: the
      // denominator is the team's own size and not a constant.
      expect(one - none).toBeCloseTo(two - one, 10);
    });

    it('scores nothing rather than guessing when the stats are not supplied', () => {
      // It is the one penalty needing data from outside the coverage analysis,
      // so it is the one that can be missing. A caller that cannot supply stats
      // must not have its team read as maximally monochrome — which is what a
      // bare `filter` over an empty list would have produced.
      const members = [member, member, member];
      const base = {
        coverage: analyzeTeamCoverage(members),
        format: BATTLE_FORMATS.singles,
        typesTotal: 6,
        teamSize: 3,
        typeCount: 18
      };
      const unpenalized = scoreWith([physical, physical, special]);

      expect(scoreTeamSynergy(base)).toBe(unpenalized);
      // A length that disagrees with the team is treated the same way, rather
      // than scoring the members it happens to have been given.
      expect(scoreTeamSynergy({ ...base, memberStats: [physical] })).toBe(unpenalized);
      // Which is the point: those same three, supplied in full, are penalized.
      expect(scoreTeamSynergy({ ...base, memberStats: [physical, physical, physical] }))
        .toBeLessThan(unpenalized);
    });
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

  it('exposes the canonical contribution terms without changing the score', () => {
    const members = [
      {
        types: ['ground'],
        weaknesses: ['water', 'ice'],
        quadruple_weaknesses: ['ice'],
        resistances: ['rock'],
        immunities: [],
        coverages: ['fire']
      },
      {
        types: ['flying'],
        weaknesses: ['ice'],
        quadruple_weaknesses: [],
        resistances: ['ground'],
        immunities: ['ground'],
        coverages: ['grass']
      }
    ];
    const input = {
      coverage: analyzeTeamCoverage(members),
      roles: analyzeTeamRoles([{ abilityName: 'intimidate' }, { abilityName: 'drought' }]),
      format: BATTLE_FORMATS.doubles,
      typesTotal: 2,
      teamSize: 2,
      typeCount: 18
    };
    const breakdown = getTeamSynergyBreakdown(input);

    expect(Object.is(breakdown.score, scoreTeamSynergy(input))).toBe(true);
    expect(breakdown.bonusTerms.map((term) => term.id)).toEqual([
      'coverageBreadth',
      'resistanceBreadth',
      'typeDiversity',
      'enabledSpread',
      'supportRoles'
    ]);
    expect(breakdown.penaltyTerms.map((term) => term.id)).toEqual([
      'uncoveredWeakness',
      'uncoveredQuadrupleWeakness',
      'sharedWeakness',
      'quadrupleWeakness',
      'sharedQuadrupleWeakness',
      'spreadConflict',
      'fieldConflict',
      'monochromeOffense'
    ]);
    expect(breakdown.unclampedScore).toBe(breakdown.bonus - breakdown.penalty);
    expect(breakdown.bonusTerms.find((term) => term.id === 'supportRoles')?.facts)
      .toEqual(['intimidate', 'weather-setter']);
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
    // Bounds are the observed extremes (8.25..26 and 16..27 at baseScore 18),
    // not the formula's, so a median typing sits near the middle of the range
    // instead of bunched against one end. See pokedexScoring.ts.
    //
    // The defensive floor fell from 11.25 when IMMUNITY_VALUE moved to -2:
    // Ghost/Steel with Earth Eater is immune to four types and now collects -8
    // for them. The neutral line no longer sits near the middle as a result,
    // which is a property of the valuation rather than of the normalization.
    expect(normalizeDamageFromScore(18, 18)).toBeCloseTo((18 - 8.25) / (26 - 8.25));
    expect(normalizeDamageToScore(18, 18)).toBeCloseTo((18 - 16) / (27 - 16));
  });

  it('maps the observed extremes onto 0 and 1', () => {
    // The best and worst a real Pokemon reaches, which is what the scale is
    // anchored to. The formula extremes are unreachable and clamp.
    expect(normalizeDamageFromScore(8.25, 18)).toBeCloseTo(0);
    expect(normalizeDamageFromScore(26, 18)).toBeCloseTo(1);
    expect(normalizeDamageToScore(16, 18)).toBeCloseTo(0);
    expect(normalizeDamageToScore(27, 18)).toBeCloseTo(1);
  });

  it('clamps out-of-range scores and defaults unknown ones to the midpoint', () => {
    expect(normalizeDamageFromScore(-50, 18)).toBe(0);
    expect(normalizeDamageFromScore(500, 18)).toBe(1);
    expect(normalizeDamageFromScore(undefined, 18)).toBe(0.5);
    expect(normalizeDamageToScore(undefined, 18)).toBe(0.5);
  });
});

describe('format-specific synergy', () => {
  const spreadTeam = [
    { types: ['ground'], weaknesses: ['water'], resistances: [], immunities: [], coverages: ['fire'] },
    { types: ['flying'], weaknesses: ['ice'], resistances: ['ground'], immunities: ['ground'], coverages: ['grass'] }
  ];

  const scoreIn = (format: typeof BATTLE_FORMATS.singles) => scoreTeamSynergy({
    coverage: analyzeTeamCoverage(spreadTeam),
    format,
    typesTotal: 2,
    teamSize: 2,
    typeCount: 18
  });

  it('ignores spread safety in singles', () => {
    // The Flying partner's Ground immunity is worth nothing when it never
    // shares the field, so removing the immunity must not change the singles
    // score.
    const withImmunity = scoreIn(BATTLE_FORMATS.singles);
    const withoutImmunity = scoreTeamSynergy({
      coverage: analyzeTeamCoverage([
        spreadTeam[0],
        { ...spreadTeam[1], immunities: [] }
      ]),
      format: BATTLE_FORMATS.singles,
      typesTotal: 2,
      teamSize: 2,
      typeCount: 18
    });

    expect(withImmunity).toBeCloseTo(withoutImmunity);
  });

  it('rewards the same immunity in doubles', () => {
    const withImmunity = scoreIn(BATTLE_FORMATS.doubles);
    const withoutImmunity = scoreTeamSynergy({
      coverage: analyzeTeamCoverage([
        spreadTeam[0],
        { ...spreadTeam[1], immunities: [] }
      ]),
      format: BATTLE_FORMATS.doubles,
      typesTotal: 2,
      teamSize: 2,
      typeCount: 18
    });

    expect(withImmunity).toBeGreaterThan(withoutImmunity);
  });

  it('defaults to doubles when no format is supplied', () => {
    const explicit = scoreIn(BATTLE_FORMATS.doubles);
    const implicit = scoreTeamSynergy({
      coverage: analyzeTeamCoverage(spreadTeam),
      typesTotal: 2,
      teamSize: 2,
      typeCount: 18
    });

    expect(implicit).toBeCloseTo(explicit);
  });
});
