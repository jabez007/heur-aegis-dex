// Measures how often the field can inflict each status condition.
//
// This is the frequency term every status-facing ability needs and none of them
// had. The precedent is Mold Breaker in `abilityEffects.ts`: an opponent-facing
// effect is measurable because "the pool this tool already scores is a
// legitimate stand-in for the opponent". That argument was accepted there and
// applies unchanged here — and note what it is *not*. Crediting Purifying Salt
// from these numbers assumes nothing about the moveset of the Pokemon being
// scored, only about what the field it faces can do. That is the line that
// separates this from Prankster, whose value lives entirely in its own moves.
//
// The denominator is the legal species in default form, matching the Mold
// Breaker measurement rather than the 359 varieties the generator reports over.
// A Pokemon faces opponents, and an opponent is a species someone registered.
//
// Run with:  npm run measure:status-threat
//
// The result is pasted into STATUS_THREAT in statusThreat.ts by hand, with the
// date, exactly as the other calibration constants are.

import { readFileSync } from 'node:fs';
import { STATUS_MOVE_AILMENTS } from '../src/lib/statusMoveData.ts';
import { getRegulation } from '../src/lib/regulations.ts';

const catalog = JSON.parse(
  readFileSync(new URL('../data/pokemon-catalog.v1.json', import.meta.url), 'utf8')
);
const regulation = getRegulation('M-B');
if (!regulation) throw new Error('no M-B regulation to measure against');

const pool = catalog.varieties.filter(
  (v) => v.isDefault && regulation.legalSpecies.has(v.speciesName)
);
process.stdout.write(`pool: ${pool.length} legal species in default form\n\n`);

const counts = {};
let anyStatus = 0;
for (const variety of pool) {
  const ailments = STATUS_MOVE_AILMENTS[variety.name] ?? [];
  if (ailments.length > 0) anyStatus++;
  for (const ailment of ailments) counts[ailment] = (counts[ailment] || 0) + 1;
}

const share = (n) => n / pool.length;
process.stdout.write('STATUS_THREAT — share of the pool that can reliably inflict each:\n');
for (const [ailment, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  process.stdout.write(
    `  ${ailment.padEnd(10)} ${String(count).padStart(3)}/${pool.length}  ${share(count).toFixed(4)}\n`
  );
}
process.stdout.write(
  `\n  any of them  ${anyStatus}/${pool.length}  ${share(anyStatus).toFixed(4)}\n`
);

// Only burn and paralysis map onto a term scoreMemberQuality actually has.
// Poison and sleep are real and cost nothing in this model, which is why the
// value derived from these numbers is a floor rather than an estimate.
const scored = ['burn', 'paralysis'];
process.stdout.write(
  '\nof which the model can price: '
  + scored.map((a) => `${a} ${share(counts[a] || 0).toFixed(4)}`).join(', ')
  + `\nunpriced (no term for them): `
  + Object.keys(counts).filter((a) => !scored.includes(a))
    .map((a) => `${a} ${share(counts[a]).toFixed(4)}`).join(', ')
  + '\n'
);
