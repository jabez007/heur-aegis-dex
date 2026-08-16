import { describe, expect, it } from 'vitest';
import {
  resolveResistantTypeScanOptions,
  runResistantTypeScan
} from './resistantTypeScan';
import type { PokemonListEntry, PokemonTypeData } from './pokedexTypes';
import type { ResistantTypeScanOptions } from './resistantTypeScan';

const typeFixture = (
  name: string,
  damageFromScore = 18,
  damageToScore = 18,
  doubleDamageFrom: string[] = [],
  quadrupleDamageFrom: string[] = []
): PokemonTypeData => ({
  name,
  damage_relations: {
    double_damage_from: doubleDamageFrom.map((entry) => ({ name: entry })),
    half_damage_from: [],
    no_damage_from: [],
    double_damage_to: [],
    half_damage_to: [],
    no_damage_to: [],
    quadruple_damage_from: quadrupleDamageFrom.map((entry) => ({ name: entry })),
    damage_from_score: damageFromScore,
    damage_to_score: damageToScore
  },
  pokemon: []
});

const emptySource = { enrichType: () => [] };

const pokemonFixture = (
  name: string,
  types: string[],
  options: { species?: string; isDefault?: boolean; statsTotal?: number } = {}
): PokemonListEntry => ({
  pokemon: { name },
  species_name: options.species ?? name,
  is_default_variety: options.isDefault ?? true,
  types: types.map((type) => ({ type: { name: type } })),
  abilities: [{ name: 'test-ability', is_hidden: false }],
  stats: {
    hp: 80,
    attack: 80,
    defense: 80,
    'special-attack': 80,
    'special-defense': 80,
    speed: 80
  },
  stats_total: options.statsTotal ?? 480
});

