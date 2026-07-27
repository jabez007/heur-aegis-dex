import { describe, expect, it } from 'vitest';
import {
  BATTLE_FORMS,
  VERIFIED_ON,
  VERIFIED_SPECIES_COUNT,
  getMergedBattleForm,
  hasBattleFormRule,
  sharesTyping
} from './battleForms';
import { REGULATIONS } from './regulations';
import { describeRosterStaleness } from './rosterStaleness.fixture';

describeRosterStaleness({
  table: 'BATTLE_FORMS',
  verifiedOn: VERIFIED_ON,
  speciesCount: VERIFIED_SPECIES_COUNT,
  rewalk: 'Re-walk the roster for varieties whose form resource reports is_battle_only without is_mega, '
    + 'and record each one as merged or not with its reasoning.'
});

describe('BATTLE_FORMS', () => {
  it('records a reason for every entry, merged or not', () => {
    // A bare absence cannot be told apart from an oversight, so the rejected
    // entries have to carry their reasoning too.
    BATTLE_FORMS.forEach((rule) => {
      expect(rule.reason.length).toBeGreaterThan(40);
    });
  });

  it('names species that are actually legal', () => {
    const legal = REGULATIONS.find((regulation) => regulation.id === 'M-B')!.legalSpecies;
    BATTLE_FORMS.forEach((rule) => {
      expect(legal.has(rule.species)).toBe(true);
    });
  });

  it('holds one rule per species', () => {
    const species = BATTLE_FORMS.map((rule) => rule.species);
    expect(new Set(species).size).toBe(species.length);
  });

  it('merges deliberately rather than by default', () => {
    // If this count starts climbing without a matching change to the reasons,
    // someone has started merging forms because they are stronger rather than
    // because the Pokemon fights in them.
    expect(BATTLE_FORMS.filter((rule) => rule.merged).map((rule) => rule.species)).toEqual(['palafin']);
  });
});

describe('getMergedBattleForm', () => {
  it('resolves a whitelisted form when the trigger ability is present', () => {
    const rule = getMergedBattleForm('palafin', ['zero-to-hero']);
    expect(rule?.variety).toBe('palafin-hero');
  });

  it('declines when the Pokemon does not have the trigger ability', () => {
    // A form the Pokemon cannot reach is not a form it fights in.
    expect(getMergedBattleForm('palafin', ['torrent'])).toBeUndefined();
  });

  it('declines for forms recorded but not merged', () => {
    expect(getMergedBattleForm('aegislash', ['stance-change'])).toBeUndefined();
    expect(getMergedBattleForm('greninja', ['battle-bond'])).toBeUndefined();
    expect(getMergedBattleForm('mimikyu', ['disguise'])).toBeUndefined();
  });

  it('declines for species with no rule at all', () => {
    expect(getMergedBattleForm('pikachu', ['static'])).toBeUndefined();
  });
});

describe('hasBattleFormRule', () => {
  it('reports considered species whether or not they merge', () => {
    expect(hasBattleFormRule('aegislash')).toBe(true);
    expect(hasBattleFormRule('palafin')).toBe(true);
    expect(hasBattleFormRule('pikachu')).toBe(false);
  });
});

describe('sharesTyping', () => {
  it('accepts the same types in any order', () => {
    expect(sharesTyping(['water'], ['water'])).toBe(true);
    expect(sharesTyping(['water', 'flying'], ['flying', 'water'])).toBe(true);
  });

  it('rejects a retype, which would misfile the Pokemon', () => {
    expect(sharesTyping(['normal'], ['fire'])).toBe(false);
    expect(sharesTyping(['water'], ['water', 'flying'])).toBe(false);
  });
});
