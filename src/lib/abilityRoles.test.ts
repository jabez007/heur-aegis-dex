import { describe, expect, it } from 'vitest';
import {
  ABILITY_ROLES,
  DOUBLES_ABILITIES,
  analyzeTeamRoles,
  getAbilityEffect,
  isImmuneToAllyMoves
} from './abilityRoles';

describe('ability effects', () => {
  it('maps intimidate to its own role', () => {
    expect(getAbilityEffect('intimidate')?.role).toBe('intimidate');
  });

  it('returns undefined for abilities with no modelled doubles role', () => {
    expect(getAbilityEffect('blaze')).toBeUndefined();
    expect(getAbilityEffect(undefined)).toBeUndefined();
    expect(getAbilityEffect(null)).toBeUndefined();
    expect(getAbilityEffect('')).toBeUndefined();
  });

  it('only treats telepathy as immunity to ally moves', () => {
    expect(isImmuneToAllyMoves('telepathy')).toBe(true);
    // Friend Guard reduces damage from opponents, not from the ally.
    expect(isImmuneToAllyMoves('friend-guard')).toBe(false);
    expect(isImmuneToAllyMoves('intimidate')).toBe(false);
  });

  it('gives every field setter a field state so clashes are detectable', () => {
    Object.entries(DOUBLES_ABILITIES).forEach(([name, effect]) => {
      if (effect.role === 'weather-setter' || effect.role === 'terrain-setter') {
        expect(effect.fieldState, `${name} needs a fieldState`).toBeTruthy();
      }
    });
  });

  it('declares every role used by an ability', () => {
    Object.values(DOUBLES_ABILITIES).forEach((effect) => {
      expect(ABILITY_ROLES).toContain(effect.role);
    });
  });
});

describe('analyzeTeamRoles', () => {
  it('reports the distinct roles a team covers', () => {
    const analysis = analyzeTeamRoles([
      { abilityName: 'intimidate' },
      { abilityName: 'lightning-rod' },
      { abilityName: 'blaze' }
    ]);

    expect(analysis.roles).toEqual(['intimidate', 'redirection']);
    expect(analysis.roleSources.redirection).toEqual(['lightning-rod']);
    expect(analysis.fieldConflicts).toEqual([]);
  });

  it('counts a duplicated role once rather than twice', () => {
    // A second Intimidate is perfectly playable but adds no new capability, so
    // breadth must not reward it again.
    const single = analyzeTeamRoles([{ abilityName: 'intimidate' }]);
    const doubled = analyzeTeamRoles([{ abilityName: 'intimidate' }, { abilityName: 'intimidate' }]);

    expect(doubled.roles).toEqual(single.roles);
    expect(doubled.roleSources.intimidate).toEqual(['intimidate']);
  });

  it('flags members competing to set incompatible weather', () => {
    const analysis = analyzeTeamRoles([
      { abilityName: 'drought' },
      { abilityName: 'drizzle' }
    ]);

    expect(analysis.fieldConflicts).toEqual(['weather-setter']);
    expect(analysis.conflictingAbilities).toEqual(expect.arrayContaining(['drought', 'drizzle']));
  });

  it('does not flag two members setting the same field state', () => {
    const analysis = analyzeTeamRoles([
      { abilityName: 'drought' },
      { abilityName: 'drought' }
    ]);

    expect(analysis.fieldConflicts).toEqual([]);
  });

  it('treats weather and terrain as independent, non-conflicting layers', () => {
    const analysis = analyzeTeamRoles([
      { abilityName: 'drought' },
      { abilityName: 'grassy-surge' }
    ]);

    expect(analysis.fieldConflicts).toEqual([]);
    expect(analysis.roles).toEqual(expect.arrayContaining(['weather-setter', 'terrain-setter']));
  });

  it('detects a terrain clash separately from weather', () => {
    const analysis = analyzeTeamRoles([
      { abilityName: 'grassy-surge' },
      { abilityName: 'psychic-surge' },
      { abilityName: 'drought' }
    ]);

    expect(analysis.fieldConflicts).toEqual(['terrain-setter']);
  });

  it('handles members with no ability selected', () => {
    const analysis = analyzeTeamRoles([{}, { abilityName: undefined }]);

    expect(analysis.roles).toEqual([]);
    expect(analysis.fieldConflicts).toEqual([]);
  });
});
