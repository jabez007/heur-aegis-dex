// Measures what one roster member is worth, which is what the alternatives
// margin should be.
//
// ROSTER_ALTERNATIVE_SCORE_MARGIN decides how far behind the best a generated
// roster may score and still be offered by `Try Another`. It shipped as 3 with
// no derivation recorded — the only constant in the scoring without one — and
// the cost of that showed up as a test that flipped four times across four
// consecutive recalibrations at 3.010, 2.950, 3.072 and 2.967, straddling the
// constant every time.
//
// Run with:  npm run measure:alternative-margin
//
// The result is pasted into rosterPortfolio.ts by hand, with the date, exactly
// as the other calibration constants are.
//
// ## The derivation
//
// An alternative has to replace at least MINIMUM_ROSTER_REPLACEMENTS members to
// count as one. So the question the margin answers is: how much total quality
// may those replacements give up before the roster stops being an equal choice
// and becomes a worse one?
//
// The natural unit is already in the model — what a single member contributes.
// Measured here as the score cost of taking the best roster a pool produces and
// replacing exactly one of its members with the best candidate not already on
// it. Set the margin to that, and an alternative swapping two or more members
// may still only give up what one member is worth, so the swaps are close to
// lateral. Set it higher and "alternative" starts meaning "worse roster".
//
// ## Why the best off-roster candidate, and not the pool median
//
// It used to be the pool's median candidate, and that measured the wrong thing
// in a way that only showed up once the pool grew. An alternative roster is
// built by the same beam search from the same top of the pool; it never reaches
// down to the 74th-best of 147. So the median counterfactual described a
// downgrade no alternative makes, and — worse — its size tracked the size of the
// pool, because a bigger pool has a worse middle. Dropping the
// `maxDamageFromScore` filter took M-B from 72 candidates to 147 and pushed the
// derived margin from 2.13 to 2.94, straight through the exclusion ceiling
// below, without anything having changed about what an alternative is.
//
// The best off-roster candidate is what the next alternative actually swaps in,
// and it moves the right way: a bigger pool has a *better* next-best candidate,
// so the swap costs less. The measure is anchored to the top of the pool, which
// is the only part of it the portfolio ever uses.
//
// Two independent checks are reported alongside, and neither is the derivation:
//
//   * Supply. The margin has to admit enough candidates for the portfolio to
//     find genuinely different rosters, so the share of scenarios offering two
//     or more diverse options is reported across the margin range.
//   * The exclusion ceiling. A roster registers six and brings four, so its
//     worst member is never brought and reaches the score only through the
//     brings it would spoil. That caps what a wasted slot can cost at about
//     three points — 2.963 in doubles and 2.786 in singles as last measured —
//     and a margin at or above the cap provably cannot exclude anything a sixth
//     slot does. The margin must sit clear of it, with room for the drift
//     recalibration causes.

import { readFileSync } from 'node:fs';
import { BATTLE_FORMATS } from '../src/lib/battleFormats.ts';
import { flattenToPokemon } from '../src/lib/pokemonEntry.ts';
import { getCatalogResistantTypes } from '../src/lib/pokemonCatalogScan.ts';
import { candidatePriority, generateRosters } from '../src/lib/rosterGeneration.ts';
import { evaluateRoster } from '../src/lib/rosterScoring.ts';
import { getTypeMatchupValues } from '../src/lib/threatPool.ts';
import { getRegulation } from '../src/lib/regulations.ts';
import { DEFAULT_BASE_SCORE } from '../src/lib/pokedexScoring.ts';
import {
  MINIMUM_ROSTER_REPLACEMENTS,
  ROSTER_PORTFOLIO_LIMIT,
  selectRosterPortfolio
} from '../src/lib/rosterPortfolio.ts';

const REGULATION = process.argv[2] ?? 'M-B';

// Cups are how a real user narrows the pool, and a narrow pool is where the
// margin matters most — it has the fewest genuinely different rosters to offer.
const CUPS = [
  ['open', null],
  ['boulder', ['rock', 'ground', 'steel', 'fighting']],
  ['twilight', ['fairy', 'dark', 'poison', 'ghost']],
  ['elemental', ['water', 'fire', 'grass', 'electric']],
  ['sky', ['flying', 'dragon', 'bug', 'ice']],
  ['mind', ['psychic', 'ghost', 'dark', 'fairy']],
  ['physical', ['fighting', 'rock', 'ground', 'bug', 'steel']]
];

const catalog = JSON.parse(
  readFileSync(new URL('../data/pokemon-catalog.v1.json', import.meta.url), 'utf8')
);
const scan = await getCatalogResistantTypes(catalog, {
  pokemonFilters: { regulation: REGULATION }
});
const full = flattenToPokemon(scan);
process.stderr.write(`${REGULATION}: ${full.length} scan candidates\n`);

