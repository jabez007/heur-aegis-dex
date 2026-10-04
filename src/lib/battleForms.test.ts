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
    // If this list starts growing without a matching change to the reasons,
    // someone has started merging forms because they are stronger rather than
    // because the Pokemon fights in them. It is currently empty: condition 4
    // disqualified Palafin, the only entry that had ever satisfied the rest.
    expect(BATTLE_FORMS.filter((rule) => rule.merged).map((rule) => rule.species)).toEqual([]);
  });
});

describe('getMergedBattleForm', () => {
  // The real table merges nothing, so the mechanism is exercised against a
  // fixture. Testing it through whichever species currently qualifies stops
  // testing the mechanism the moment the table changes — which is exactly what
  // happened when Palafin was unmerged.
  const fixture = [{
    species: 'fixture-mon',
    variety: 'fixture-mon-battle',
    ability: 'fixture-trigger',
    merged: true,
    reason: 'Fixture. Exercises the resolver without depending on the real table.'
  }, {
    species: 'recorded-mon',
    variety: 'recorded-mon-battle',
    ability: 'recorded-trigger',
    merged: false,
    reason: 'Fixture. Recorded and deliberately not merged.'
  }];

  it('resolves a whitelisted form when the trigger ability is present', () => {
    const rule = getMergedBattleForm('fixture-mon', ['fixture-trigger'], fixture);
    expect(rule?.variety).toBe('fixture-mon-battle');
  });

  it('declines when the Pokemon does not have the trigger ability', () => {
    // A form the Pokemon cannot reach is not a form it fights in.
    expect(getMergedBattleForm('fixture-mon', ['torrent'], fixture)).toBeUndefined();
  });

  it('declines a form that is recorded but not merged', () => {
    expect(getMergedBattleForm('recorded-mon', ['recorded-trigger'], fixture)).toBeUndefined();
  });

  it('rates Palafin as registered, since Zero to Hero costs a turn', () => {
    // The decision this file's condition 4 records. Palafin fights as Hero, but
    // it has to spend a switch to get there, and no other conditional effect in
    // the model is granted for free either.
    expect(getMergedBattleForm('palafin', ['zero-to-hero'])).toBeUndefined();
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
