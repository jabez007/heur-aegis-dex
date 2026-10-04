import { describe, expect, it } from 'vitest';
import {
  STATUS_THREAT,
  getStatusImmunityMultipliers,
  grantsStatusImmunity
} from './statusThreat';
import { STATUS_MOVE_AILMENTS } from './statusMoveData';
import { getQualityMultipliers } from './abilityEffects';
import { scoreMemberQuality } from './teamScoring';
import type { PokemonStats } from './pokedexTypes';

const line = (over: Partial<PokemonStats> = {}): PokemonStats => ({
  hp: 100, attack: 100, defense: 100,
  'special-attack': 100, 'special-defense': 100, speed: 100,
  ...over
});

describe('STATUS_THREAT', () => {
  it('stays a probability', () => {
    Object.entries(STATUS_THREAT).forEach(([ailment, share]) => {
      expect(share, ailment).toBeGreaterThan(0);
      expect(share, ailment).toBeLessThan(1);
    });
  });

  it('matches what the move table actually contains', () => {
    // The constant is pasted by hand from a script, which is the house style but
    // also the failure mode: a regenerated table and a stale constant would
    // disagree silently. This does not re-derive the pool frequency — that needs
    // the regulation roster — but it does catch a condition vanishing entirely.
    const found = new Set(Object.values(STATUS_MOVE_AILMENTS).flat());
    Object.keys(STATUS_THREAT).forEach((ailment) => {
      expect(found.has(ailment as never), `${ailment} is priced but nothing inflicts it`).toBe(true);
    });
  });

  it('holds no entry for a condition nothing reliably inflicts', () => {
    // Freeze is the case: it exists in the game and appears only as a secondary
    // chance, so the reliability bar drops it. Pricing it would invent a threat.
    const found = new Set(Object.values(STATUS_MOVE_AILMENTS).flat());
    expect(found.has('freeze')).toBe(false);
    expect('freeze' in STATUS_THREAT).toBe(false);
  });
});

describe('getStatusImmunityMultipliers', () => {
  it('credits a physical attacker far more than a special one', () => {
    // The reason this is derived at all. Burn halves Attack, so an immunity is
    // worth roughly nothing to a Pokemon that never uses it.
    const physical = getStatusImmunityMultipliers(line({ attack: 130, 'special-attack': 40 }));
    const special = getStatusImmunityMultipliers(line({ attack: 40, 'special-attack': 130 }));

    // Compared as credit above 1, not as the multipliers themselves — both sit
    // near 1, so a ratio of the raw values would be near 1 whatever happened.
    expect(physical.offense - 1).toBeGreaterThan((special.offense - 1) * 3);
  });

  it('never charges a Pokemon for the ability', () => {
    const m = getStatusImmunityMultipliers(line({ attack: 5, 'special-attack': 200 }));
    expect(m.offense).toBeGreaterThanOrEqual(1);
    expect(m.speed).toBeGreaterThanOrEqual(1);
  });

  it('gives the same speed credit to everyone', () => {
    // Paralysis halves Speed proportionally, so the multiplier cannot depend on
    // the stat line. What differs is its effect after OBSERVED_STAT_TERMS
    // rescales, which is asserted below rather than here.
    expect(getStatusImmunityMultipliers(line({ speed: 30 })).speed)
      .toBeCloseTo(getStatusImmunityMultipliers(line({ speed: 140 })).speed, 12);
  });

  it('derives the speed multiplier from the measured frequency', () => {
    expect(getStatusImmunityMultipliers(line()).speed)
      .toBeCloseTo(1 / (1 - (STATUS_THREAT.paralysis / 2)), 12);
  });

  it('survives a Pokemon with no attacking stat', () => {
    const m = getStatusImmunityMultipliers(line({ attack: 0, 'special-attack': 0 }));
    expect(Number.isFinite(m.offense)).toBe(true);
    expect(m.offense).toBe(1);
  });
});

describe('purifying-salt through the ability tables', () => {
  it('scores as nothing when stats are not supplied', () => {
    // The safe direction, and the same rule an unmodelled ability follows.
    expect(getQualityMultipliers('purifying-salt')).toEqual({ bulk: 1, offense: 1, speed: 1 });
  });

  it('credits offence and speed rather than bulk', () => {
    // The old constant was 1.08 on bulk, which is the wrong term twice over:
    // what burn takes is Attack and what paralysis takes is Speed.
    const m = getQualityMultipliers('purifying-salt', line({ attack: 130, 'special-attack': 45 }));
    expect(m.bulk).toBe(1);
    expect(m.offense).toBeGreaterThan(1);
    expect(m.speed).toBeGreaterThan(1);
  });

  it('is worth more to a physical attacker than a special one', () => {
    const base = { normalizedDamageToScore: 0.5, normalizedDamageFromScore: 0.5 };
    const gain = (stats: PokemonStats) =>
      scoreMemberQuality({ stats, ...base, abilityName: 'purifying-salt' })
      - scoreMemberQuality({ stats, ...base });

    expect(gain(line({ attack: 130, 'special-attack': 45 })))
      .toBeGreaterThan(gain(line({ attack: 45, 'special-attack': 130 })));
  });

  it('gives an already-fast Pokemon less speed credit than a slow one', () => {
    // Same shape as the Speed Boost claim: the term clamps at its observed
    // ceiling, so protecting speed you have already maxed out buys less.
    const base = { normalizedDamageToScore: 0.5, normalizedDamageFromScore: 0.5 };
    const gain = (speed: number) => {
      const stats = line({ speed });
      return scoreMemberQuality({ stats, ...base, abilityName: 'purifying-salt' })
        - scoreMemberQuality({ stats, ...base });
    };
    expect(gain(145)).toBeLessThan(gain(60));
  });

  it('reports only blanket immunities as granting one', () => {
    expect(grantsStatusImmunity('purifying-salt')).toBe(true);
    // Good as Gold blocks status *moves*, not Toxic Spikes or a contact burn.
    // Broader in one direction, narrower in another, and deliberately not here.
    expect(grantsStatusImmunity('good-as-gold')).toBe(false);
    expect(grantsStatusImmunity(undefined)).toBe(false);
  });
});