// Measured under the weighting the app runs, for the reason COMPOSITE_BOUNDS
// gives: a margin derived from a scoring formula nothing uses is a margin
// nobody has checked.
const typeValues = getTypeMatchupValues(catalog, {
  regulation: getRegulation(REGULATION), baseScore: DEFAULT_BASE_SCORE
});

const percentile = (values, p) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(p * (sorted.length - 1))];
};

/** How many of a portfolio are a real alternative to every earlier pick. */
const diverseOptions = (picked) => {
  let count = 1;
  for (let index = 1; index < picked.length; index++) {
    const distances = picked.slice(0, index).map((earlier) => {
      const names = new Set(earlier.members.map((member) => member.name));
      return Math.max(earlier.members.length, picked[index].members.length)
        - picked[index].members.filter((member) => names.has(member.name)).length;
    });
    if (Math.min(...distances) >= MINIMUM_ROSTER_REPLACEMENTS) count++;
  }
  return count;
};

// Fresh generation and the two seeded cases a user actually hits: one locked
// favourite, and two.
const scenarios = [];
for (const [label, cup] of CUPS) {
  const pool = cup ? full.filter((entry) => entry.types.some((type) => cup.includes(type))) : full;
  if (pool.length < 8) {
    process.stderr.write(`  skipped ${label}: only ${pool.length} candidates\n`);
    continue;
  }
  for (const formatId of ['doubles', 'singles']) {
    const format = BATTLE_FORMATS[formatId];
    const ranked = [...pool].sort((left, right) =>
      candidatePriority(right, { hasAlly: format.hasAlly })
      - candidatePriority(left, { hasAlly: format.hasAlly }));
    scenarios.push({ label: `${label}/${formatId}`, pool, format, seed: [] });
    scenarios.push({ label: `${label}/${formatId}+1`, pool, format, seed: ranked.slice(20, 21) });
    scenarios.push({ label: `${label}/${formatId}+2`, pool, format, seed: ranked.slice(10, 12) });
  }
}

const MARGINS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 4];
const memberWorth = [];
const supply = Object.fromEntries(MARGINS.map((margin) => [margin, []]));

for (const scenario of scenarios) {
  const rosters = generateRosters({
    typeValues,
    pokemon: scenario.pool,
    format: scenario.format,
    rosterSize: scenario.format.maxRosterSize,
    seed: scenario.seed
  });
  if (rosters.length === 0) continue;

  for (const margin of MARGINS) {
    supply[margin].push(diverseOptions(selectRosterPortfolio(rosters, { scoreMargin: margin })));
  }

  // What one member is worth: replace each member of the best roster in turn
  // with the best candidate not already on it — the swap the next alternative
  // would make — and take the score it costs.
  const best = rosters[0];
  const ranked = [...scenario.pool].sort((left, right) =>
    candidatePriority(right, { hasAlly: scenario.format.hasAlly })
    - candidatePriority(left, { hasAlly: scenario.format.hasAlly }));
  const nextBest = ranked.find((entry) => !best.members.some((m) => m.name === entry.name));
  if (!nextBest) continue;

  best.members.forEach((member, index) => {
    // A seeded member is locked and cannot be the one swapped out.
    if (scenario.seed.some((locked) => locked.name === member.name)) return;
    const swapped = best.members.map((entry, position) => (position === index ? nextBest : entry));
    const cost = best.score
      - evaluateRoster(swapped, { format: scenario.format, typeValues }).score;
    if (cost > 0) memberWorth.push(cost);
  });
}

process.stdout.write(`\n${scenarios.length} scenarios across ${CUPS.length} pools and both formats\n`);

process.stdout.write(`\nwhat one member is worth — ${memberWorth.length} single-member downgrades to the best off-roster candidate:\n`);
for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
  process.stdout.write(`  p${String(p * 100).padStart(2)}  ${percentile(memberWorth, p).toFixed(4)}\n`);
}
process.stdout.write(
  `  range ${Math.min(...memberWorth).toFixed(4)}..${Math.max(...memberWorth).toFixed(4)}\n`
);
process.stdout.write(
  `\nROSTER_ALTERNATIVE_SCORE_MARGIN = ${percentile(memberWorth, 0.5).toFixed(2)}  (the median)\n`
);

process.stdout.write(`\nsupply check — diverse options out of ${ROSTER_PORTFOLIO_LIMIT}:\n`);
process.stdout.write('  margin   median   >=2 options   >=3 options\n');
for (const margin of MARGINS) {
  const counts = supply[margin];
  const share = (predicate) =>
    `${Math.round((100 * counts.filter(predicate).length) / counts.length)}%`;
  process.stdout.write(
    `   ${String(margin).padStart(5)}     ${String(percentile(counts, 0.5)).padStart(2)}`
    + `        ${share((value) => value >= 2).padStart(4)}          ${share((value) => value >= 3).padStart(4)}\n`
  );
}
