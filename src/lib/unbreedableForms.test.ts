import { describe, expect, it } from 'vitest';
import {
  UNBREEDABLE_FORMS,
  UNBREEDABLE_VARIETIES,
  VERIFIED_ON,
  VERIFIED_SPECIES_COUNT,
  hasUnbreedableFormRule,
  isVarietyBreedable
} from './unbreedableForms';
import { REGULATIONS } from './regulations';
import { describeRosterStaleness } from './rosterStaleness.fixture';

describe('UNBREEDABLE_FORMS', () => {
  it('records a reason for every entry, excluded or kept', () => {
    // The kept entries are the point of the table as much as the excluded ones:
    // a bare absence cannot be told apart from an oversight.
    UNBREEDABLE_FORMS.forEach((rule) => {
      expect(rule.reason.length).toBeGreaterThan(40);
    });
  });

  it('names species that are actually legal', () => {
    const legal = REGULATIONS.find((regulation) => regulation.id === 'M-B')!.legalSpecies;
    UNBREEDABLE_FORMS.forEach((rule) => {
      expect(legal.has(rule.species)).toBe(true);
    });
  });

  it('holds one rule per variety', () => {
    const varieties = UNBREEDABLE_FORMS.map((rule) => rule.variety);
    expect(new Set(varieties).size).toBe(varieties.length);
  });

  it('keys on the variety rather than the species', () => {
    // The whole reason this table exists is that the species-level answer is
    // wrong here. An entry whose variety name is just the species name would be
    // a species-level rule in the wrong file — the egg-group check owns those.
    UNBREEDABLE_FORMS.forEach((rule) => {
      expect(rule.variety).not.toBe(rule.species);
      expect(rule.variety.startsWith(rule.species)).toBe(true);
    });
  });

  it('excludes deliberately rather than by default', () => {
    // If this list starts growing without matching reasons, someone has begun
    // dropping forms for being inconvenient rather than for being unobtainable.
    expect([...UNBREEDABLE_VARIETIES].sort()).toEqual(['floette-eternal', 'greninja-battle-bond']);
  });

  it('records when the roster was last walked', () => {
    // A whitelist of exclusions goes stale quietly. The date is what makes the
    // staleness visible when a regulation adds species.
    expect(VERIFIED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describeRosterStaleness({
  table: 'UNBREEDABLE_FORMS',
  verifiedOn: VERIFIED_ON,
  speciesCount: VERIFIED_SPECIES_COUNT,
  rewalk: 'Re-walk the roster for varieties that clear isRegisterableForm and the stat floors, '
    + 'and record any event-only form among them.'
});

describe('isVarietyBreedable', () => {
  it('rejects varieties recorded as unbreedable', () => {
    expect(isVarietyBreedable('floette-eternal')).toBe(false);
    expect(isVarietyBreedable('greninja-battle-bond')).toBe(false);
  });

  it('accepts varieties considered and kept', () => {
    expect(isVarietyBreedable('basculegion-female')).toBe(true);
    expect(isVarietyBreedable('meowstic-female')).toBe(true);
    expect(isVarietyBreedable('lycanroc-dusk')).toBe(true);
  });

  it('accepts unrecorded varieties, since the table lists exceptions', () => {
    expect(isVarietyBreedable('floette')).toBe(true);
    expect(isVarietyBreedable('greninja')).toBe(true);
    expect(isVarietyBreedable('garchomp')).toBe(true);
  });

  it('does not answer the species-level question', () => {
    // Gholdengo is unbreedable, but by egg group, which is not this table's job.
    // Returning true here is correct; the scan applies both checks.
    expect(isVarietyBreedable('gholdengo')).toBe(true);
  });
});

describe('hasUnbreedableFormRule', () => {
  it('reports considered varieties whether or not they are excluded', () => {
    expect(hasUnbreedableFormRule('floette-eternal')).toBe(true);
    expect(hasUnbreedableFormRule('basculegion-female')).toBe(true);
    expect(hasUnbreedableFormRule('rotom-wash')).toBe(false);
  });
});
