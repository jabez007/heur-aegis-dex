import { describe, expect, it } from 'vitest';
import catalogData from '../../data/pokemon-catalog.v1.json';
import { getRegulation } from './regulations';
import { getThreatPool, getThreatWeights } from './threatPool';
import {
  MOVESLOTS,
  UNIFORM_TYPE_THREAT,
  getTypeThreatWeights,
  isUniformTypeThreat,
  measureTypeThreat,
  typeThreatWeight
} from './typeThreat';
import type { PokemonCatalogV1 } from './pokemonCatalog';
import type { ThreatPoolMember } from './typeThreat';

const catalog = catalogData as unknown as PokemonCatalogV1;
const TYPES = catalog.types.filter((type) => type.id <= 18).map((type) => type.name);

/** Types something is weak to, and so worth spending a coverage slot on. */
const COVERAGE = new Set(catalog.types.flatMap((type) => type.damageRelations.doubleDamageFrom));

/** A pool member the coverage table knows nothing about, so only STAB counts. */
const stabOnly = (name: string, types: string[]): ThreatPoolMember => ({ name, types });

describe('type threat weights', () => {
  it('treats an unpriced type as full weight, so an empty map is the old behaviour', () => {
    expect(typeThreatWeight(UNIFORM_TYPE_THREAT, 'fighting')).toBe(1);
    expect(isUniformTypeThreat(UNIFORM_TYPE_THREAT)).toBe(true);
    expect(isUniformTypeThreat({ fighting: 0.5 })).toBe(false);
  });

  it('counts a pool member’s own types in full', () => {
    const shares = measureTypeThreat([stabOnly('unknown-a', ['fire']), stabOnly('unknown-b', ['water'])], TYPES, COVERAGE);

    expect(shares.fire).toBeCloseTo(0.5, 10);
    expect(shares.water).toBeCloseTo(0.5, 10);
    expect(shares.dragon).toBe(0);
  });

  it('splits the moveslots left after STAB across the types a Pokemon can reach', () => {
    // Garchomp is Ground/Dragon, so two of four slots are STAB and the rest are
    // shared out over everything else it can reach. The exact denominator is its
    // own coverage list, which is why this asserts the relationship rather than
    // a number: the table is generated and will move.
    const [garchomp] = getThreatPool(catalog, { baseScore: 18 })
      .filter((variety) => variety.name === 'garchomp');
    const shares = measureTypeThreat([garchomp], TYPES, COVERAGE);

    expect(shares.ground).toBe(1);
    expect(shares.dragon).toBe(1);

    const coverageTotal = TYPES
      .filter((type) => type !== 'ground' && type !== 'dragon')
      .reduce((sum, type) => sum + shares[type], 0);
    // Every coverage slot is spent, so the shares outside STAB sum to the slots.
    expect(coverageTotal).toBeCloseTo(MOVESLOTS - 2, 10);
  });

  it('never lets a Pokemon run more coverage than it can reach', () => {
    // One type reachable, three slots free: it runs that one, not three of it.
    const shares = measureTypeThreat([{ name: 'garchomp', types: ['ground'] }], TYPES, COVERAGE);

    expect(Math.max(...Object.values(shares))).toBe(1);
  });

  it('normalizes so the most available attacking type weighs exactly 1', () => {
    const weights = getTypeThreatWeights(getThreatPool(catalog, { baseScore: 18 }), TYPES, COVERAGE);
    const values = Object.values(weights);

    expect(Math.max(...values)).toBe(1);
    expect(Math.min(...values)).toBeGreaterThan(0);
    expect(values.every((weight) => weight <= 1)).toBe(true);
  });

  it('falls back to uniform when nothing in the pool can attack', () => {
    expect(getTypeThreatWeights([], TYPES, COVERAGE)).toBe(UNIFORM_TYPE_THREAT);
  });

  it('prices a weakness by what the pool can bring, not by what it is', () => {
    // The motivating case, and the one a typing-prevalence measure gets wrong.
    // Strip every Fighting-type from Regulation M-B and Fighting is still one of
    // the most available attacks in the format, because Close Combat, Body Press
    // and Brick Break do not care what their user is typed.
    const regulation = getRegulation('M-B')!;
    const pool = getThreatPool(catalog, { regulation, baseScore: 18 });
    const withoutFightingTypes = pool.filter((variety) => !variety.types.includes('fighting'));

    const shares = measureTypeThreat(withoutFightingTypes, TYPES, COVERAGE);
    const weights = getTypeThreatWeights(withoutFightingTypes, TYPES, COVERAGE);

    expect(withoutFightingTypes.every((variety) => !variety.types.includes('fighting'))).toBe(true);
    expect(shares.fighting).toBeGreaterThan(0.1);
    // Worse than being weak to the rarest attacks in a format that has them all.
    expect(weights.fighting).toBeGreaterThan(weights.dragon);
    expect(weights.fighting).toBeGreaterThan(weights.fairy);
  });

  it('does not spend a coverage slot on a type that buys no coverage', () => {
    // Normal is the only attacking type nothing is weak to, and 187 of the 208
    // legal species can click a qualifying Normal move. Counting that filler as
    // coverage made Normal the most threatening type in the game at a weight of
    // 1.000, ahead of Dark and Fighting — and since nothing is weak to Normal,
    // the entire weight was spent on the resistance side, handing every Ghost
    // type the single largest term in the model for an immunity to Body Slam.
    expect(COVERAGE.has('normal')).toBe(false);
    expect([...TYPES].every((type) => type === 'normal' || COVERAGE.has(type))).toBe(true);

    const regulation = getRegulation('M-B')!;
    const pool = getThreatPool(catalog, { regulation, baseScore: 18 });
    const weights = getTypeThreatWeights(pool, TYPES, COVERAGE);

    // A STAB-only threat carried by a tenth of the pool should be the smallest
    // on the board, not the largest.
    expect(weights.normal).toBe(Math.min(...Object.values(weights)));
    expect(weights.dark).toBe(1);

    // Counting it as coverage is what inverts that, so the bug stays pinned.
    const unrestricted = getTypeThreatWeights(pool, TYPES, new Set(TYPES));
    expect(unrestricted.normal).toBe(1);
  });

  it('lets a real weakness reach the maximum weight', () => {
    // With Normal no longer setting the ceiling, the type that does is one
    // things are actually weak to, so a weakness can cost a full weight.
    const weights = getTypeThreatWeights(
      getThreatPool(catalog, { regulation: getRegulation('M-B'), baseScore: 18 }), TYPES, COVERAGE
    );
    const heaviest = Object.entries(weights).find(([, weight]) => weight === 1)![0];

    expect(COVERAGE.has(heaviest)).toBe(true);
  });

  it('does drop a type nothing in the pool can attack with', () => {
    // The other half of the claim: availability is measured, not assumed. A pool
    // of two Pokemon the coverage table does not know reaches only its own types.
    const weights = getTypeThreatWeights([stabOnly('unknown-a', ['fire']), stabOnly('unknown-b', ['water'])], TYPES, COVERAGE);

    expect(weights.fighting).toBe(0);
    expect(weights.fire).toBe(1);
  });
});

