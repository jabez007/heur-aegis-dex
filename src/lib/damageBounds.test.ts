import { describe, expect, it } from 'vitest';
import catalogData from '../../data/pokemon-catalog.v1.json';
import {
  measureDamageFromBounds,
  measureDamageToBounds,
  measurePoolDamageFromBounds,
  measurePoolDamageToBounds
} from './damageBounds';
import { chartCensus, chartFromTypeData } from './defenderCensus';
import { getCatalogBaseTypes } from './pokemonCatalogScan';
import { DEFAULT_BASE_SCORE, damageFromScoreBounds } from './pokedexScoring';
import { getTypeThreatWeights, UNIFORM_TYPE_THREAT } from './typeThreat';
import type { PokemonCatalogV1 } from './pokemonCatalog';
import type { TypeThreatWeights } from './typeThreat';

const catalog = catalogData as unknown as PokemonCatalogV1;
const baseTypes = getCatalogBaseTypes(catalog, DEFAULT_BASE_SCORE);
const typeNames = baseTypes.map((type) => type.name);
const chart = Object.fromEntries(catalog.types.map((type) => [type.name, type.damageRelations]));

/**
 * A weighting is only ever handed out frozen and per-pool, and the memo keys on
 * object identity, so tests that want a fresh derivation build a fresh object.
 */
const weightsFrom = (entries: Record<string, number>): TypeThreatWeights =>
  Object.freeze({ ...Object.fromEntries(typeNames.map((name) => [name, 1])), ...entries });

describe('weighted damage-from bounds', () => {
  it('reproduces the published unweighted measurement', () => {
    // The constants in pokedexScoring.ts came from measure-damage-bounds.mjs
    // crossing 171 typings with 18 ability cases. This module runs the same
    // cross product, so an explicit all-ones weighting has to land on the same
    // two numbers. If this fails, one of the two readings has drifted and the
    // question is which — do not simply update the expectation.
    const derived = measureDamageFromBounds(
      baseTypes, DEFAULT_BASE_SCORE, weightsFrom({})
    );

    expect(derived).toEqual({ min: 8.25, max: 26 });
    expect(derived).toEqual(damageFromScoreBounds(DEFAULT_BASE_SCORE));
  });

  it('short-circuits the uniform weighting to the published constants', () => {
    expect(measureDamageFromBounds(baseTypes, DEFAULT_BASE_SCORE, UNIFORM_TYPE_THREAT))
      .toEqual(damageFromScoreBounds(DEFAULT_BASE_SCORE));
  });

  it('closes the range in when weights fall below 1', () => {
    // Every bucket shrinks by its type's weight, so both extremes move toward
    // the baseScore neutral line. Normalizing a weighted score against the
    // unweighted range is exactly the compression this module exists to avoid.
    const halved = measureDamageFromBounds(
      baseTypes,
      DEFAULT_BASE_SCORE,
      weightsFrom(Object.fromEntries(typeNames.map((name) => [name, 0.5])))
    );
    const unweighted = damageFromScoreBounds(DEFAULT_BASE_SCORE);

    expect(halved.min).toBeGreaterThan(unweighted.min);
    expect(halved.max).toBeLessThan(unweighted.max);
    // Halving every weight halves the distance from the neutral line exactly.
    expect(halved.min).toBeCloseTo(
      DEFAULT_BASE_SCORE - ((DEFAULT_BASE_SCORE - unweighted.min) / 2), 10
    );
  });

  it('keeps the neutral line reachable whatever the weighting', () => {
    // A typing taking neutral damage from everything scores baseScore under any
    // weights, so the baseline always sits inside the range. That is what makes
    // the maxDamageFromScore filter mean the same thing in every metagame.
    const pool = catalog.varieties.filter((variety) => variety.isDefault).slice(0, 120);
    const weights = getTypeThreatWeights(pool, typeNames, chart);
    const { min, max } = measureDamageFromBounds(baseTypes, DEFAULT_BASE_SCORE, weights);

    expect(min).toBeLessThan(DEFAULT_BASE_SCORE);
    expect(max).toBeGreaterThan(DEFAULT_BASE_SCORE);
  });

  it('memoizes per weight vector and baseline', () => {
    const weights = weightsFrom({ fighting: 0.25 });

    expect(measureDamageFromBounds(baseTypes, DEFAULT_BASE_SCORE, weights))
      .toBe(measureDamageFromBounds(baseTypes, DEFAULT_BASE_SCORE, weights));
  });
});

