import { describe, expect, it } from 'vitest';
import {
  COVERAGE_MOVE_TYPES,
  buildOffensiveTypeChart,
  getAttackerBias,
  getCoverageMoveTypes,
  getMoveCoverage,
  hasCoverageMoveData
} from './coverageMoves';
import type { PokemonTypeData } from './pokedexTypes';

const relations = (doubleDamageTo: string[]) => ({
  double_damage_from: [], half_damage_from: [], no_damage_from: [],
  double_damage_to: doubleDamageTo.map((name) => ({ name })),
  half_damage_to: [], no_damage_to: []
});

const baseTypes = [
  { name: 'fire', damage_relations: relations(['grass', 'ice', 'bug', 'steel']) },
  { name: 'ground', damage_relations: relations(['fire', 'electric', 'poison', 'rock', 'steel']) },
  { name: 'water', damage_relations: relations(['fire', 'ground', 'rock']) },
  // A dual type must never end up in the chart as an attacking type.
  { name: 'fire/ground', damage_relations: relations(['grass', 'rock']) }
] as unknown as PokemonTypeData[];

describe('buildOffensiveTypeChart', () => {
  it('maps each base type to what it hits super-effectively', () => {
    const chart = buildOffensiveTypeChart(baseTypes);

    expect(chart.fire).toEqual(['grass', 'ice', 'bug', 'steel']);
    expect(chart.ground).toContain('steel');
  });

  it('excludes synthesized dual types, which are never attacking types', () => {
    expect(buildOffensiveTypeChart(baseTypes)['fire/ground']).toBeUndefined();
  });

  it('tolerates types with no damage relations', () => {
    const chart = buildOffensiveTypeChart([{ name: 'mystery' }] as unknown as PokemonTypeData[]);
    expect(chart.mystery).toEqual([]);
  });
});

describe('coverage move table', () => {
  it('records the real Champions movepool for a known attacker', () => {
    // Garchomp reaches steel and ice through Iron Head and Fire Fang, neither of
    // which its Ground/Dragon typing can see.
    const moveTypes = getCoverageMoveTypes('garchomp');

    expect(moveTypes).toContain('fire');
    expect(moveTypes).toContain('steel');
    expect(moveTypes).toContain('water');
  });

  it('keys on variety names so regional and mega forms resolve', () => {
    expect(hasCoverageMoveData('raichu-alola')).toBe(true);
    expect(hasCoverageMoveData('charizard-mega-x')).toBe(true);
  });

  it('omits Pokemon with no qualifying damaging move', () => {
    // Ditto only learns Transform, so it is absent rather than present-and-empty.
    expect(hasCoverageMoveData('ditto')).toBe(false);
    expect(getCoverageMoveTypes('ditto')).toEqual([]);
  });

  it('returns an empty list for unknown or missing names', () => {
    expect(getCoverageMoveTypes('not-a-pokemon')).toEqual([]);
    expect(getCoverageMoveTypes(undefined)).toEqual([]);
    expect(getCoverageMoveTypes(null)).toEqual([]);
    expect(hasCoverageMoveData(undefined)).toBe(false);
  });

  it('only contains valid elemental type names', () => {
    const validTypes = new Set([
      'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
      'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'
    ]);

    Object.entries(COVERAGE_MOVE_TYPES).forEach(([variety, entry]) => {
      const allTypes = [...entry.physical, ...entry.special];
      expect(allTypes.length, `${variety} should not be empty`).toBeGreaterThan(0);
      allTypes.forEach((type) => {
        expect(validTypes, `${variety} has unexpected type ${type}`).toContain(type);
      });
    });
  });

  it('keeps each damage class sorted and free of duplicates', () => {
    Object.entries(COVERAGE_MOVE_TYPES).forEach(([variety, entry]) => {
      ([['physical', entry.physical], ['special', entry.special]] as const).forEach(([label, types]) => {
        expect([...types], `${variety} ${label} should be sorted`).toEqual([...types].sort());
        expect(new Set(types).size, `${variety} ${label} should be unique`).toBe(types.length);
      });
    });
  });
});