describe('resistant type scan core', () => {
  it('resolves defaults and legacy defense floors in one place', () => {
    const defaults = resolveResistantTypeScanOptions();
    expect(defaults).toMatchObject({
      baseScore: 18,
      typeFilters: {
        // Off by default: the neutral line stopped being a place typings land
        // once threat weighting made the score continuous.
        maxDamageFromScore: false,
        allowQuadrupleDamage: true,
        limitQuadrupleDamage: true
      },
      enrichment: {
        inPokedex: 'national',
        allowMegas: false,
        includeAbilityImmunities: true,
        includeMoveCoverage: true,
        // The app only ever offers Pokemon the user can breed, so this stays on
        // unless a caller explicitly asks the other question.
        breedableOnly: true,
        minimumAttacks: 80,
        minimumBulk: 70
      }
    });

    expect(resolveResistantTypeScanOptions({
      pokemonFilters: { allowMegas: true },
      statsFilters: { minimumDefenses: 42 }
    }).enrichment).toMatchObject({
      inPokedex: 'national',
      allowMegas: true,
      minimumAttacks: 80,
      minimumBulk: 42
    });

    // Breeding is a constraint on what the *user* can bring, never on what the
    // format contains. Scoring asks the second question through `getThreatPool`,
    // which does not apply this rule at all; this flag lets a scan ask it too,
    // which is what scoring somebody else's team requires.
    expect(resolveResistantTypeScanOptions({
      pokemonFilters: { breedableOnly: false }
    }).enrichment).toMatchObject({ breedableOnly: false });
  });

  it('rejects unknown regulations before a source is invoked', () => {
    expect(() => resolveResistantTypeScanOptions({
      pokemonFilters: { regulation: 'M-Z' }
    })).toThrow('Unknown regulation: M-Z');
  });

  it('preserves the previous runtime behavior for a null base score', () => {
    const runtimeOptions = { baseScore: null } as unknown as ResistantTypeScanOptions;
    expect(resolveResistantTypeScanOptions(runtimeOptions).baseScore).toBeNull();
  });

  it('preserves the asymmetric quadruple-weakness filter', async () => {
    const quadOnly = typeFixture('quad-only', 18, 18, [], ['fire']);
    const quadAndDouble = typeFixture('quad-and-double', 18, 18, ['water'], ['fire']);
    const defaults = resolveResistantTypeScanOptions();

    expect((await runResistantTypeScan([quadOnly], defaults, emptySource))).toHaveLength(1);
    expect((await runResistantTypeScan([quadAndDouble], defaults, emptySource))).toHaveLength(0);
    expect((await runResistantTypeScan(
      [quadAndDouble],
      resolveResistantTypeScanOptions({
        typeFilters: { limitQuadrupleDamage: false }
      }),
      emptySource
    ))).toHaveLength(1);
  });

  it('orders complete results by quotient and then defensive score', async () => {
    const results = await runResistantTypeScan(
      [typeFixture('first', 10, 10), typeFixture('second', 12, 24)],
      resolveResistantTypeScanOptions({
        typeFilters: { maxDamageFromScore: false, limitQuadrupleDamage: false }
      }),
      emptySource
    );

    expect(results.map((entry) => entry.name)).toEqual(['second', 'first', 'first/second']);
  });

  it('holds the complete shared result assembly contract', async () => {
    const firstMono = pokemonFixture('first-mono', ['first'], { statsTotal: 500 });
    const misplacedDual = pokemonFixture('misplaced-dual', ['first', 'second']);
    const secondMono = pokemonFixture('second-mono', ['second'], { statsTotal: 510 });
    const cosmetic = pokemonFixture('dual-cap', ['first', 'second'], {
      species: 'dual-species',
      isDefault: false,
      statsTotal: 490
    });
    const canonical = pokemonFixture('dual-default', ['first', 'second'], {
      species: 'dual-species',
      isDefault: true,
      statsTotal: 490
    });

    const results = await runResistantTypeScan(
      [typeFixture('first', 10, 10), typeFixture('second', 12, 24)],
      resolveResistantTypeScanOptions({
        typeFilters: { maxDamageFromScore: false, limitQuadrupleDamage: false }
      }),
      {
        enrichType: (type) => {
          if (type.name === 'first') return [misplacedDual, firstMono];
          if (type.name === 'second') return [secondMono];
          return [cosmetic, canonical];
        }
      }
    );

    expect(results.map((entry) => ({
      name: entry.name,
      damageFrom: entry.damage_from_score,
      damageTo: entry.damage_to_score,
      weaknesses: entry.weaknesses,
      pokemon: entry.pokemon.map((pokemon) => pokemon.pokemon.name)
    }))).toEqual([
      {
        name: 'second',
        damageFrom: 12,
        damageTo: 24,
        weaknesses: [],
        pokemon: ['second-mono']
      },
      {
        name: 'first',
        damageFrom: 10,
        damageTo: 10,
        weaknesses: [],
        pokemon: ['first-mono']
      },
      {
        name: 'first/second',
        damageFrom: 18,
        damageTo: 18,
        weaknesses: [],
        pokemon: ['dual-default']
      }
    ]);
  });

  it('assembles every type summary field and sorts Pokemon by stat total', async () => {
    const richType = typeFixture('rich', 17, 20, ['fire'], ['ice']);
    richType.damage_relations.half_damage_from = [{ name: 'water' }];
    richType.damage_relations.quarter_damage_from = [{ name: 'bug' }];
    richType.damage_relations.no_damage_from = [{ name: 'ground' }];
    richType.damage_relations.double_damage_to = [{ name: 'grass' }];
    richType.damage_relations.half_damage_to = [{ name: 'steel' }];
    richType.damage_relations.no_damage_to = [{ name: 'ghost' }];
    const lower = pokemonFixture('lower', ['rich'], { statsTotal: 450 });
    const higher = pokemonFixture('higher', ['rich'], { statsTotal: 550 });

    const [result] = await runResistantTypeScan(
      [richType],
      resolveResistantTypeScanOptions({
        typeFilters: { maxDamageFromScore: false, limitQuadrupleDamage: false }
      }),
      { enrichType: () => [lower, higher] }
    );

    expect(result).toMatchObject({
      name: 'rich',
      include_ability_immunities: true,
      weaknesses: ['ice', 'fire'],
      quadruple_weaknesses: ['ice'],
      resistances: ['ground', 'bug', 'water'],
      immunities: ['ground'],
      ineffectives: ['ghost', 'steel'],
      coverages: ['grass'],
      damage_from_score: 17,
      damage_to_score: 20
    });
    expect(result.pokemon.map((entry) => entry.pokemon.name)).toEqual(['higher', 'lower']);
  });

  it('prepares every acquired type before applying type filters', async () => {
    const prepared: string[] = [];
    const enriched: string[] = [];
    const results = await runResistantTypeScan(
      [typeFixture('filtered', 19)],
      // maxDamageFromScore is off by default now, so the filter it is testing
      // has to be asked for explicitly.
      resolveResistantTypeScanOptions({ typeFilters: { maxDamageFromScore: true } }),
      {
        prepare: async (types) => {
          prepared.push(...types.map((type) => type.name));
        },
        enrichType: (type) => {
          enriched.push(type.name);
          return [];
        }
      }
    );

    expect(prepared).toEqual(['filtered']);
    expect(enriched).toEqual([]);
    expect(results).toEqual([]);
  });
});
