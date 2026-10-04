import { describe, expect, it } from 'vitest';
import { BATTLE_FORMATS, type BattleFormat } from './battleFormats';
import {
  evaluateGuidedCandidateNeed,
  getGuidedLineRisks,
  recommendGuidedPartners,
  selectPrimaryGuidedNeed,
  type GuidedLineMember
} from './guidedNeedRules';
import { ELEMENTAL_TYPES } from './pokemonCatalog';
import { SYNERGY_BONUS_WEIGHTS_BY_FORMAT } from './teamScoring';
import type { PokemonEntry } from './pokemonEntry';
import type { PokemonStats } from './pokedexTypes';

const member = (name: string, overrides: Partial<GuidedLineMember> = {}): GuidedLineMember => ({
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

describe.each([BATTLE_FORMATS.singles, BATTLE_FORMATS.doubles])(
  'guided vulnerability rules: $id',
  (format) => {
    it('uses fixed vulnerability priority rather than role or type-slug opportunity gaps', () => {
      const primary = selectPrimaryGuidedNeed([
        member('a', { weaknesses: ['ice', 'fire'], quadruple_weaknesses: ['ice'] }),
        member('b', { weaknesses: ['ice', 'water'], quadruple_weaknesses: ['ice'] })
      ], optionsFor(format));

      expect(primary).toMatchObject({ id: 'shared-quadruple-weakness', dimension: 'ice' });
    });

    it('returns null when the roster has no modeled vulnerability', () => {
      expect(selectPrimaryGuidedNeed([
        member('safe', { coverages: [...ELEMENTAL_TYPES] })
      ], optionsFor(format))).toBeNull();
    });

    it('does not invent improvement from a neutral addition', () => {
      const roster = [member('a', { weaknesses: ['ice'] }), member('b', { weaknesses: ['ice'] })];
      const result = evaluateGuidedCandidateNeed(
        roster,
        member('neutral'),
        { id: 'shared-weakness', dimension: 'ice' },
        optionsFor(format)
      );

      expect(result.improvement).toBe(0);
      expect(result.improves).toBe(false);
    });

    it('returns actual before and after evidence for a resistance opportunity', () => {
      const roster = [member('a', { weaknesses: ['ice'] }), member('b', { weaknesses: ['ice'] })];
      const result = evaluateGuidedCandidateNeed(
        roster,
        member('answer', { resistances: ['ice'] }),
        { id: 'shared-weakness', dimension: 'ice' },
        optionsFor(format)
      );
      const evidence = result.reasons.find(({ ruleId }) => ruleId === 'resistanceBreadth')!;

      expect(evidence.baselineContribution).toBeCloseTo(
        SYNERGY_BONUS_WEIGHTS_BY_FORMAT[format.id].resistanceBreadth / ELEMENTAL_TYPES.length
      );
      expect(evidence.candidateContribution).toBe(0);
      expect(evidence.delta).toBe(-evidence.baselineContribution);
      expect(evidence.sourceFacts).toContain('candidate:resistance-count:1');
      expect(result.improves).toBe(true);
    });

    it.each([
      ['resistance', { resistances: ['fire'] }],
      ['STAB answer', { coverages: ['fire'] }],
      ['move answer', { moveCoverages: ['fire'] }]
    ])('accepts a %s for an unanswered weakness', (_label, answer) => {
      const result = evaluateGuidedCandidateNeed(
        [member('favorite', { weaknesses: ['fire'] })],
        member('answer', answer),
        { id: 'unanswered-weakness', dimension: 'fire' },
        optionsFor(format)
      );

      expect(result.improves).toBe(true);
      expect(result.reasons.every(({ delta }) => delta <= 0)).toBe(true);
    });

    it('rejects a candidate that worsens the displayed vulnerability', () => {
      const result = evaluateGuidedCandidateNeed(
        [member('favorite', { weaknesses: ['ice'] }), member('partner', { weaknesses: ['ice'] })],
        member('worse', { weaknesses: ['ice'] }),
        { id: 'shared-weakness', dimension: 'ice' },
        optionsFor(format)
      );

      expect(result.improvement).toBeLessThan(0);
      expect(result.improves).toBe(false);
    });

    it('keeps the raw shared-quadruple penalty while closing its resistance opportunity', () => {
      const result = evaluateGuidedCandidateNeed(
        [
          member('a', { weaknesses: ['grass'], quadruple_weaknesses: ['grass'] }),
          member('b', { weaknesses: ['grass'], quadruple_weaknesses: ['grass'] })
        ],
        member('answer', { resistances: ['grass'] }),
        { id: 'shared-quadruple-weakness', dimension: 'grass' },
        optionsFor(format)
      );

      expect(result.reasons.find(({ ruleId }) => ruleId === 'sharedQuadrupleWeakness')?.delta).toBe(0);
      expect(result.reasons.find(({ ruleId }) => ruleId === 'resistanceBreadth')?.delta).toBeLessThan(0);
    });
  }
);

describe('guided doubles-only facts', () => {
  const earthquakePair = [
    member('attacker', { types: ['ground'] }),
    member('partner', { weaknesses: ['ground'] })
  ];

  it('derives Telepathy spread safety from the selected ability', () => {
    const unsafe = getGuidedLineRisks(earthquakePair, optionsFor(BATTLE_FORMATS.doubles));
    const safe = getGuidedLineRisks([
      earthquakePair[0],
      { ...earthquakePair[1], abilityName: 'telepathy' }
    ], optionsFor(BATTLE_FORMATS.doubles));

    expect(unsafe).toContainEqual(expect.objectContaining({ ruleId: 'spreadConflict', dimension: 'ground' }));
    expect(safe.some(({ ruleId }) => ruleId === 'spreadConflict')).toBe(false);
  });

  it('does not score spread conflicts in singles', () => {
    expect(getGuidedLineRisks(earthquakePair, optionsFor(BATTLE_FORMATS.singles))
      .some(({ ruleId }) => ruleId === 'spreadConflict')).toBe(false);
  });

  it('reports an introduced field conflict as the primary tradeoff', () => {
    const result = evaluateGuidedCandidateNeed(
      [member('favorite', { weaknesses: ['fire'], abilityName: 'drought' })],
      member('answer', { moveCoverages: ['fire'], abilityName: 'drizzle' }),
      { id: 'unanswered-weakness', dimension: 'fire' },
      optionsFor(BATTLE_FORMATS.doubles)
    );

    expect(result.improves).toBe(true);
    expect(result.primaryTradeoff).toMatchObject({ ruleId: 'fieldConflict', dimension: 'weather-setter' });
    expect(result.primaryTradeoff?.delta).toBeGreaterThan(0);
  });
});

const stats = (value: number): PokemonStats => ({
  hp: value,
  attack: value,
  defense: value,
  'special-attack': value,
  'special-defense': value,
  speed: value
});

const pokemon = (name: string, overrides: Partial<PokemonEntry> = {}): PokemonEntry => ({
  name,
  speciesName: name,
  typeName: 'normal',
  types: ['normal'],
  sprite: '',
  stats: stats(80),
  baseStats: stats(80),
  statsTotal: 480,
  abilities: [{ name: 'plain', is_hidden: false }],
  abilityName: 'plain',
  abilityProfiles: {},
  weaknesses: [],
  quadrupleWeaknesses: [],
  resistances: [],
  immunities: [],
  coverages: [],
  moveCoverages: [],
  normalizedDamageToScore: 0.5,
  normalizedDamageFromScore: 0.5,
  ...overrides
});

describe('guided partner shortlist', () => {
  it('evaluates abilities, removes duplicate species, and is stable under input permutation', () => {
    const favorite = pokemon('favorite', { weaknesses: ['fire'] });
    const strongerForm = pokemon('answer-strong', {
      speciesName: 'answer',
      stats: stats(110),
      baseStats: stats(110),
      statsTotal: 660,
      abilities: [{ name: 'plain', is_hidden: false }, { name: 'flash-fire', is_hidden: false }],
      abilityProfiles: {
        'flash-fire': { resistances: ['fire'], immunities: ['fire'] }
      }
    });
    const weakerForm = pokemon('answer-weak', {
      speciesName: 'answer',
      abilities: [{ name: 'plain', is_hidden: false }, { name: 'flash-fire', is_hidden: false }],
      abilityProfiles: {
        'flash-fire': { resistances: ['fire'], immunities: ['fire'] }
      }
    });
    const offensiveAnswer = pokemon('offensive-answer', { moveCoverages: ['fire'] });
    const neutral = pokemon('neutral');
    const duplicateFavorite = pokemon('favorite-form', {
      speciesName: 'favorite',
      resistances: ['fire']
    });
    const candidatePool = [neutral, weakerForm, offensiveAnswer, duplicateFavorite, strongerForm];
    const request = {
      format: BATTLE_FORMATS.singles,
      typeNames: ELEMENTAL_TYPES,
      currentMembers: [favorite],
      candidatePool
    };

    const forward = recommendGuidedPartners(request);
    const reversed = recommendGuidedPartners({ ...request, candidatePool: [...candidatePool].reverse() });

    expect(forward.map(({ varietyName, abilityName }) => ({ varietyName, abilityName }))).toEqual([
      { varietyName: 'answer-strong', abilityName: 'flash-fire' },
      { varietyName: 'offensive-answer', abilityName: 'plain' }
    ]);
    expect(reversed.map(({ varietyName, abilityName }) => ({ varietyName, abilityName })))
      .toEqual(forward.map(({ varietyName, abilityName }) => ({ varietyName, abilityName })));
    expect(forward[0].reasons.some(({ sourceFacts }) =>
      sourceFacts.includes('candidate:resistance-count:1'))).toBe(true);
  });

  it('returns at most five improving candidates', () => {
    const favorite = pokemon('favorite', { weaknesses: ['fire'] });
    const candidatePool = Array.from({ length: 6 }, (_, index) =>
      pokemon(`answer-${index}`, { moveCoverages: ['fire'] }));

    const recommendations = recommendGuidedPartners({
      format: BATTLE_FORMATS.doubles,
      typeNames: ELEMENTAL_TYPES,
      currentMembers: [favorite],
      candidatePool
    });

    expect(recommendations).toHaveLength(5);
    expect(recommendations.map(({ varietyName }) => varietyName))
      .toEqual(['answer-0', 'answer-1', 'answer-2', 'answer-3', 'answer-4']);
  });
});