describe('getAttackerBias', () => {
  const stats = (attack: number, specialAttack: number) => ({
    hp: 80, attack, defense: 80, 'special-attack': specialAttack, 'special-defense': 80, speed: 80
  });

  it('reads a one-sided attacker off its stats', () => {
    expect(getAttackerBias(stats(50, 95))).toBe('special');
    expect(getAttackerBias(stats(160, 106))).toBe('physical');
  });

  it('treats close attacking stats as mixed', () => {
    // A 10% gap is not enough to rule out one of four moveslots.
    expect(getAttackerBias(stats(100, 110))).toBe('mixed');
    expect(getAttackerBias(stats(100, 100))).toBe('mixed');
  });

  it('falls back to mixed rather than guessing', () => {
    // Unknown stats should yield the full "can reach" answer, not half of it.
    expect(getAttackerBias(undefined)).toBe('mixed');
    expect(getAttackerBias(null)).toBe('mixed');
    expect(getAttackerBias(stats(0, 0))).toBe('mixed');
  });
});

describe('damage class filtering', () => {
  // Pelipper is the case that motivated the split: it learns Crunch, Iron Head,
  // X-Scissor and Poison Jab, none of which it can use at 50 Attack.
  const pelipperStats = {
    hp: 60, attack: 50, defense: 100, 'special-attack': 95, 'special-defense': 70, speed: 65
  };

  it('drops types only reachable through the wrong stat', () => {
    const special = getCoverageMoveTypes('pelipper', pelipperStats);

    expect(special).not.toContain('dark');
    expect(special).not.toContain('steel');
    expect(special).not.toContain('poison');
    expect(special).toContain('ice');
    expect(special).toContain('water');
  });

  it('returns both classes when no stats are supplied', () => {
    // The honest answer for an unknown bias, and the pre-split reading.
    const either = getCoverageMoveTypes('pelipper');

    expect(either).toContain('dark');
    expect(either).toContain('ice');
    expect(either.length).toBeGreaterThan(getCoverageMoveTypes('pelipper', pelipperStats).length);
  });

  it('keeps both classes for a genuinely mixed attacker', () => {
    const mixed = { hp: 80, attack: 100, defense: 80, 'special-attack': 105, 'special-defense': 80, speed: 80 };
    expect(getCoverageMoveTypes('pelipper', mixed)).toEqual(getCoverageMoveTypes('pelipper'));
  });

  it('narrows the coverage the type chart then expands', () => {
    // Water is one of Pelipper's special move types and dark is physical-only,
    // so the chart has to map both for the difference to survive expansion.
    const chart = { water: ['fire', 'rock'], dark: ['ghost', 'psychic'] };
    const biased = getMoveCoverage('pelipper', chart, pelipperStats);
    const either = getMoveCoverage('pelipper', chart);

    expect(biased).toEqual(['fire', 'rock']);
    expect(either).toEqual(['fire', 'ghost', 'psychic', 'rock']);
  });
});

describe('getMoveCoverage', () => {
  const chart = buildOffensiveTypeChart(baseTypes);

  it('expands move types into the defending types they beat', () => {
    // A Pokemon with fire and water moves reaches everything either type beats.
    const coverage = getMoveCoverage('garchomp', chart);

    expect(coverage).toContain('steel');
    expect(coverage).toContain('grass');
    expect(coverage).toEqual([...coverage].sort());
  });

  it('deduplicates types reachable through more than one move type', () => {
    // Both ground and water beat rock; it should appear once.
    const coverage = getMoveCoverage('garchomp', chart);
    expect(coverage.filter((type) => type === 'rock')).toHaveLength(1);
  });

  it('returns nothing for a Pokemon absent from the table', () => {
    expect(getMoveCoverage('ditto', chart)).toEqual([]);
    expect(getMoveCoverage('not-a-pokemon', chart)).toEqual([]);
  });

  it('returns nothing when the chart has no entry for the move types', () => {
    expect(getMoveCoverage('garchomp', {})).toEqual([]);
  });
});
