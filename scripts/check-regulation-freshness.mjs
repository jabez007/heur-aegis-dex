import {
  REGULATION_FRESHNESS_HORIZON_DAYS,
  getActiveRegulation,
  getRegulationCoverageGap
} from '../src/lib/regulations.ts';

const now = process.env.REGULATION_CHECK_AT
  ? new Date(process.env.REGULATION_CHECK_AT)
  : new Date();
if (!Number.isFinite(now.getTime())) {
  throw new Error(`Invalid REGULATION_CHECK_AT: ${process.env.REGULATION_CHECK_AT}`);
}

const horizon = new Date(now.getTime() + REGULATION_FRESHNESS_HORIZON_DAYS * 24 * 60 * 60 * 1000);
const active = getActiveRegulation(now);
const gap = getRegulationCoverageGap(now, horizon);

if (!active) {
  throw new Error(`No regulation is active at ${now.toISOString()}. Add the current regulation before shipping.`);
}
if (gap) {
  throw new Error(
    `Regulation coverage ends at ${gap.toISOString()}, less than ${REGULATION_FRESHNESS_HORIZON_DAYS} days away. `
    + 'Add the successor regulation and regenerate roster-derived data.'
  );
}

process.stdout.write(
  `${active.id} is active; regulation data covers the next ${REGULATION_FRESHNESS_HORIZON_DAYS} days.\n`
);
