import { describe, expect, it } from 'vitest';
import { BATTLE_FORMATS, type BattleFormat } from './battleFormats';
import {
  compareGuidedAbilityProfiles,
  compareGuidedCandidates,
  evaluateGuidedCandidateNeed,
  getGuidedLineNeeds,
  getGuidedLineRisks,
  rankGuidedRecommendations,
  selectPrimaryGuidedNeed,
  type GuidedLineMember,
  type StructuralNeedId
} from './guidedNeedRules';
import { ELEMENTAL_TYPES } from './pokemonCatalog';
import { SYNERGY_BONUS_WEIGHTS_BY_FORMAT } from './teamScoring';

const emptyMember = (name: string, overrides: Partial<GuidedLineMember> = {}): GuidedLineMember => ({
  name,
  types: [],
  weaknesses: [],
  quadruple_weaknesses: [],
  resistances: [],
  immunities: [],
  coverages: [],
  moveCoverages: [],
  ...overrides
});

const optionsFor = (format: BattleFormat) => ({ format, typeNames: ELEMENTAL_TYPES });

const roleAbilities = {
  singles: ['intimidate', 'drought', 'electric-surge'],
  doubles: ['intimidate', 'lightning-rod', 'telepathy', 'drought']
} as const;

function balancedLine(format: BattleFormat): GuidedLineMember[] {
  return roleAbilities[format.id].map((abilityName, index) => emptyMember(`member-${index}`, {
    abilityName,
    coverages: index === 0 ? [...ELEMENTAL_TYPES] : []
  }));
}

const need = (
  members: GuidedLineMember[],
  format: BattleFormat,
  id: StructuralNeedId,
  dimension: string
) => getGuidedLineNeeds(members, optionsFor(format))
  .find((item) => item.id === id && item.dimension === dimension);