describe('threat pools', () => {
  it('counts species once, in their default form', () => {
    const pool = getThreatPool(catalog, { regulation: getRegulation('M-B'), baseScore: 18 });

    expect(pool.every((variety) => variety.isDefault)).toBe(true);
    expect(new Set(pool.map((variety) => variety.speciesName)).size).toBe(pool.length);
  });

  it('restricts the pool to the regulation, since that is who you face', () => {
    const regulation = getRegulation('M-B')!;
    const pool = getThreatPool(catalog, { regulation, baseScore: 18 });

    expect(pool.length).toBe(regulation.legalSpecies.size);
    expect(pool.every((variety) => regulation.legalSpecies.has(variety.speciesName))).toBe(true);
  });

  it('narrows to a cup and re-prices what that cup can bring', () => {
    const regulation = getRegulation('M-B');
    const full = getThreatWeights(catalog, { regulation, baseScore: 18 });
    const cup = getThreatWeights(catalog, {
      regulation,
      cupTypes: ['water', 'fire', 'grass'],
      baseScore: 18
    });

    expect(cup).not.toBe(full);
    // A cup of Water, Fire and Grass has almost no Electric in it — a few
    // Thunderbolts and nothing more — where the open format is full of it.
    expect(cup.electric).toBeLessThan(full.electric / 2);
    // And it is saturated with the three types it is made of.
    expect(cup.grass).toBeGreaterThan(full.grass);
    expect(cup.water).toBeGreaterThan(full.water);
  });

  it('returns the identical weights object for the same selection', () => {
    // Identity, not just equality: `damageBounds` memoizes on it, and a fresh
    // equal object would recompute 3,078 profiles per Pokemon scored.
    const selection = { regulation: getRegulation('M-B'), cupTypes: ['rock'], baseScore: 18 };

    expect(getThreatWeights(catalog, selection)).toBe(getThreatWeights(catalog, selection));
    expect(getThreatWeights(catalog, { ...selection, cupTypes: ['rock'] }))
      .toBe(getThreatWeights(catalog, selection));
  });
});
