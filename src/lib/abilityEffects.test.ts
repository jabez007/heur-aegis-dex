import { describe, expect, it } from 'vitest';
import {
  ABILITY_QUALITY_EFFECTS,
  getAbilityQualityEffect,
  getQualityMultipliers,
  hasAbilityQualityRule
} from './abilityEffects';
import { MEMBER_WEIGHTS, scoreMemberQuality } from './teamScoring';

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

  it('keeps every applied multiplier a credit rather than a penalty', () => {
    ABILITY_QUALITY_EFFECTS.filter((rule) => rule.applied).forEach((rule) => {
      expect(rule.multiplier, `${rule.ability}`).toBeGreaterThan(1);
      // A loose ceiling that only catches a typo — a misplaced decimal reads as
      // an ability worth more than the Pokemon. The real bound is the next test.
      expect(rule.multiplier, `${rule.ability}`).toBeLessThan(2);
    });
  });

  it('keeps every applied ability a fraction of the component it scales', () => {
    // This used to cap the raw multiplier at 1.25, which measured the wrong
    // thing. The components carry different MEMBER_WEIGHTS and are rescaled
    // against different observed ranges, so the same number means different
    // amounts depending on where it lands — Speed Boost at 1.4 moves quality
    // *less* than Multiscale at 1.25 does.
    //
    // Capping the raw delta instead is no better: the speed term's entire budget
    // is 0.20, so no speed ability can move quality by more than that however
    // absurd its multiplier, and the cap would be vacuous for two components out
    // of three. The comparable quantity is the delta as a share of the budget
    // the component actually has, which is what this asserts.
    //
    // Speed Boost is the largest at 0.29, above Multiscale's 0.235 — recorded
    // rather than smoothed over, because it is the intended ordering.
    //
    // Three stat lines, and every one must hold. A single fixture cannot catch
    // an inflated multiplier: past a certain size the term simply clamps, and
    // the delta stops responding. It is the Pokemon with room left in the range
    // that reveals an ability sized like a stat.
    const lines = [
      { hp: 91, attack: 134, defense: 95, 'special-attack': 100, 'special-defense': 100, speed: 80 },
      { hp: 60, attack: 100, defense: 89, 'special-attack': 55, 'special-defense': 69, speed: 112 },
      { hp: 65, attack: 80, defense: 140, 'special-attack': 40, 'special-defense': 70, speed: 70 }
    ];

    ABILITY_QUALITY_EFFECTS.filter((rule) => rule.applied).forEach((rule) => {
      lines.forEach((stats) => {
        const base = { stats, normalizedDamageToScore: 0.6, normalizedDamageFromScore: 0.28 };
        const share = (scoreMemberQuality({ ...base, abilityName: rule.ability })
          - scoreMemberQuality(base)) / MEMBER_WEIGHTS[rule.component];
        expect(share, `${rule.ability} should earn credit`).toBeGreaterThan(0);
        expect(share, `${rule.ability} is sized like a stat, not an ability`).toBeLessThan(0.35);
      });
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
    expect(getQualityMultipliers('multiscale')).toEqual({ bulk: 1.25, offense: 1, speed: 1 });
    expect(getQualityMultipliers('adaptability')).toEqual({ bulk: 1, offense: 1.15, speed: 1 });
    expect(getQualityMultipliers('speed-boost')).toEqual({ bulk: 1, offense: 1, speed: 1.4 });
  });

  it('is neutral for an ability it does not model', () => {
    expect(getQualityMultipliers('blaze')).toEqual({ bulk: 1, offense: 1, speed: 1 });
    expect(getQualityMultipliers(undefined)).toEqual({ bulk: 1, offense: 1, speed: 1 });
  });

  it('treats Libero exactly as Protean', () => {
    expect(getQualityMultipliers('libero')).toEqual(getQualityMultipliers('protean'));
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

  it('raises quality for a speed ability', () => {
    expect(scoreMemberQuality({ ...base, abilityName: 'speed-boost' }))
      .toBeGreaterThan(scoreMemberQuality({ ...base, abilityName: 'inner-focus' }));
  });

  it('raises quality for a retyping ability', () => {
    expect(scoreMemberQuality({ ...base, abilityName: 'protean' }))
      .toBeGreaterThan(scoreMemberQuality({ ...base, abilityName: 'inner-focus' }));
  });

  it('keeps Protean below Adaptability', () => {
    // Deliberate, and the reason is recorded on the rule: the retype is limited
    // to once per switch-in in recent generations, and it overwrites a defensive
    // typing this tool scores statically. Both unknowns argue for less credit,
    // so if this ever inverts it should be a decision rather than a drift.
    expect(scoreMemberQuality({ ...base, abilityName: 'protean' }))
      .toBeLessThan(scoreMemberQuality({ ...base, abilityName: 'adaptability' }));
  });

  it('gives Speed Boost less to an already-fast Pokemon than to a slow one', () => {
    // The claim made on the rule: the term clamps at its observed ceiling, so
    // speed past the point of outrunning the field buys nothing. A Pokemon near
    // the top of the range must gain less than one with room to climb.
    const gain = (speed: number) => {
      const line = { ...base, stats: { ...stats, speed } };
      return scoreMemberQuality({ ...line, abilityName: 'speed-boost' })
        - scoreMemberQuality({ ...line, abilityName: 'inner-focus' });
    };
    expect(gain(130)).toBeLessThan(gain(70));
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