describe('pool-relative damage-from bounds', () => {
  const uniform = weightsFrom({});

  it('never reaches outside the lattice the pool is drawn from', () => {
    // The lattice bound is a guarantee — no real Pokemon can fall outside it —
    // and narrowing to a pool must not break that, only tighten it.
    const pool = catalog.varieties.filter((variety) => variety.isDefault);
    const lattice = measureDamageFromBounds(baseTypes, DEFAULT_BASE_SCORE, uniform);
    const measured = measurePoolDamageFromBounds(pool, baseTypes, DEFAULT_BASE_SCORE, uniform);

    expect(measured.min).toBeGreaterThanOrEqual(lattice.min);
    expect(measured.max).toBeLessThanOrEqual(lattice.max);
  });

  it('tightens the range when the pool cannot field the extremes', () => {
    // The whole point: a range no candidate occupies is a range the defensive
    // term cannot use. Neither of these is close to the best or worst profile
    // the lattice can express, so the pool range lands well inside it.
    const pool = [
      { types: ['normal'], abilities: [] },
      { types: ['water'], abilities: [] }
    ];
    const lattice = measureDamageFromBounds(baseTypes, DEFAULT_BASE_SCORE, uniform);
    const measured = measurePoolDamageFromBounds(pool, baseTypes, DEFAULT_BASE_SCORE, uniform);

    expect(measured.max - measured.min).toBeLessThan(lattice.max - lattice.min);
  });

  it('reads each candidate against its own abilities, not every ability', () => {
    // Levitate is worth a Ground immunity to the Pokemon that has it and
    // nothing to the one that does not. Crossing every typing with every
    // ability — what the lattice bound does — prices a profile no candidate
    // can present.
    const grounded = [
      { types: ['electric'], abilities: [{ name: 'static' }] },
      { types: ['ground'], abilities: [{ name: 'sand-veil' }] }
    ];
    const levitating = [
      { types: ['electric'], abilities: [{ name: 'levitate' }] },
      { types: ['ground'], abilities: [{ name: 'sand-veil' }] }
    ];

    expect(measurePoolDamageFromBounds(levitating, baseTypes, DEFAULT_BASE_SCORE, uniform).min)
      .toBeLessThan(measurePoolDamageFromBounds(grounded, baseTypes, DEFAULT_BASE_SCORE, uniform).min);
  });

  it('keeps the bare typing reachable for a Pokemon whose abilities all alter it', () => {
    // `includeAbilityImmunities` is a user-facing toggle, and with it off every
    // entry is scored on its bare typing. A bound that assumed Levitate was
    // always on would put Rotom outside its own range the moment it is cleared.
    // Electric/Ghost is the worse of these two typings either way, so it sets
    // the ceiling — and it may only do so if its bare profile is in the set.
    const rotom = { types: ['electric', 'ghost'], abilities: [{ name: 'levitate' }] };
    const filler = { types: ['normal'], abilities: [] };
    const withLevitate = measurePoolDamageFromBounds(
      [rotom, filler], baseTypes, DEFAULT_BASE_SCORE, uniform
    );
    const bareOnly = measurePoolDamageFromBounds(
      [{ ...rotom, abilities: [] }, filler], baseTypes, DEFAULT_BASE_SCORE, uniform
    );

    expect(withLevitate.max).toBe(bareOnly.max);
    // And Levitate still has to reach the floor, or the ability is unpriced.
    expect(withLevitate.min).toBeLessThan(bareOnly.min);
  });

  it('falls back to the lattice for an empty pool', () => {
    expect(measurePoolDamageFromBounds([], baseTypes, DEFAULT_BASE_SCORE, uniform))
      .toEqual(measureDamageFromBounds(baseTypes, DEFAULT_BASE_SCORE, uniform));
  });

  it('falls back to the lattice rather than returning a zero-width range', () => {
    // One typing with one ability gives min === max, and normalizing against
    // that would score every Pokemon at the midpoint.
    const single = [{ types: ['normal'], abilities: [] }];
    const measured = measurePoolDamageFromBounds(single, baseTypes, DEFAULT_BASE_SCORE, uniform);

    expect(measured.max).toBeGreaterThan(measured.min);
  });
});

describe('pool-relative damage-to bounds', () => {
  const census = chartCensus(chartFromTypeData(baseTypes));

  it('narrows to the typings a pool actually fields', () => {
    const pool = [
      { types: ['water'], abilities: [] },
      { types: ['grass'], abilities: [] }
    ];
    const whole = measureDamageToBounds(census, DEFAULT_BASE_SCORE);
    const measured = measurePoolDamageToBounds(pool, census, DEFAULT_BASE_SCORE);

    expect(measured.min).toBeGreaterThanOrEqual(whole.min);
    expect(measured.max).toBeLessThanOrEqual(whole.max);
  });

  it('falls back to the whole chart for an empty pool', () => {
    expect(measurePoolDamageToBounds([], census, DEFAULT_BASE_SCORE))
      .toEqual(measureDamageToBounds(census, DEFAULT_BASE_SCORE));
  });
});
