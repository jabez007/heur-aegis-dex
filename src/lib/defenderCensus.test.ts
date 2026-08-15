import { describe, expect, it } from 'vitest';
import catalogData from '../../data/pokemon-catalog.v1.json';
import { getRegulation } from './regulations';
import { getDefenderCensus, getThreatPool } from './threatPool';
import { catalogChart } from './pokemonCatalogScan';
import { measureDamageToBounds } from './damageBounds';
import { damageToScoreBounds } from './pokedexScoring';
import {
  bestMultiplier,
  calculateDamageToScore,
  censusTypings,
  chartCensus,
  damageToCoefficient,
  measureDefenderCensus
} from './defenderCensus';
import type { PokemonCatalogV1 } from './pokemonCatalog';

const catalog = catalogData as unknown as PokemonCatalogV1;
const BASE = 18;
const chart = catalogChart(catalog, BASE);
const flat = chartCensus(chart);
const pool = getThreatPool(catalog, { regulation: getRegulation('M-B'), baseScore: BASE });
const census = getDefenderCensus(catalog, { regulation: getRegulation('M-B'), baseScore: BASE });

/** The formula this replaced, kept as the thing the chart census must reproduce. */
const oldFormula = (typing: readonly string[]): number => {
  const relations = typing.map((name) => catalog.types.find((t) => t.name === name)!.damageRelations);
  const doubleTo = new Set(relations.flatMap((r) => r.doubleDamageTo));
  // Both must resist, or one resist and the other be immune; both immune for 0x.
  const halfTo = Object.keys(chart).filter((d) =>
    !doubleTo.has(d) && relations.every((r) => r.halfDamageTo.includes(d) || r.noDamageTo.includes(d)));
  const noTo = Object.keys(chart).filter((d) => relations.every((r) => r.noDamageTo.includes(d)));
  return BASE + doubleTo.size - (0.5 * (halfTo.length - noTo.length)) - noTo.length;
};

describe('defenderCensus', () => {
  it('prices a matchup at multiplier minus one', () => {
    // The identity `calculateDamageFromScore` uses, extended to the two
    // multipliers only a real dual-typed defender produces.
    expect(damageToCoefficient(4)).toBe(3);
    expect(damageToCoefficient(2)).toBe(1);
    expect(damageToCoefficient(1)).toBe(0);
    expect(damageToCoefficient(0.5)).toBe(-0.5);
    expect(damageToCoefficient(0.25)).toBe(-0.75);
    expect(damageToCoefficient(0)).toBe(-1);
  });

  it('takes the attacker’s best move rather than summing its types', () => {
    // Ground/Ice against Steel/Flying: Ground is 2x on Steel and 0x on Flying,
    // Ice is 0.5x on Steel and 2x on Flying. Both come out at exactly neutral,
    // and a per-defending-type census would have credited it for the Steel.
    expect(bestMultiplier(chart, ['ground', 'ice'], ['steel', 'flying'])).toBe(1);
    expect(bestMultiplier(chart, ['ground'], ['steel', 'flying'])).toBe(0);
    expect(bestMultiplier(chart, ['ice'], ['grass', 'flying'])).toBe(4);
  });

  it('reproduces the formula it replaced when the census is the chart', () => {
    // The change is a different census, not a different formula. The old
    // reading is what you get against a field of one pure-typed Pokemon per
    // type, and this asserts that across all 171 typings rather than a sample.
    const typings = censusTypings(chart);

    expect(typings).toHaveLength(171);
    typings.forEach((typing) => {
      expect(calculateDamageToScore(typing, flat, BASE)).toBeCloseTo(oldFormula(typing), 10);
    });
  });

  it('measures a real metagame as its distinct typings', () => {
    // Mass is normalized to the type count so the score stays on the scale every
    // downstream constant was measured against, and so `baseScore` keeps meaning
    // "neutral against the entire field" in both censuses.
    const mass = census.entries.reduce((sum, entry) => sum + entry.weight, 0);

    expect(census.entries.length).toBeGreaterThan(80);
    expect(census.entries.length).toBeLessThan(pool.length);
    expect(mass).toBeCloseTo(BASE, 10);
    expect(flat.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(BASE);
  });

  it('ranks the best offensive typing in the regulation first', () => {
    // Ground/Ice, which one legal species resists — Araquanid. It only tied for
    // the top under the chart count, which puts eight typings on 27 exactly.
    const ranked = censusTypings(chart)
      .map((typing) => ({ typing, score: calculateDamageToScore(typing, census, BASE) }))
      .sort((left, right) => right.score - left.score);

    expect([...ranked[0].typing].sort()).toEqual(['ground', 'ice']);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);

    const chartTop = censusTypings(chart)
      .map((typing) => calculateDamageToScore(typing, flat, BASE))
      .filter((score) => score === Math.max(
        ...censusTypings(chart).map((t) => calculateDamageToScore(t, flat, BASE))
      ));
    expect(chartTop.length).toBeGreaterThan(1);
  });

  it('reaches multipliers the chart census cannot, and so a wider range', () => {
    // A census of pure single types never produces a 4x or a 0.25x, so it
    // understates both ends. Normalizing a measured score against it would be
    // the compression bug `damageBounds.ts` exists to prevent, one axis over.
    const measured = measureDamageToBounds(census, BASE);
    const published = damageToScoreBounds(BASE);

    expect(measured.min).toBeLessThan(published.min);
    expect(measured.max).toBeGreaterThan(published.max);
    expect(measureDamageToBounds(flat, BASE)).toEqual(published);
  });

  it('re-prices for a cup, since a cup changes who is standing there', () => {
    const steelCup = getDefenderCensus(catalog, {
      regulation: getRegulation('M-B'),
      cupTypes: ['steel'],
      baseScore: BASE
    });
    const inFull = (typing: string[]) => calculateDamageToScore(typing, census, BASE);
    const inCup = (typing: string[]) => calculateDamageToScore(typing, steelCup, BASE);

    // Fighting and Ground answer a Steel cup; Poison cannot touch it at all.
    expect(inCup(['fighting'])).toBeGreaterThan(inFull(['fighting']));
    expect(inCup(['ground'])).toBeGreaterThan(inFull(['ground']));
    expect(inCup(['poison'])).toBeLessThan(inFull(['poison']));
  });

  it('falls back to the chart when there is no pool to measure', () => {
    // The live path's case: it cannot measure a field before fetching one.
    expect(measureDefenderCensus([], chart, BASE)).toEqual(flat);
  });
});
