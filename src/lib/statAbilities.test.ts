import { describe, expect, it } from 'vitest';
import {
  STAT_ABILITIES,
  getEffectiveStats,
  getStatAbility,
  getStatAbilityName,
  hasStatAbilityRule,
  totalStats
} from './statAbilities';

const azumarill = {
  hp: 100, attack: 50, defense: 80, 'special-attack': 60, 'special-defense': 80, speed: 50
};

describe('STAT_ABILITIES', () => {
  it('records a reason for every entry, applied or not', () => {
    STAT_ABILITIES.forEach((rule) => {
      expect(rule.reason.length, `${rule.ability} needs a reason`).toBeGreaterThan(40);
    });
  });

  it('gives every unapplied rule a condition, and every applied rule none', () => {
    // The condition *is* the reason it is not applied, so the two must agree.
    STAT_ABILITIES.forEach((rule) => {
      if (rule.applied) expect(rule.condition, `${rule.ability}`).toBeUndefined();
      else expect(rule.condition, `${rule.ability}`).toBeTruthy();
    });
  });

  it('applies only abilities that need no setup', () => {
    // If this list grows, something conditional has been let in. Weather and
    // status abilities depend on game state the scan does not model.
    expect(STAT_ABILITIES.filter((rule) => rule.applied).map((rule) => rule.ability)).toEqual([
      'huge-power', 'pure-power', 'fur-coat', 'ice-scales', 'hustle'
    ]);
  });

  it('holds one rule per ability', () => {
    const abilities = STAT_ABILITIES.map((rule) => rule.ability);
    expect(new Set(abilities).size).toBe(abilities.length);
  });
});

describe('getEffectiveStats', () => {
  it('doubles the attack of a Huge Power Pokemon', () => {
    const effective = getEffectiveStats(azumarill, ['huge-power']);

    expect(effective.attack).toBe(100);
    // Everything else is untouched.
    expect(effective['special-attack']).toBe(60);
    expect(effective.hp).toBe(100);
  });

  it('leaves the original object alone', () => {
    getEffectiveStats(azumarill, ['huge-power']);
    expect(azumarill.attack).toBe(50);
  });

  it('returns the same object when nothing applies', () => {
    // Identity lets a caller tell "unmodified" from "modified to the same value".
    expect(getEffectiveStats(azumarill, ['thick-fat'])).toBe(azumarill);
    expect(getEffectiveStats(azumarill, [])).toBe(azumarill);
    expect(getEffectiveStats(azumarill, [undefined])).toBe(azumarill);
  });

  it('ignores conditional abilities', () => {
    // Chlorophyll doubles Speed only in sun, which something else must set.
    const venusaur = { ...azumarill, speed: 80 };
    expect(getEffectiveStats(venusaur, ['chlorophyll']).speed).toBe(80);
    expect(getEffectiveStats(venusaur, ['swift-swim'])).toBe(venusaur);
  });

  it('truncates rather than rounding, as the games do', () => {
    const flapple = { ...azumarill, attack: 110 };
    // Hustle is 1.5x: 110 -> 165 exactly, so use an odd stat to see the floor.
    expect(getEffectiveStats({ ...flapple, attack: 111 }, ['hustle']).attack).toBe(166);
  });

  it('applies defensive multipliers to the right stat', () => {
    expect(getEffectiveStats(azumarill, ['fur-coat']).defense).toBe(160);
    expect(getEffectiveStats(azumarill, ['ice-scales'])['special-defense']).toBe(160);
  });
});

describe('getStatAbility', () => {
  it('resolves applied abilities only', () => {
    expect(getStatAbility('huge-power')?.multiplier).toBe(2);
    expect(getStatAbility('chlorophyll')).toBeUndefined();
    expect(getStatAbility('blaze')).toBeUndefined();
    expect(getStatAbility(undefined)).toBeUndefined();
  });
});

describe('hasStatAbilityRule', () => {
  it('reports considered abilities whether or not they apply', () => {
    expect(hasStatAbilityRule('huge-power')).toBe(true);
    expect(hasStatAbilityRule('chlorophyll')).toBe(true);
    expect(hasStatAbilityRule('blaze')).toBe(false);
  });
});

describe('getStatAbilityName', () => {
  it('names the ability behind a modified line', () => {
    expect(getStatAbilityName(['thick-fat', 'huge-power', 'sap-sipper'])).toBe('huge-power');
    expect(getStatAbilityName(['thick-fat', 'sap-sipper'])).toBeUndefined();
  });
});

describe('totalStats', () => {
  it('sums a stat line', () => {
    expect(totalStats(azumarill)).toBe(420);
    expect(totalStats(getEffectiveStats(azumarill, ['huge-power']))).toBe(470);
  });
});