describe.each([BATTLE_FORMATS.singles, BATTLE_FORMATS.doubles])(
  'guided need rules: $id golden fixtures',
  (format) => {
    const weights = SYNERGY_BONUS_WEIGHTS_BY_FORMAT[format.id];

    it('does not invent shared-weakness improvement from a neutral roster addition', () => {
      const path = [
        emptyMember('favorite-a', { weaknesses: ['ice'] }),
        emptyMember('favorite-b', { weaknesses: ['ice'] })
      ];
      const primary = { id: 'shared-weakness' as const, dimension: 'ice' };
      const neutral = evaluateGuidedCandidateNeed(
        path,
        emptyMember('neutral'),
        ['favorite-a', 'favorite-b'],
        primary,
        optionsFor(format)
      );

      expect(neutral.improvement).toBe(0);
      expect(neutral.improves).toBe(false);
    });

    it('credits only the canonical resistance opportunity for a shared weakness', () => {
      const path = [
        emptyMember('favorite-a', { weaknesses: ['ice'] }),
        emptyMember('favorite-b', { weaknesses: ['ice'] })
      ];
      const result = evaluateGuidedCandidateNeed(
        path,
        emptyMember('resistant', { resistances: ['ice'] }),
        ['favorite-a', 'favorite-b'],
        { id: 'shared-weakness', dimension: 'ice' },
        optionsFor(format)
      );

      expect(result.improvement).toBeCloseTo(weights.resistanceBreadth / ELEMENTAL_TYPES.length);
      expect(result.improves).toBe(true);
    });

    it('keeps the raw shared-quadruple penalty when resistance closes its opportunity', () => {
      const path = [
        emptyMember('favorite-a', { weaknesses: ['grass'], quadruple_weaknesses: ['grass'] }),
        emptyMember('favorite-b', { weaknesses: ['grass'], quadruple_weaknesses: ['grass'] })
      ];
      const before = need(path, format, 'shared-quadruple-weakness', 'grass')!;
      const result = evaluateGuidedCandidateNeed(
        path,
        emptyMember('resistant', { resistances: ['grass'] }),
        ['favorite-a', 'favorite-b'],
        before,
        optionsFor(format)
      );

      expect(before.severity).toBeCloseTo(
        1.5 / format.broughtToBattle + weights.resistanceBreadth / ELEMENTAL_TYPES.length
      );
      expect(result.improvement).toBeCloseTo(weights.resistanceBreadth / ELEMENTAL_TYPES.length);
    });

    it.each([
      ['defensive', { resistances: ['fire'] }],
      ['STAB', { coverages: ['fire'] }],
      ['move-only', { moveCoverages: ['fire'] }]
    ])('accepts a %s answer to an ordinary unanswered weakness', (_label, answer) => {
      const path = [emptyMember('favorite', { weaknesses: ['fire'] })];
      const result = evaluateGuidedCandidateNeed(
        path,
        emptyMember('answer', answer),
        ['favorite'],
        { id: 'unanswered-weakness', dimension: 'fire' },
        optionsFor(format)
      );

      expect(result.improvement).toBe(0.6 / ELEMENTAL_TYPES.length);
      expect(result.improves).toBe(true);
    });

    it('clears both unanswered terms for a quadruple weakness', () => {
      const path = [emptyMember('favorite', {
        weaknesses: ['fire'],
        quadruple_weaknesses: ['fire']
      })];
      const result = evaluateGuidedCandidateNeed(
        path,
        emptyMember('answer', { moveCoverages: ['fire'] }),
        ['favorite'],
        { id: 'unanswered-weakness', dimension: 'fire' },
        optionsFor(format)
      );

      expect(result.improvement).toBeCloseTo((0.6 + 1.2) / ELEMENTAL_TYPES.length);
    });

    it('does not treat move-only reach as STAB coverage breadth', () => {
      const path = [emptyMember('favorite')];
      const moveOnly = evaluateGuidedCandidateNeed(
        path,
        emptyMember('move-only', { moveCoverages: ['fire'] }),
        ['favorite'],
        { id: 'missing-coverage', dimension: 'fire' },
        optionsFor(format)
      );
      const stab = evaluateGuidedCandidateNeed(
        path,
        emptyMember('stab', { coverages: ['fire'] }),
        ['favorite'],
        { id: 'missing-coverage', dimension: 'fire' },
        optionsFor(format)
      );

      expect(moveOnly.improvement).toBe(0);
      expect(stab.improvement).toBeCloseTo(weights.coverageBreadth / ELEMENTAL_TYPES.length);
    });

    it('uses only format-applicable roles and stops at reachable role capacity', () => {
      const roles = getGuidedLineNeeds(balancedLine(format), optionsFor(format))
        .filter((item) => item.id === 'missing-modeled-role');
      const redirection = need([emptyMember('solo')], format, 'missing-modeled-role', 'redirection');

      expect(roles).toEqual([]);
      if (format.hasAlly) expect(redirection).toBeDefined();
      else expect(redirection).toBeUndefined();
    });

    it('returns the terminal balanced state only when no specific gap remains', () => {
      expect(getGuidedLineNeeds(balancedLine(format), optionsFor(format))).toEqual([{
        id: 'balanced-improvement',
        dimension: 'none',
        severity: 0,
        evidence: []
      }]);
    });

    it('uses code-point order for equal dimensions', () => {
      const line = balancedLine(format);
      line[0].coverages = ELEMENTAL_TYPES.filter((type) => type !== 'water' && type !== 'fire');
      const primary = getGuidedLineNeeds(line, optionsFor(format))[0];

      expect(primary).toMatchObject({ id: 'missing-coverage', dimension: 'fire' });
    });

    it('preserves strict immunity evidence without turning it into another need', () => {
      const line = balancedLine(format);
      line[0].resistances = ['ground'];
      line[0].immunities = ['ground'];

      expect(getGuidedLineNeeds(line, optionsFor(format))[0].id).toBe('balanced-improvement');
    });

    it('returns traceable evidence from aggregated favorite-containing lines', () => {
      const path = [
        emptyMember('favorite-b', { weaknesses: ['ice'] }),
        emptyMember('favorite-a', { weaknesses: ['ice'] })
      ];
      const primary = selectPrimaryGuidedNeed(
        path,
        ['favorite-b', 'favorite-a'],
        optionsFor(format)
      );

      expect(primary).toMatchObject({ id: 'shared-weakness', dimension: 'ice' });
      expect(primary.evidence.length).toBeGreaterThan(0);
      expect(primary.evidence.reduce((sum, item) => sum + item.baselineContribution, 0))
        .toBeCloseTo(primary.severity);
      expect(primary.evidence.flatMap((item) => item.sourceFacts)).toContain('favorite:favorite-a');
    });

    it('canonicalizes favorite order for candidate evidence', () => {
      const path = [
        emptyMember('favorite-b', { weaknesses: ['ice'] }),
        emptyMember('favorite-a', { weaknesses: ['ice'] })
      ];
      const candidate = emptyMember('resistant', { resistances: ['ice'] });
      const primary = { id: 'shared-weakness' as const, dimension: 'ice' };

      expect(evaluateGuidedCandidateNeed(
        path,
        candidate,
        ['favorite-b', 'favorite-a'],
        primary,
        optionsFor(format)
      )).toEqual(evaluateGuidedCandidateNeed(
        [...path].reverse(),
        candidate,
        ['favorite-a', 'favorite-b'],
        primary,
        optionsFor(format)
      ));
    });
  }
);

