import { describe, expect, it } from 'vitest';
import {
  COVERAGE_MOVE_TYPES,
  buildOffensiveTypeChart,
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

    Object.entries(COVERAGE_MOVE_TYPES).forEach(([variety, types]) => {
      expect(types.length, `${variety} should not be empty`).toBeGreaterThan(0);
      types.forEach((type) => {
        expect(validTypes, `${variety} has unexpected type ${type}`).toContain(type);
      });
    });
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
