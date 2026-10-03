import { describe, expect, it } from 'vitest';
import {
  REGULATIONS,
  canMegaEvolve,
  getActiveRegulation,
  getRegulationCoverageGap,
  getRegulation,
  hasCompleteData,
  isSpeciesLegal
} from './regulations';
import { getBattleFormat } from './battleFormats';

const mA = getRegulation('M-A')!;
const mB = getRegulation('M-B')!;
const mC = getRegulation('M-C')!;

describe('regulation rosters', () => {
  it('records the published roster sizes', () => {
    expect(mA.legalSpecies.size).toBe(186);
    expect(mB.legalSpecies.size).toBe(208);
    expect(mB.megaCapableSpecies.size).toBe(73);
  });

  it('treats M-B as a strict superset of M-A, adding exactly 22 species', () => {
    const removed = [...mA.legalSpecies].filter((species) => !mB.legalSpecies.has(species));
    const added = [...mB.legalSpecies].filter((species) => !mA.legalSpecies.has(species));

    expect(removed).toEqual([]);
    expect(added).toHaveLength(22);
  });

  it('only lets legal species Mega Evolve', () => {
    const illegalMegas = [...mB.megaCapableSpecies].filter((species) => !mB.legalSpecies.has(species));
    expect(illegalMegas).toEqual([]);
  });

  it('uses PokeAPI species naming rather than display names', () => {
    // Verified against PokeAPI on 2026-07-27; these are the two names in the
    // roster whose display form does not lowercase cleanly.
    expect(isSpeciesLegal(mB, 'mr-rime')).toBe(true);
    expect(isSpeciesLegal(mB, 'kommo-o')).toBe(true);
    expect(isSpeciesLegal(mB, 'Mr. Rime')).toBe(false);
  });

  it('admits species whose regional forms were listed separately', () => {
    // PokeAPI models Alolan Raichu and Galarian Slowking as varieties of
    // raichu and slowking, so the base species carries their legality.
    expect(isSpeciesLegal(mB, 'raichu')).toBe(true);
    expect(isSpeciesLegal(mB, 'slowking')).toBe(true);
    expect(isSpeciesLegal(mB, 'tauros')).toBe(true);
  });

  it('excludes restricted and legendary species', () => {
    ['koraidon', 'miraidon', 'flutter-mane', 'chi-yu', 'calyrex', 'rayquaza'].forEach((species) => {
      expect(isSpeciesLegal(mB, species)).toBe(false);
    });
  });

  it('treats M-C as a strict superset of M-B, adding exactly 23 species', () => {
    const removed = [...mB.legalSpecies].filter((species) => !mC.legalSpecies.has(species));
    const added = [...mC.legalSpecies].filter((species) => !mB.legalSpecies.has(species));

    expect(removed).toEqual([]);
    expect(added).toHaveLength(23);
    expect(mC.legalSpecies.size).toBe(231);
  });

  it('keeps every M-B Mega and adds Salamence, Golisopod and Baxcalibur in M-C', () => {
    const lost = [...mB.megaCapableSpecies].filter((species) => !mC.megaCapableSpecies.has(species));
    const gained = [...mC.megaCapableSpecies].filter((species) => !mB.megaCapableSpecies.has(species));

    expect(lost).toEqual([]);
    expect(gained.sort()).toEqual(['baxcalibur', 'golisopod', 'salamence']);
    expect([...mC.megaCapableSpecies].filter((species) => !mC.legalSpecies.has(species))).toEqual([]);
  });

  it('recognises the M-C additions under their PokeAPI names', () => {
    ['rillaboom', 'pawmot', 'farfetchd', 'sirfetchd', 'mr-mime', 'indeedee'].forEach((species) => {
      expect(isSpeciesLegal(mB, species)).toBe(false);
      expect(isSpeciesLegal(mC, species)).toBe(true);
    });
  });

  it('recognises the M-B additions', () => {
    ['gholdengo', 'annihilape', 'metagross', 'blaziken', 'sceptile', 'swampert'].forEach((species) => {
      expect(isSpeciesLegal(mA, species)).toBe(false);
      expect(isSpeciesLegal(mB, species)).toBe(true);
    });
  });
});

