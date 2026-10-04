import { describe, expect, it } from 'vitest';
import catalogData from '../../data/pokemon-catalog.v1.json';
import { getRegulation } from './regulations';
import { getThreatPool, getThreatWeights, getTypeMatchupValues } from './threatPool';
import {
  MOVESLOTS,
  UNIFORM_TYPE_THREAT,
  getTypeThreatWeights,
  isUniformTypeThreat,
  measureTypeThreat,
  toTypeThreatWeights,
  typeMultiplier,
  typeThreatWeight
} from './typeThreat';
import { COVERAGE_MOVE_POKEDEX, getCoverageMoveTypes, hasCoverageMoveData } from './coverageMoves';
import type { PokemonCatalogV1 } from './pokemonCatalog';
import type { ThreatPoolMember, ThreatTypeChart } from './typeThreat';

const catalog = catalogData as unknown as PokemonCatalogV1;
const TYPES = catalog.types.filter((type) => type.id <= 18).map((type) => type.name);

/** The type chart, as `measureTypeThreat` wants it. */
const CHART: ThreatTypeChart = Object.fromEntries(
  catalog.types.map((type) => [type.name, type.damageRelations])
);

/** A pool member the coverage table knows nothing about, so only STAB counts. */
const stabOnly = (name: string, types: string[]): ThreatPoolMember => ({ name, types });

