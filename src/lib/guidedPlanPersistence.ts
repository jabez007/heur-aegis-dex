import { isGuidedPlanState, type GuidedPlanState } from './guidedPlanReducer';
import type { PokedexRegion } from './workspacePersistence';

export const GUIDED_PLAN_STORAGE_KEY = 'heur-aegis-dex:guided-plans:v1';
export const GUIDED_PLAN_ARCHIVE_VERSION = 1 as const;

export type GuidedCompletedStep =
  | 'favorites-locked'
  | 'recommendation-shown'
  | 'partner-added'
  | 'path-forked'
  | 'comparison-viewed';

export interface GuidedScanSnapshotV1 {
  readonly regulation: string | null;
  readonly region: PokedexRegion;
  readonly minimumAttacks: number;
  readonly minimumBulk: number;
  readonly allowMegas: boolean;
  readonly includeAbilityImmunities: boolean;
  readonly includeMoveCoverage: boolean;
  readonly scanRevision: string;
}

export interface GuidedPlanRecordV1 {
  readonly updatedAt: string;
  readonly lastCompletedStep: GuidedCompletedStep;
  readonly scan: GuidedScanSnapshotV1;
  /** Frozen V1 persistence shape; changing reducer state requires an archive migration/version bump. */
  readonly state: GuidedPlanStateV1;
}

export type GuidedPlanStateV1 = GuidedPlanState;

export interface GuidedPlanArchiveV1 {
  readonly version: 1;
  readonly activePlanId: string | null;
  readonly draftPlanId: string | null;
  readonly plans: Readonly<Record<string, GuidedPlanRecordV1>>;
}

export interface GuidedPlanStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const REGIONS = new Set<PokedexRegion>(['national', 'kanto', 'galar', 'sinnoh', 'hisui', 'paldea']);
const COMPLETED_STEPS = new Set<GuidedCompletedStep>([
  'favorites-locked', 'recommendation-shown', 'partner-added', 'path-forked', 'comparison-viewed'
]);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const codePointCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort(codePointCompare);
  const expected = [...keys].sort(codePointCompare);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

export const emptyGuidedPlanArchive = (): GuidedPlanArchiveV1 => ({
  version: GUIDED_PLAN_ARCHIVE_VERSION,
  activePlanId: null,
  draftPlanId: null,
  plans: {}
});

export function isGuidedPlanRecord(value: unknown): value is GuidedPlanRecordV1 {
  if (!isObject(value) || !hasExactKeys(value, ['updatedAt', 'lastCompletedStep', 'scan', 'state']) ||
    !isTimestamp(value.updatedAt) ||
    typeof value.lastCompletedStep !== 'string' ||
    !COMPLETED_STEPS.has(value.lastCompletedStep as GuidedCompletedStep) ||
    !isObject(value.scan) || !hasExactKeys(value.scan, [
      'regulation', 'region', 'minimumAttacks', 'minimumBulk', 'allowMegas',
      'includeAbilityImmunities', 'includeMoveCoverage', 'scanRevision'
    ]) || !isGuidedPlanState(value.state)) return false;
  const scan = value.scan;
  const validScan = isNullableString(scan.regulation) && (scan.regulation === null || scan.regulation.length > 0) &&
    REGIONS.has(scan.region as PokedexRegion) &&
    isFiniteNumber(scan.minimumAttacks) && scan.minimumAttacks >= 0 &&
    isFiniteNumber(scan.minimumBulk) && scan.minimumBulk >= 0 &&
    typeof scan.allowMegas === 'boolean' && typeof scan.includeAbilityImmunities === 'boolean' &&
    typeof scan.includeMoveCoverage === 'boolean' &&
    typeof scan.scanRevision === 'string' && scan.scanRevision.trim().length > 0;
  if (!validScan) return false;
  const additions = value.state.branch.paths.A.additions.length +
    (value.state.branch.kind === 'forked' ? value.state.branch.paths.B.additions.length : 0);
  if (value.lastCompletedStep === 'recommendation-shown') return value.state.format.status === 'locked';
  if (value.lastCompletedStep === 'partner-added') return additions > 0;
  if (value.lastCompletedStep === 'path-forked' || value.lastCompletedStep === 'comparison-viewed') {
    return value.state.branch.kind === 'forked';
  }
  return true;
}

export function isGuidedPlanArchive(value: unknown): value is GuidedPlanArchiveV1 {
  if (!isObject(value) || !hasExactKeys(value, ['version', 'activePlanId', 'draftPlanId', 'plans']) ||
    value.version !== GUIDED_PLAN_ARCHIVE_VERSION ||
    !isNullableString(value.activePlanId) || !isNullableString(value.draftPlanId) ||
    !isObject(value.plans)) return false;
  const plans = value.plans;
  if (Object.entries(plans).some(([id, plan]) => id.trim().length === 0 || !isGuidedPlanRecord(plan))) return false;
  return (value.activePlanId === null || Object.prototype.hasOwnProperty.call(plans, value.activePlanId)) &&
    (value.draftPlanId === null || Object.prototype.hasOwnProperty.call(plans, value.draftPlanId));
}