describe('regulation lookup', () => {
  it('returns undefined for unknown or missing ids', () => {
    expect(getRegulation('M-Z')).toBeUndefined();
    expect(getRegulation(null)).toBeUndefined();
    expect(getRegulation(undefined)).toBeUndefined();
  });

  it('resolves the regulation active on a given date', () => {
    expect(getActiveRegulation(new Date('2026-05-01T00:00:00Z'))?.id).toBe('M-A');
    expect(getActiveRegulation(new Date('2026-07-27T00:00:00Z'))?.id).toBe('M-B');
    expect(getActiveRegulation(new Date('2026-10-03T00:00:00Z'))?.id).toBe('M-C');
  });

  it('leaves the week between M-B and M-C uncovered', () => {
    expect(getActiveRegulation(new Date('2026-09-05T00:00:00Z'))).toBeUndefined();
    expect(getActiveRegulation(new Date('2026-09-09T01:59:59Z'))).toBeUndefined();
    expect(getActiveRegulation(new Date('2026-09-09T02:00:00Z'))?.id).toBe('M-C');
    expect(getActiveRegulation(new Date('2026-12-02T01:59:00Z'))).toBeUndefined();
  });

  it('treats regulation boundaries as half-open so they never overlap', () => {
    // M-A ends exactly when M-B begins; the instant belongs to M-B alone.
    expect(getActiveRegulation(new Date('2026-06-17T02:00:00Z'))?.id).toBe('M-B');
    expect(getActiveRegulation(new Date('2026-06-17T01:59:59Z'))?.id).toBe('M-A');
  });

  it('returns undefined outside every known regulation window', () => {
    expect(getActiveRegulation(new Date('2026-01-01T00:00:00Z'))).toBeUndefined();
    expect(getActiveRegulation(new Date('2027-01-01T00:00:00Z'))).toBeUndefined();
  });

  it('reports schedule gaps instead of treating unrestricted play as a regulation', () => {
    expect(getRegulationCoverageGap(
      new Date('2026-05-01T00:00:00Z'),
      new Date('2026-08-01T00:00:00Z')
    )).toBeUndefined();
    expect(getRegulationCoverageGap(
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-10-01T00:00:00Z')
    )?.toISOString()).toBe('2026-09-02T05:59:00.000Z');
  });
});

describe('data completeness', () => {
  it('flags M-A mega data as unrecorded rather than empty', () => {
    expect(hasCompleteData(mA, 'megaCapableSpecies')).toBe(false);
    expect(hasCompleteData(mB, 'megaCapableSpecies')).toBe(true);
    // canMegaEvolve returns false for M-A because the answer is unknown, which
    // is exactly why callers must consult hasCompleteData first.
    expect(canMegaEvolve(mA, 'charizard')).toBe(false);
    expect(canMegaEvolve(mB, 'charizard')).toBe(true);
  });

  it('carries provenance for every regulation', () => {
    REGULATIONS.forEach((regulation) => {
      expect(regulation.sources.length).toBeGreaterThan(0);
      expect(regulation.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

describe('regulation rules', () => {
  it('supports both formats off the same roster', () => {
    // Champions runs singles and doubles from one registered team; only the
    // bring count differs, which is a property of the format not the regulation.
    expect(mB.rules.formats).toEqual(['singles', 'doubles']);
    expect(mB.rules.battleLevel).toBe(50);
    expect(mB.rules.allowDuplicateSpecies).toBe(false);
    expect(mB.rules.allowDuplicateItems).toBe(false);
  });

  it('resolves roster and bring sizes through the format', () => {
    expect(getBattleFormat('singles').broughtToBattle).toBe(3);
    expect(getBattleFormat('doubles').broughtToBattle).toBe(4);
    expect(getBattleFormat('doubles').maxRosterSize).toBe(6);
  });

  it('lists Mega Evolution as the only active mechanic', () => {
    expect(mB.mechanics).toEqual(['mega']);
  });
});