describe('type threat weights', () => {
  it('treats an unpriced type as full weight, so an empty map is the old behaviour', () => {
    expect(typeThreatWeight(UNIFORM_TYPE_THREAT, 'fighting')).toBe(1);
    expect(isUniformTypeThreat(UNIFORM_TYPE_THREAT)).toBe(true);
    expect(isUniformTypeThreat({ fighting: 0.5 })).toBe(false);
  });

  it('counts a pool member’s own types in full', () => {
    const shares = measureTypeThreat([stabOnly('unknown-a', ['fire']), stabOnly('unknown-b', ['water'])], TYPES, CHART);

    expect(shares.fire).toBeCloseTo(0.5, 10);
    expect(shares.water).toBeCloseTo(0.5, 10);
    expect(shares.dragon).toBe(0);
  });

  it('never lets the field bring more moves than it has slots for', () => {
    // The moveslot arithmetic is the whole discount, so the invariant it exists
    // to enforce is asserted directly: summed across every type, the expected
    // moves per pool member cannot exceed four. Asserted over the real pool
    // rather than a contrived one because the allocation is measured against the
    // field a Pokemon faces, and a field of one is not a measurement.
    const pool = getThreatPool(catalog, { regulation: getRegulation('M-B'), baseScore: 18 });
    const shares = measureTypeThreat(pool, TYPES, CHART);
    const movesPerMember = TYPES.reduce((sum, type) => sum + shares[type], 0);
    const ownTypesPerMember = pool.reduce((sum, m) => sum + m.types.length, 0) / pool.length;

    expect(movesPerMember).toBeLessThanOrEqual(MOVESLOTS);
    // STAB is never discounted, so it sets the floor, and coverage is real, so
    // the field brings strictly more than its own typing.
    expect(movesPerMember).toBeGreaterThan(ownTypesPerMember);
  });

  it('never lets a Pokemon run more coverage than it can reach', () => {
    // Pelipper is Water/Flying, so it has two free slots, and against a field of
    // Dragons the only thing it can reach that they are weak to is Ice. Nothing
    // stops proportional allocation handing it both slots, so the clamp does:
    // it runs Ice Beam once, and the forfeited slot goes nowhere.
    const [pelipper] = getThreatPool(catalog, { baseScore: 18 })
      .filter((variety) => variety.name === 'pelipper');
    const pool = [pelipper, stabOnly('dragon-a', ['dragon']), stabOnly('dragon-b', ['dragon'])];
    const shares = measureTypeThreat(pool, TYPES, CHART);

    expect(getCoverageMoveTypes(pelipper.name, pelipper.stats)).toContain('ice');
    expect(shares.ice * pool.length).toBe(1);
    // Two slots free, one of them spent.
    expect(MOVESLOTS - pelipper.types.length).toBe(2);
  });

  it('normalizes so the most available attacking type weighs exactly 1', () => {
    const weights = getTypeThreatWeights(getThreatPool(catalog, { baseScore: 18 }), TYPES, CHART);
    const values = Object.values(weights);

    expect(Math.max(...values)).toBe(1);
    expect(Math.min(...values)).toBeGreaterThan(0);
    expect(values.every((weight) => weight <= 1)).toBe(true);
  });

  it('falls back to uniform when nothing in the pool can attack', () => {
    expect(getTypeThreatWeights([], TYPES, CHART)).toBe(UNIFORM_TYPE_THREAT);
  });

  it('prices a weakness by what the pool can bring, not by what it is', () => {
    // The motivating case, and the one a typing-prevalence measure gets wrong.
    // Strip every Fighting-type from Regulation M-B and Fighting is still one of
    // the most available attacks in the format, because Close Combat, Body Press
    // and Brick Break do not care what their user is typed.
    const regulation = getRegulation('M-B')!;
    const pool = getThreatPool(catalog, { regulation, baseScore: 18 });
    const withoutFightingTypes = pool.filter((variety) => !variety.types.includes('fighting'));

    const shares = measureTypeThreat(withoutFightingTypes, TYPES, CHART);
    const weights = getTypeThreatWeights(withoutFightingTypes, TYPES, CHART);

    expect(withoutFightingTypes.every((variety) => !variety.types.includes('fighting'))).toBe(true);
    expect(shares.fighting).toBeGreaterThan(0.1);
    // Worse than being weak to the rarest attacks in a format that has them all.
    expect(weights.fighting).toBeGreaterThan(weights.dragon);
    expect(weights.fighting).toBeGreaterThan(weights.fairy);
  });

  it('gives no coverage slot to a type that buys no coverage', () => {
    // Normal is the only attacking type nothing is weak to, and 187 of the 208
    // legal species can click a qualifying Normal move. Splitting slots evenly
    // made Normal the most threatening type in the game at a weight of 1.000,
    // ahead of Dark and Fighting — and since nothing is weak to Normal, the
    // entire weight was spent on the resistance side, handing every Ghost type
    // the single largest term in the model for an immunity to Body Slam.
    //
    // That needed an explicit filter once. It does not now: a type with no
    // marginal value takes no share of a proportional allocation. The guarantee
    // is asserted here precisely because it is a consequence rather than a rule,
    // and a consequence is the kind of thing a refactor loses quietly.
    expect(TYPES.every((type) => typeMultiplier(CHART, 'normal', [type]) < 2)).toBe(true);

    const regulation = getRegulation('M-B')!;
    const pool = getThreatPool(catalog, { regulation, baseScore: 18 });
    const weights = getTypeThreatWeights(pool, TYPES, CHART);

    // A STAB-only threat carried by a tenth of the pool should be the smallest
    // on the board, not the largest.
    expect(weights.normal).toBe(Math.min(...Object.values(weights)));
    // And its whole weight is STAB: 9.6% of the pool is Normal-type, and the
    // heaviest type is on 30.4% of it, so no coverage credit survives.
    expect(weights.normal).toBeCloseTo(0.266, 2);
  });

  it('splits slots by what they buy rather than evenly, which inverted the board', () => {
    // The even split ranked Psychic third at 14.9% of the pool hit
    // super-effectively, and Ice fourteenth at 23.6%. Reconstructed here so the
    // reading being corrected stays legible, and so that a change which quietly
    // restored it fails rather than passing with different numbers.
    const regulation = getRegulation('M-B')!;
    const pool = getThreatPool(catalog, { regulation, baseScore: 18 });

    const evenShares: Record<string, number> = Object.fromEntries(TYPES.map((type) => [type, 0]));
    pool.forEach((member) => {
      const own = new Set<string>(member.types);
      const coverage = getCoverageMoveTypes(member.name, member.stats)
        .filter((type) => !own.has(type) && type in evenShares);
      const slots = Math.max(0, MOVESLOTS - own.size);
      const per = coverage.length > 0 ? Math.min(1, slots / coverage.length) : 0;
      own.forEach((type) => { if (type in evenShares) evenShares[type] += 1; });
      coverage.forEach((type) => { evenShares[type] += per; });
    });
    TYPES.forEach((type) => { evenShares[type] /= pool.length; });
    const even = toTypeThreatWeights(evenShares);
    const weights = getTypeThreatWeights(pool, TYPES, CHART);

    // Filler outranked everything under the even split, and is last now.
    expect(even.normal).toBe(1);
    expect(weights.normal).toBe(Math.min(...Object.values(weights)));

    // Psychic outranked Ground, which hits twice as much of the pool.
    expect(even.psychic).toBeGreaterThan(even.ground);
    expect(weights.ground).toBeGreaterThan(weights.psychic);
  });

  it('lets a real weakness reach the maximum weight', () => {
    // With Normal no longer setting the ceiling, the type that does is one
    // things are actually weak to, so a weakness can cost a full weight.
    const weights = getTypeThreatWeights(
      getThreatPool(catalog, { regulation: getRegulation('M-B'), baseScore: 18 }), TYPES, CHART
    );
    const heaviest = Object.entries(weights).find(([, weight]) => weight === 1)![0];

    expect(TYPES.some((type) => typeMultiplier(CHART, heaviest, [type]) >= 2)).toBe(true);
  });

  it('prices a coverage move against the gap its user’s STAB leaves', () => {
    // Coverage fills holes. Ice against a pool of Dragons is the textbook
    // coverage move — except in the hands of a Dragon, whose STAB already
    // answers every one of them, so the slot goes elsewhere.
    const dragons = [
      stabOnly('unknown-a', ['dragon']),
      stabOnly('unknown-b', ['dragon']),
      { name: 'garchomp', types: ['dragon', 'ground'] }
    ];
    const shares = measureTypeThreat(dragons, TYPES, CHART);

    expect(typeMultiplier(CHART, 'ice', ['dragon'])).toBe(2);
    expect(shares.ice).toBe(0);
  });

  it('does drop a type nothing in the pool can attack with', () => {
    // The other half of the claim: availability is measured, not assumed. A pool
    // of two Pokemon the coverage table does not know reaches only its own types.
    const weights = getTypeThreatWeights([stabOnly('unknown-a', ['fire']), stabOnly('unknown-b', ['water'])], TYPES, CHART);

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

  it('restricts the pool to species that exist in the game, regulation or not', () => {
    // The catalog is the National Dex and the game is 208 of it. Without this,
    // an unregulated pool was 817 Pokemon with no movepool and 208 with one, and
    // a measure of what the field *can attack with* silently became a measure of
    // which typings are common — Water read 1.000 for being the most common
    // typing rather than a common attack.
    const roster = catalog.species.filter((s) => s.pokedexes.includes(COVERAGE_MOVE_POKEDEX));
    const pool = getThreatPool(catalog, { baseScore: 18 });

    expect(catalog.species.length).toBeGreaterThan(1000);
    expect(roster.length).toBe(208);
    expect(pool.length).toBe(roster.length);

    // And the filter has to keep biting. An empty roster would leave the pool
    // empty, `getTypeThreatWeights` would hand back the uniform weighting, and
    // the whole model would quietly revert to counting weaknesses — so assert
    // the pool can attack rather than merely that it is the right size.
    const weights = getThreatWeights(catalog, { baseScore: 18 });
    expect(isUniformTypeThreat(weights)).toBe(false);
    expect(pool.filter((variety) => hasCoverageMoveData(variety.name)).length / pool.length)
      .toBeGreaterThan(0.95);
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

  it('averages the team-scoring values to one, which is what keeps the denominators', () => {
    // `evaluateTeamSynergy` divides by counts — `typeCount`, `teamSize * 2` —
    // so a set of per-type values must average 1 or every synergy term silently
    // shrinks and `COMPOSITE_BOUNDS` stops describing the range it measured.
    // Max-normalizing, which is right for the per-bucket defensive score, is
    // exactly wrong here.
    const values = getTypeMatchupValues(catalog, {
      regulation: getRegulation('M-B'), baseScore: 18
    });
    const total = (v: Readonly<Record<string, number>>) =>
      TYPES.reduce((sum, type) => sum + v[type], 0);

    expect(total(values.threat)).toBeCloseTo(TYPES.length, 8);
    expect(total(values.presence)).toBeCloseTo(TYPES.length, 8);
    // And the spread survives the rescale: this is a redistribution, not a wash.
    expect(values.threat.fighting).toBeGreaterThan(1.5);
    expect(values.threat.normal).toBeLessThan(0.5);
  });

  it('returns the identical values object for the same selection', () => {
    // Same contract as the weights, and needed for the same reason: these are
    // read once per bring option and a bring of four has fifteen of them.
    const selection = { regulation: getRegulation('M-B'), baseScore: 18 };

    expect(getTypeMatchupValues(catalog, selection)).toBe(getTypeMatchupValues(catalog, selection));
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
