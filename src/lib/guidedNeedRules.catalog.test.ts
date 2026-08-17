import { beforeAll, describe, expect, it } from 'vitest';
import catalogData from '../../data/pokemon-catalog.v1.json';
import { BATTLE_FORMATS } from './battleFormats';
import { recommendGuidedPartners } from './guidedNeedRules';
import { flattenToPokemon, type PokemonEntry } from './pokemonEntry';
import { getCatalogResistantTypes } from './pokemonCatalogScan';
import type { PokemonCatalogV1 } from './pokemonCatalog';

const catalog = catalogData as unknown as PokemonCatalogV1;
let candidatePool: PokemonEntry[];
let typeNames: string[];

beforeAll(async () => {
  const scan = await getCatalogResistantTypes(catalog, {
    typeFilters: {
      maxDamageFromScore: false,
      allowQuadrupleDamage: true,
      limitQuadrupleDamage: false
    },
    statsFilters: { minimumAttacks: 1, minimumBulk: 1 }
  });
  candidatePool = flattenToPokemon(scan);
  typeNames = scan.map(({ name }) => name).filter((name) => !name.includes('/'));
});

const members = (...names: string[]): PokemonEntry[] => names.map((name) => {
  const pokemon = candidatePool.find((entry) => entry.name === name);
  if (!pokemon) throw new Error(`Catalog fixture is missing ${name}`);
  return pokemon;
});

