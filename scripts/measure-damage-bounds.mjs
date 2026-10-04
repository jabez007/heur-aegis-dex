// Measures the reachable extremes of the two typing scores.
//
// `pokedexScoring.ts` normalizes `damage_from_score` and `damage_to_score`
// against OBSERVED_DAMAGE_FROM / OBSERVED_DAMAGE_TO. The argument for measuring
// those rather than deriving them from the formula is written at length there —
// read it before changing anything here.
//
// The method is the one that comment already describes, and until now it lived
// only in that comment: every type combination the scan produces, crossed with
// every ability that alters damage relations, plus the no-ability case. That is
// deliberately a superset of any roster, which is the property a bound needs —
// a real Pokemon cannot fall outside it, so nothing clamps by surprise.
//
// Written when the resist abilities moved into pokedexAbilities.ts. Six new
// abilities entered that cross product, and the existing bounds had been
// measured over the eleven immunities alone.
//
// Run with:  npm run measure:damage-bounds
//
// The result is pasted into OBSERVED_DAMAGE_FROM / OBSERVED_DAMAGE_TO in
// pokedexScoring.ts by hand, with the date, exactly as the other calibration
// constants are. A bound that silently moves when someone reruns a script is a
// bound nobody has checked.

import { getBaseTypes, getDualTypes } from '../src/lib/pokedex.ts';
import { createAbilityProfile, TYPING_ABILITIES } from '../src/lib/pokedexAbilities.ts';
import { DEFAULT_BASE_SCORE as BASE } from '../src/lib/pokedexScoring.ts';

const base = await getBaseTypes(BASE);
const combinations = base.concat(await getDualTypes(BASE, base));
process.stderr.write(`${combinations.length} type combinations\n`);
process.stderr.write(`${TYPING_ABILITIES.length} typing abilities + the no-ability case\n`);

// '' is the no-ability case: createAbilityProfile matches no rule and returns
// the bare typing, which is what a Pokemon with an unmodelled ability scores.
const abilities = ['', ...TYPING_ABILITIES];

const extreme = {
  from: { min: Infinity, max: -Infinity, minAt: '', maxAt: '' },
  to: { min: Infinity, max: -Infinity, minAt: '', maxAt: '' }
};

for (const combination of combinations) {
  for (const ability of abilities) {
    const { damage_relations: dr } = createAbilityProfile(
      combination.damage_relations, ability, BASE
    );
    const label = `${combination.name}${ability ? ` + ${ability}` : ''}`;

    for (const [key, score] of [['from', dr.damage_from_score], ['to', dr.damage_to_score]]) {
      const e = extreme[key];
      if (score < e.min) { e.min = score; e.minAt = label; }
      if (score > e.max) { e.max = score; e.maxAt = label; }
    }
  }
}

const report = (key, name) => {
  const e = extreme[key];
  process.stdout.write(
    `${name}\n`
    + `  min ${e.min}  ${e.minAt}\n`
    + `  max ${e.max}  ${e.maxAt}\n`
  );
};

process.stdout.write(`\nmeasured at baseScore ${BASE} over ${combinations.length * abilities.length} profiles\n\n`);
report('from', 'OBSERVED_DAMAGE_FROM');
report('to', 'OBSERVED_DAMAGE_TO');
process.stdout.write(
  '\nAbilities never touch the offensive buckets, so the `to` range is the bare\n'
  + 'typing range and should not move when the ability tables change.\n'
);