export function readGuidedPlanArchive(storage: GuidedPlanStorage): GuidedPlanArchiveV1 {
  const raw = storage.getItem(GUIDED_PLAN_STORAGE_KEY);
  if (raw === null) return emptyGuidedPlanArchive();
  const parsed: unknown = JSON.parse(raw);
  if (isGuidedPlanArchive(parsed)) return parsed;
  if (!isObject(parsed) || !hasExactKeys(parsed, ['version', 'activePlanId', 'draftPlanId', 'plans']) ||
    parsed.version !== GUIDED_PLAN_ARCHIVE_VERSION || !isObject(parsed.plans)) {
    throw new Error('Saved guided plan data is damaged or unsupported.');
  }
  const plans = Object.fromEntries(Object.entries(parsed.plans).filter(
    (entry): entry is [string, GuidedPlanRecordV1] => entry[0].trim().length > 0 && isGuidedPlanRecord(entry[1])
  ));
  const hasPlan = (id: unknown): id is string =>
    typeof id === 'string' && Object.prototype.hasOwnProperty.call(plans, id);
  return {
    version: GUIDED_PLAN_ARCHIVE_VERSION,
    activePlanId: hasPlan(parsed.activePlanId) ? parsed.activePlanId : null,
    draftPlanId: hasPlan(parsed.draftPlanId) ? parsed.draftPlanId : null,
    plans
  };
}

export function writeGuidedPlanArchive(storage: GuidedPlanStorage, archive: GuidedPlanArchiveV1): void {
  if (!isGuidedPlanArchive(archive)) throw new Error('Refusing to write an invalid guided plan archive.');
  storage.setItem(GUIDED_PLAN_STORAGE_KEY, JSON.stringify(archive));
}

function requireValidArchive(archive: GuidedPlanArchiveV1): void {
  if (!isGuidedPlanArchive(archive)) throw new Error('Guided plan archive is invalid.');
}

function requireValidRecord(record: GuidedPlanRecordV1): void {
  if (!isGuidedPlanRecord(record)) throw new Error('Guided plan record is invalid.');
}

const cloneRecord = (record: GuidedPlanRecordV1): GuidedPlanRecordV1 =>
  JSON.parse(JSON.stringify(record)) as GuidedPlanRecordV1;

export function createGuidedPlanRecord(
  archive: GuidedPlanArchiveV1,
  record: GuidedPlanRecordV1,
  createId: () => string
): { readonly archive: GuidedPlanArchiveV1; readonly planId: string } {
  requireValidArchive(archive);
  requireValidRecord(record);
  const planId = createId();
  if (!planId || planId.trim().length === 0 || Object.prototype.hasOwnProperty.call(archive.plans, planId)) {
    throw new Error('Could not create a unique guided plan identifier.');
  }
  return {
    planId,
    archive: { ...archive, plans: { ...archive.plans, [planId]: cloneRecord(record) } }
  };
}

export function updateGuidedPlanRecord(
  archive: GuidedPlanArchiveV1,
  planId: string,
  record: GuidedPlanRecordV1
): GuidedPlanArchiveV1 {
  requireValidArchive(archive);
  requireValidRecord(record);
  if (!Object.prototype.hasOwnProperty.call(archive.plans, planId)) {
    throw new Error(`Guided plan ${planId} does not exist.`);
  }
  return { ...archive, plans: { ...archive.plans, [planId]: cloneRecord(record) } };
}

function setPlanPointer(
  archive: GuidedPlanArchiveV1,
  key: 'activePlanId' | 'draftPlanId',
  planId: string | null
): GuidedPlanArchiveV1 {
  requireValidArchive(archive);
  if (planId !== null && !Object.prototype.hasOwnProperty.call(archive.plans, planId)) {
    throw new Error(`Guided plan ${planId} does not exist.`);
  }
  if (archive[key] === planId) return archive;
  return { ...archive, [key]: planId };
}

export function setActiveGuidedPlanId(
  archive: GuidedPlanArchiveV1,
  planId: string | null
): GuidedPlanArchiveV1 {
  return setPlanPointer(archive, 'activePlanId', planId);
}

export function setDraftGuidedPlanId(
  archive: GuidedPlanArchiveV1,
  planId: string | null
): GuidedPlanArchiveV1 {
  return setPlanPointer(archive, 'draftPlanId', planId);
}

export function deleteGuidedPlanRecord(archive: GuidedPlanArchiveV1, planId: string): GuidedPlanArchiveV1 {
  requireValidArchive(archive);
  if (!Object.prototype.hasOwnProperty.call(archive.plans, planId)) return archive;
  const plans = { ...archive.plans };
  delete plans[planId];
  return {
    ...archive,
    activePlanId: archive.activePlanId === planId ? null : archive.activePlanId,
    draftPlanId: archive.draftPlanId === planId ? null : archive.draftPlanId,
    plans
  };
}
