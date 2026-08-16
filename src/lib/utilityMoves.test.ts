import { describe, expect, it } from 'vitest';
import { UTILITY_MOVE_ROLES, getUtilityRoles, hasUtilityMoveData } from './utilityMoves';
import { ABILITY_ROLES, analyzeTeamRoles } from './abilityRoles';

describe('utility move table', () => {
  it('records support a Pokemon brings with a move, not an ability', () => {
    // Pelipper's Drizzle is already an ability role; Wide Guard and Tailwind are
    // the half of it the model could not see.
    expect(getUtilityRoles('pelipper')).toEqual(['ally-protection', 'speed-control']);
    // Corviknight is ranked on its attacking stat and played for Tailwind.
    expect(getUtilityRoles('corviknight')).toEqual(['speed-control']);
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
    // discriminates nothing. Every role here is held by well under half.
    const total = Object.keys(UTILITY_MOVE_ROLES).length;
    const counts: Record<string, number> = {};
    for (const roles of Object.values(UTILITY_MOVE_ROLES)) {
      for (const role of roles) counts[role] = (counts[role] ?? 0) + 1;
    }
    for (const count of Object.values(counts)) expect(count / total).toBeLessThan(0.7);
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
    expect(analysis.moveRoles).toEqual(['speed-control']);
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