describe.each(['singles', 'doubles'] as const)('guided catalog recommendations: %s', (format) => {
  it('returns a stable shortlist for a recognizable weak core', () => {
    const request = {
      format: BATTLE_FORMATS[format],
      typeNames,
      currentMembers: members('gyarados', 'pelipper'),
      candidatePool
    };
    const first = recommendGuidedPartners(request);
    const second = recommendGuidedPartners(request);

    expect(first).toHaveLength(5);
    // This list moved when the resist abilities left abilityEffects.ts for the
    // type layer, and it moved for two reasons worth separating.
    //
    // Mamoswine sat second and now sits last. It carries Thick Fat, which the old
    // flat 1.12 on bulk overpaid — Ice/Ground gains real Fire relief, but the
    // constant was roughly four times the derived value and it scaled Mamoswine's
    // already-large bulk on top.
    //
    // Ursaluna carries no resist ability at all and still entered, displacing
    // Excadrill. That is the second-order effect: removing those multipliers
    // dropped OBSERVED_STAT_TERMS.bulk.max from 0.876 to 0.785, and the narrower
    // denominator lifts the bulk term for every Pokemon. A 130-HP bear benefits
    // most. Recorded because it is the surprising half — a change to the ability
    // tables reordered a Pokemon with no ability in them.
    //
    // Threat weighting then handed the slot to Excadrill, and pricing a true
    // immunity at -4 handed it straight back. **That slot is a tiebreak, not a
    // ranking**, which is the thing actually worth knowing here: all five of
    // these candidates score an identical `improvement` of 0.01389, because each
    // answers the same shared 4x Electric weakness and the measure cannot tell
    // them apart. Their order comes entirely from the secondary keys in
    // `compareRecommendations`.
    //
    // It is not the `quality` key. Ursaluna leads Excadrill on member quality
    // both before the change and after — 0.56082 against 0.53633, then 0.55340
    // against 0.52032 — so the flip happens on `primaryTradeoff.delta`, which is
    // compared first. Four revaluations have now shuffled the tail of this list
    // without any of them saying anything about which Pokemon is better:
    // Excadrill in, Ursaluna back, correcting IMMUNITY_VALUE from -4 to -2
    // dropping Mamoswine for Excadrill at the fifth slot, and allocating
    // coverage slots by what they buy putting Mamoswine back. The fifth slot has
    // now been Mamoswine, Excadrill, Mamoswine — which is the clearest statement
    // available that the list is four long and the tie-break is noise.
    //
    // The top two have held their places through all of it. The third did too,
    // until restricting the threat pool to species that exist in the game moved
    // Goodra-hisui from third to last — and that one is not tie-break noise, it
    // is the change working.
    //
    // This scan passes no regulation, so its weights came from an unregulated
    // pool: 1,025 species of which 817 have no movepool, which collapsed
    // availability into typing prevalence. The pool is now the game's 208, and
    // its weights are byte-identical to Regulation M-B's. Under the collapsed
    // reading Fighting and Ground were middling; under the real one they are the
    // two heaviest attacking types at 1.000 and 0.961.
    //
    // Goodra-hisui is Steel/Dragon, weak to exactly Fighting and Ground and
    // nothing else. So the typing whose whole case was that its two weaknesses
    // were cheap is the typing that moves when the price of those two weaknesses
    // is corrected. It was rising at every prior step — 0.186 to 0.137 to 0.341
    // to 0.220 normalized — on weights that were understating what it is weak
    // to.
    //
    // Making the offensive score regulation-aware moved nothing here, which is
    // worth recording because it is not obvious: Steel/Dragon is a poor
    // attacking pair against M-B and the census says so, but every candidate on
    // this list lost offensive credit and the order between them survived it.
    // Mamoswine and Goodra-Hisui swapped when firepower entered member quality,
    // which is a tie-break reshuffle and not a change of opinion: the assertion
    // below pins all five to the same improvement, and that is still true.
    // Mamoswine's best usable STAB is 100 against Goodra-Hisui's 120, so the
    // ordering within the tie now reflects a real difference even though the
    // improvement they offer this core does not.
    //
    // Dragapult fell from second to fourth when `MEMBER_WEIGHTS` moved to
    // 0.35 / 0.50 / 0.15 and `TYPE_MODULATION.defensive` rose to 0.5. Another
    // tie-break reshuffle by the same reading as the one above — the five are
    // still tied on improvement, which the next assertion pins — and the
    // clearest single illustration of what that change was for. Dragapult is
    // 142 base Speed on 88/75/75 bulk; the two that passed it are Ursaluna at
    // 130/105/80 and Goodra-Hisui, whose Steel/Dragon resists nine types. A
    // reshuffle that demotes the fastest and frailest of five equally useful
    // partners in favour of the two bulkiest is the weights doing what they
    // were changed to do.
    //
    // Mamoswine then left the list entirely, replaced by Excadrill, when
    // `moveCoverage` stopped counting the reach a Pokemon's STAB already has.
    // This is the first membership change here rather than another tie-break
    // reshuffle, and it falls out of the two largest corrections in the pool:
    // Mamoswine's reachable coverage drops 16 -> 7 and Excadrill's 15 -> 8,
    // because Ground/Ice and Ground/Steel already hit most of what their
    // coverage moves hit. Both were being paid twice; Mamoswine more.
    //
    // Worth recording that this moves the pair the way outside data does. The
    // sweep in `CANDIDATE_WEIGHTS.supportRole` notes that tier lists put
    // Excadrill at B and Mamoswine at C while this model had them the other way
    // round, and declined to fix it by raising a weight. Removing a double count
    // fixed part of it without one.
    expect(first.map(({ varietyName }) => varietyName)).toEqual([
      'archaludon',
      'ursaluna',
      'dragapult',
      'goodra-hisui',
      'excadrill'
    ]);
    // Pin the tie itself, so a change that makes these five genuinely separable
    // shows up as this assertion failing rather than as a reshuffled list whose
    // reshuffling means something entirely different.
    expect(new Set(first.map(({ improvement }) => improvement.toFixed(5))).size).toBe(1);
    expect(first.every(({ needId, reasons }) =>
      needId === 'shared-quadruple-weakness' &&
      reasons.some(({ dimension, delta }) => dimension === 'electric' && delta < 0)
    )).toBe(true);
    expect(second).toEqual(first);
  });

  it('returns no result when the primary need already has an answer', () => {
    const recommendations = recommendGuidedPartners({
      format: BATTLE_FORMATS[format],
      typeNames,
      currentMembers: members('gyarados', 'pelipper', 'seaking'),
      candidatePool
    });

    expect(members('seaking')[0].abilityName).toBe('lightning-rod');
    expect(recommendations).toEqual([]);
  });
});
