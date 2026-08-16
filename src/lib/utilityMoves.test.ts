import { describe, expect, it } from 'vitest';
import { UTILITY_MOVE_ROLES, getUtilityRoles, hasUtilityMoveData } from './utilityMoves';
import { ABILITY_ROLES, analyzeTeamRoles } from './abilityRoles';

describe('utility move table', () => {
  it('records support a Pokemon brings with a move, not an ability', () => {
    // Pelipper's Drizzle is already an ability role; Wide Guard and Tailwind are
    // the half of it the model could not see.
    expect(getUtilityRoles('pelipper')).toEqual(['ally-protection', 'speed-control']);
    // Corviknight is ranked on its attacking stat and played for Tailwind.
    expect(getUtilityRoles('corviknight')).toEqual(['screens', 'speed-control']);
  });

  it('records nothing for Pokemon whose support is already an ability', () => {
    // Torkoal is Drought and Incineroar is Intimidate. Both are scored through
    // `abilityRoles`, and neither learns a move in the selected set — so an empty
    // entry here is the table agreeing with the ability layer, not a gap.
    expect(getUtilityRoles('torkoal')).toEqual([]);
    expect(getUtilityRoles('incineroar')).toEqual([]);
  });

  it('only ever emits roles the model actually scores', () => {
    const roles = new Set(Object.values(UTILITY_MOVE_ROLES).flat());
    for (const role of roles) expect(ABILITY_ROLES).toContain(role);
  });

  it('stays selective, unlike the coverage table', () => {
    // The guard against repeating the Normal-as-coverage defect. Protect is on
    // 100% of the roster and Sunny Day on 74%; a capability most of the pool has
    // discriminates nothing.
    //
    // The denominator is the *roster*, not this table. Varieties with no role at
    // all are absent from the literal, so dividing by its length would measure
    // "of the Pokemon that have a role, how many have this one" — which read 73%
    // for screens and failed, while screens is on 40% of the roster. Taken from
    // the count recorded in the generated header.
    const VARIETIES_GENERATED = 359;
    const counts: Record<string, number> = {};
    for (const roles of Object.values(UTILITY_MOVE_ROLES)) {
      for (const role of roles) counts[role] = (counts[role] ?? 0) + 1;
    }
    expect(Object.keys(UTILITY_MOVE_ROLES).length).toBeLessThanOrEqual(VARIETIES_GENERATED);
    for (const count of Object.values(counts)) {
      expect(count / VARIETIES_GENERATED).toBeLessThan(0.5);
    }
  });

  it('separates absence from ignorance', () => {
    expect(hasUtilityMoveData('pelipper')).toBe(true);
    expect(hasUtilityMoveData('garchomp')).toBe(false);
    expect(getUtilityRoles('garchomp')).toEqual([]);
    expect(getUtilityRoles(null)).toEqual([]);
  });
});

describe('analyzeTeamRoles with move-sourced roles', () => {
  it('reports move roles apart from ability roles', () => {
    const analysis = analyzeTeamRoles([
      { abilityName: 'intimidate', varietyName: 'incineroar' },
      { abilityName: 'pressure', varietyName: 'corviknight' }
    ]);

    expect(analysis.roles).toEqual(['intimidate']);
    // Corviknight brings Tailwind and screens; Incineroar's burn is a role from
    // the status table, which is the other move-sourced source.
    expect(analysis.moveRoles).toEqual(['speed-control', 'screens', 'disruption']);
  });

  it('does not pay twice for a role an ability already covers', () => {
    // Pelipper supplies ally-protection by move and Telepathy supplies it by
    // ability. The team has that capability once.
    const analysis = analyzeTeamRoles([
      { abilityName: 'telepathy', varietyName: 'oranguru' },
      { abilityName: 'drizzle', varietyName: 'pelipper' }
    ]);

    expect(analysis.roles).toContain('ally-protection');
    expect(analysis.moveRoles).not.toContain('ally-protection');
    expect(analysis.moveRoles).toContain('speed-control');
  });

  it('scores abilities only when no variety name is given', () => {
    // The pre-table behaviour, which every caller that has not been updated
    // still gets rather than silently losing roles.
    const analysis = analyzeTeamRoles([{ abilityName: 'pressure' }]);
    expect(analysis.moveRoles).toEqual([]);
  });
});

describe('weather abusers', () => {
  it('scores both halves of the weather interaction', async () => {
    const { getAbilityEffect } = await import('./abilityRoles');

    // The asymmetry this closed: the setter had a role and the abuser did not.
    expect(getAbilityEffect('sand-stream')?.role).toBe('weather-setter');
    expect(getAbilityEffect('sand-rush')?.role).toBe('weather-abuser');
    // And they have to agree about which weather, or the pairing cannot be found.
    expect(getAbilityEffect('sand-rush')?.fieldState)
      .toBe(getAbilityEffect('sand-stream')?.fieldState);
  });

  it('does not credit evasion or chip healing as abusing weather', async () => {
    const { getAbilityEffect } = await import('./abilityRoles');

    // Load-bearing rather than tidy. Snow Cloak is Mamoswine's ability, and
    // Mamoswine outranking Excadrill is the case the weather work exists to fix;
    // crediting evasion would raise both and fix nothing.
    expect(getAbilityEffect('snow-cloak')).toBeUndefined();
    expect(getAbilityEffect('sand-veil')).toBeUndefined();
    expect(getAbilityEffect('ice-body')).toBeUndefined();
    expect(getAbilityEffect('rain-dish')).toBeUndefined();
  });

  it('counts an abuser only when the team sets its weather', () => {
    const withSand = analyzeTeamRoles([
      { abilityName: 'sand-stream', varietyName: 'hippowdon' },
      { abilityName: 'sand-rush', varietyName: 'excadrill' }
    ]);
    expect(withSand.roles).toContain('weather-abuser');

    // Sand Rush with no sand is a blank, and role breadth must not reward a
    // capability the team cannot perform.
    const alone = analyzeTeamRoles([{ abilityName: 'sand-rush', varietyName: 'excadrill' }]);
    expect(alone.roles).not.toContain('weather-abuser');

    // The wrong weather is no better than none.
    const mismatched = analyzeTeamRoles([
      { abilityName: 'drought', varietyName: 'torkoal' },
      { abilityName: 'sand-rush', varietyName: 'excadrill' }
    ]);
    expect(mismatched.roles).not.toContain('weather-abuser');
    expect(mismatched.roles).toContain('weather-setter');
  });
});
