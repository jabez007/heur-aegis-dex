import { describe, expect, it } from 'vitest';
import {
  ABILITY_QUALITY_EFFECTS,
  getAbilityQualityEffect,
  getQualityMultipliers,
  hasAbilityQualityRule
} from './abilityEffects';
import { scoreMemberQuality } from './teamScoring';

describe('ABILITY_QUALITY_EFFECTS', () => {
  it('records a reason for every entry, applied or not', () => {
    ABILITY_QUALITY_EFFECTS.forEach((rule) => {
      expect(rule.reason.length, `${rule.ability} needs a reason`).toBeGreaterThan(40);
    });
  });

  it('gives every unapplied rule a condition, and every applied rule none', () => {
    ABILITY_QUALITY_EFFECTS.forEach((rule) => {
      if (rule.applied) expect(rule.condition, `${rule.ability}`).toBeUndefined();
      else expect(rule.condition, `${rule.ability}`).toBeTruthy();
    });
  });

  it('holds one rule per ability', () => {
    const abilities = ABILITY_QUALITY_EFFECTS.map((rule) => rule.ability);
    expect(new Set(abilities).size).toBe(abilities.length);
  });

  it('keeps every applied multiplier modest', () => {
    // These scale a component of a 0..1 quality score that already compresses
    // at the top, so a large multiplier here is a very large effect. Anything
    // approaching a doubling is a sign an ability is being treated as a stat.
    ABILITY_QUALITY_EFFECTS.filter((rule) => rule.applied).forEach((rule) => {
      expect(rule.multiplier, `${rule.ability}`).toBeGreaterThan(1);
      expect(rule.multiplier, `${rule.ability}`).toBeLessThanOrEqual(1.25);
    });
  });

  it('excludes move-dependent abilities', () => {
    // The tool cannot see movesets, so crediting these would be scoring
    // something it has no data for.
    ['prankster', 'sheer-force', 'technician', 'tough-claws'].forEach((ability) => {
      expect(hasAbilityQualityRule(ability), `${ability} should be recorded`).toBe(true);
      expect(getAbilityQualityEffect(ability), `${ability} should not apply`).toBeUndefined();
    });
  });
});

describe('getQualityMultipliers', () => {
  it('scales the component the ability actually affects', () => {
    expect(getQualityMultipliers('multiscale')).toEqual({ bulk: 1.25, offense: 1 });
    expect(getQualityMultipliers('adaptability')).toEqual({ bulk: 1, offense: 1.15 });
  });

  it('is neutral for an ability it does not model', () => {
    expect(getQualityMultipliers('blaze')).toEqual({ bulk: 1, offense: 1 });
    expect(getQualityMultipliers(undefined)).toEqual({ bulk: 1, offense: 1 });
  });
});

describe('scoreMemberQuality with an ability effect', () => {
  const stats = { hp: 91, attack: 134, defense: 95, 'special-attack': 100, 'special-defense': 100, speed: 80 };
  const base = { stats, normalizedDamageToScore: 0.6, normalizedDamageFromScore: 0.28 };

  it('raises quality for a durability ability', () => {
    expect(scoreMemberQuality({ ...base, abilityName: 'multiscale' }))
      .toBeGreaterThan(scoreMemberQuality({ ...base, abilityName: 'inner-focus' }));
  });

  it('raises quality for an offensive ability', () => {
    expect(scoreMemberQuality({ ...base, abilityName: 'adaptability' }))
      .toBeGreaterThan(scoreMemberQuality({ ...base, abilityName: 'inner-focus' }));
  });

  it('scores an omitted ability as though it does nothing', () => {
    // The safe direction: an unknown ability must not silently earn credit.
    expect(scoreMemberQuality(base)).toBe(scoreMemberQuality({ ...base, abilityName: 'blaze' }));
  });

  it('stays within 0..1', () => {
    const maxed = {
      stats: { hp: 255, attack: 255, defense: 255, 'special-attack': 255, 'special-defense': 255, speed: 255 },
      normalizedDamageToScore: 1,
      normalizedDamageFromScore: 0,
      abilityName: 'multiscale'
    };
    expect(scoreMemberQuality(maxed)).toBeLessThanOrEqual(1);
  });
});