describe('guided need rule validation and line ties', () => {
  it('rejects duplicate candidate and favorite identities', () => {
    const path = [emptyMember('favorite')];
    const options = optionsFor(BATTLE_FORMATS.singles);

    expect(() => evaluateGuidedCandidateNeed(
      path,
      emptyMember('favorite'),
      ['favorite'],
      { id: 'missing-coverage', dimension: 'fire' },
      options
    )).toThrow('already on the guided path');
    expect(() => selectPrimaryGuidedNeed(path, ['favorite', 'favorite'], options))
      .toThrow('Locked favorites must be unique');
  });

  it('uses total penalty and then line signature to break equal-contribution ties', () => {
    const allButFire = ELEMENTAL_TYPES.filter((type) => type !== 'fire');
    const path = [
      emptyMember('favorite', { abilityName: 'intimidate', coverages: allButFire }),
      emptyMember('a', { abilityName: 'drought' }),
      emptyMember('b', { abilityName: 'electric-surge' }),
      emptyMember('risky', {
        abilityName: 'intimidate',
        weaknesses: ['grass'],
        quadruple_weaknesses: ['grass']
      })
    ];
    const primary = selectPrimaryGuidedNeed(path, ['favorite'], optionsFor(BATTLE_FORMATS.singles));

    expect(primary).toMatchObject({ id: 'missing-coverage', dimension: 'fire' });
    expect(primary.evidence.flatMap((item) => item.sourceFacts))
      .toContain('line:a\u0000b\u0000favorite');
  });

  it('orders equal newly introduced risks by rule and dimension slug', () => {
    const result = evaluateGuidedCandidateNeed(
      [emptyMember('favorite')],
      emptyMember('candidate', { weaknesses: ['water', 'fire'], coverages: ['grass'] }),
      ['favorite'],
      { id: 'missing-coverage', dimension: 'grass' },
      optionsFor(BATTLE_FORMATS.singles)
    );

    expect(result.primaryTradeoff).toMatchObject({
      ruleId: 'uncoveredWeakness',
      dimension: 'fire',
      severity: 0.6 / ELEMENTAL_TYPES.length
    });
  });

  it('reports spread conflict risk only in doubles', () => {
    const members = [
      emptyMember('favorite', { weaknesses: ['ground'] }),
      emptyMember('candidate', { types: ['ground'] })
    ];

    expect(getGuidedLineRisks(members, optionsFor(BATTLE_FORMATS.singles))
      .some((risk) => risk.ruleId === 'spreadConflict')).toBe(false);
    expect(getGuidedLineRisks(members, optionsFor(BATTLE_FORMATS.doubles)))
      .toContainEqual({ ruleId: 'spreadConflict', dimension: 'ground', severity: 0.25 / 8 });
  });

  it('applies the complete ability and candidate tie orders independent of input order', () => {
    const options = [
      { improvement: 1, primaryTradeoffDelta: 0.1, candidatePriority: 2, abilityName: 'z', varietyName: 'a' },
      { improvement: 1, primaryTradeoffDelta: 0.1, candidatePriority: 2, abilityName: 'a', varietyName: 'z' },
      { improvement: 2, primaryTradeoffDelta: 1, candidatePriority: 0, abilityName: 'm', varietyName: 'm' }
    ];

    expect([...options].reverse().sort(compareGuidedAbilityProfiles).map((item) => item.abilityName))
      .toEqual(['m', 'a', 'z']);
    expect([...options].reverse().sort(compareGuidedCandidates).map((item) => item.varietyName))
      .toEqual(['m', 'a', 'z']);
  });

  it('returns only improving eligible species and remains stable with fewer than five', () => {
    const base = {
      primaryTradeoffDelta: 0,
      candidatePriority: 1,
      eligible: true,
      improvesPrimaryNeed: true
    };
    const options = [
      { ...base, speciesName: 'alpha', varietyName: 'alpha-a', abilityName: 'z', improvement: 1 },
      { ...base, speciesName: 'alpha', varietyName: 'alpha-a', abilityName: 'a', improvement: 1 },
      { ...base, speciesName: 'alpha', varietyName: 'alpha-b', abilityName: 'm', improvement: 2 },
      { ...base, speciesName: 'beta', varietyName: 'beta', abilityName: 'b', improvement: 1 },
      { ...base, speciesName: 'neutral', varietyName: 'neutral', abilityName: 'n', improvement: 0 },
      { ...base, speciesName: 'unsafe', varietyName: 'unsafe', abilityName: 'u', improvement: 3,
        improvesPrimaryNeed: false },
      { ...base, speciesName: 'excluded', varietyName: 'excluded', abilityName: 'e', improvement: 3,
        eligible: false }
    ];
    const expected = [
      { speciesName: 'alpha', varietyName: 'alpha-b', abilityName: 'm' },
      { speciesName: 'beta', varietyName: 'beta', abilityName: 'b' }
    ];

    const simplify = (items: ReturnType<typeof rankGuidedRecommendations>) => items.map((item) => ({
      speciesName: item.speciesName,
      varietyName: item.varietyName,
      abilityName: item.abilityName
    }));
    expect(simplify(rankGuidedRecommendations(options))).toEqual(expected);
    expect(simplify(rankGuidedRecommendations([...options].reverse()))).toEqual(expected);
    expect(rankGuidedRecommendations(options, 1)).toHaveLength(1);
  });
});
