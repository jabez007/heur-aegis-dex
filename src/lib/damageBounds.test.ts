import { describe, expect, it } from 'vitest';
import catalogData from '../../data/pokemon-catalog.v1.json';
import { measureDamageFromBounds } from './damageBounds';
import { getCatalogBaseTypes } from './pokemonCatalogScan';
import { DEFAULT_BASE_SCORE, damageFromScoreBounds } from './pokedexScoring';
import { getTypeThreatWeights, UNIFORM_TYPE_THREAT } from './typeThreat';
import type { PokemonCatalogV1 } from './pokemonCatalog';
import type { TypeThreatWeights } from './typeThreat';

const catalog = catalogData as unknown as PokemonCatalogV1;
const baseTypes = getCatalogBaseTypes(catalog, DEFAULT_BASE_SCORE);
const typeNames = baseTypes.map((type) => type.name);
const coverageTypes = new Set(catalog.types.flatMap((type) => type.damageRelations.doubleDamageFrom));

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
    const weights = getTypeThreatWeights(pool, typeNames, coverageTypes);
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
