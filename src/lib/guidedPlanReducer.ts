import { isBattleFormatId, type BattleFormatId } from './battleFormats';

/**
 * Pure structural state machine for guided planning.
 *
 * Catalog legality and recommendation provenance are validated before choices
 * reach this boundary. This reducer owns invariants that remain meaningful for
 * every legal pool: locked favorites, species uniqueness, path lifecycle,
 * branching, selected-ability preservation, and plan-global exclusions.
 */

export const GUIDED_MAX_ADDITIONS = 3 as const;
export const GUIDED_MAX_ROSTER_SIZE = 6 as const;

export type GuidedPathId = 'A' | 'B';
export type GuidedPathStatus = 'active' | 'paused-after-two' | 'limit-reached';

export interface GuidedMemberChoice {
  /** Canonical variety slug from the catalog/recommendation boundary. */
  readonly varietyName: string;
  /** Canonical species slug from the catalog/recommendation boundary. */
  readonly speciesName: string;
  /** Exact selected ability returned by the accepted recommendation. */
  readonly abilityName: string;
}

export interface GuidedPath<I extends GuidedPathId = GuidedPathId> {
  readonly id: I;
  readonly status: GuidedPathStatus;
  readonly additions: readonly GuidedMemberChoice[];
}

export type GuidedBranchState =
  | Readonly<{
      kind: 'single-path';
      activePathId: 'A';
      paths: Readonly<{ A: GuidedPath<'A'> }>;
    }>
  | Readonly<{
      kind: 'forked';
      activePathId: GuidedPathId;
      forkPointAdditionCount: 0 | 1 | 2;
      paths: Readonly<{ A: GuidedPath<'A'>; B: GuidedPath<'B'> }>;
    }>;

export interface GuidedPlanState {
  readonly lockedFavorites: readonly GuidedMemberChoice[];
  readonly format: Readonly<{
    id: BattleFormatId;
    status: 'editable' | 'locked';
  }>;
  readonly excludedSpecies: readonly string[];
  readonly branch: GuidedBranchState;
}

export type GuidedPlanAction =
  | Readonly<{ type: 'set-format'; format: BattleFormatId }>
  | Readonly<{ type: 'recommendation-shown' }>
  | Readonly<{ type: 'add-partner'; member: GuidedMemberChoice }>
  | Readonly<{ type: 'pause-active-path' }>
  | Readonly<{ type: 'resume-active-path' }>
  | Readonly<{ type: 'fork-active-path' }>
  | Readonly<{ type: 'select-path'; pathId: GuidedPathId }>
  | Readonly<{ type: 'exclude-species'; speciesName: string }>
  | Readonly<{ type: 'restore-species'; speciesName: string }>;

export type GuidedPlanErrorCode =
  | 'INVALID_FORMAT'
  | 'INVALID_FAVORITE_COUNT'
  | 'INVALID_MEMBER_REFERENCE'
  | 'INVALID_SPECIES_REFERENCE'
  | 'DUPLICATE_FAVORITE_SPECIES'
  | 'FORMAT_LOCKED'
  | 'RECOMMENDATION_NOT_SHOWN'
  | 'PATH_PAUSED'
  | 'PATH_LIMIT_REACHED'
  | 'PAUSE_REQUIRES_TWO_ADDITIONS'
  | 'RESUME_REQUIRES_PAUSED_PATH'
  | 'PATH_NOT_FOUND'
  | 'PATH_ALREADY_FORKED'
  | 'DUPLICATE_SPECIES_ON_PATH'
  | 'SPECIES_EXCLUDED'
  | 'CANNOT_EXCLUDE_LOCKED_FAVORITE';

export interface GuidedPlanError {
  readonly code: GuidedPlanErrorCode;
  readonly actionType: 'create-plan' | GuidedPlanAction['type'];
  readonly pathId?: GuidedPathId;
  readonly speciesName?: string;
}

export type CreateGuidedPlanResult =
  | Readonly<{ ok: true; state: GuidedPlanState }>
  | Readonly<{ ok: false; error: GuidedPlanError }>;

export type GuidedPlanTransitionResult =
  | Readonly<{ ok: true; changed: boolean; state: GuidedPlanState }>
  | Readonly<{ ok: false; changed: false; state: GuidedPlanState; error: GuidedPlanError }>;

export interface CreateGuidedPlanInput {
  readonly format: BattleFormatId;
  readonly lockedFavorites: readonly GuidedMemberChoice[];
}

const validMember = (member: unknown): member is GuidedMemberChoice => {
  if (!member || typeof member !== 'object') return false;
  const value = member as Partial<GuidedMemberChoice>;
  return typeof value.varietyName === 'string' && value.varietyName.trim().length > 0 &&
    typeof value.speciesName === 'string' && value.speciesName.trim().length > 0 &&
    typeof value.abilityName === 'string' && value.abilityName.trim().length > 0;
};

const cloneMember = (member: GuidedMemberChoice): GuidedMemberChoice => ({ ...member });

const codePointCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export function createGuidedPlan(input: CreateGuidedPlanInput): CreateGuidedPlanResult {
  if (!isBattleFormatId(input.format)) {
    return { ok: false, error: { code: 'INVALID_FORMAT', actionType: 'create-plan' } };
  }
  if (input.lockedFavorites.length < 1 || input.lockedFavorites.length > 3) {
    return { ok: false, error: { code: 'INVALID_FAVORITE_COUNT', actionType: 'create-plan' } };
  }
  if (!input.lockedFavorites.every(validMember)) {
    return { ok: false, error: { code: 'INVALID_MEMBER_REFERENCE', actionType: 'create-plan' } };
  }
  if (new Set(input.lockedFavorites.map(({ speciesName }) => speciesName)).size !== input.lockedFavorites.length) {
    return { ok: false, error: { code: 'DUPLICATE_FAVORITE_SPECIES', actionType: 'create-plan' } };
  }

  return {
    ok: true,
    state: {
      lockedFavorites: input.lockedFavorites.map(cloneMember),
      format: { id: input.format, status: 'editable' },
      excludedSpecies: [],
      branch: {
        kind: 'single-path',
        activePathId: 'A',
        paths: { A: { id: 'A', status: 'active', additions: [] } }
      }
    }
  };
}

function reject(
  state: GuidedPlanState,
  action: GuidedPlanAction,
  code: GuidedPlanErrorCode,
  details: Pick<GuidedPlanError, 'pathId' | 'speciesName'> = {}
): GuidedPlanTransitionResult {
  return { ok: false, changed: false, state, error: { code, actionType: action.type, ...details } };
}

function activePath(state: GuidedPlanState): GuidedPath {
  if (state.branch.kind === 'forked' && state.branch.activePathId === 'B') return state.branch.paths.B;
  return state.branch.paths.A;
}

function replaceActivePath(state: GuidedPlanState, path: GuidedPath): GuidedPlanState {
  if (state.branch.kind === 'single-path') {
    return { ...state, branch: { ...state.branch, paths: { A: path as GuidedPath<'A'> } } };
  }
  return {
    ...state,
    branch: {
      ...state.branch,
      paths: path.id === 'A'
        ? { ...state.branch.paths, A: path as GuidedPath<'A'> }
        : { ...state.branch.paths, B: path as GuidedPath<'B'> }
    }
  };
}

export function getGuidedPath(state: GuidedPlanState, pathId: GuidedPathId): GuidedPath | null {
  if (pathId === 'A') return state.branch.paths.A;
  return state.branch.kind === 'forked' ? state.branch.paths.B : null;
}

export function getActiveGuidedPath(state: GuidedPlanState): GuidedPath {
  return activePath(state);
}

export function getGuidedRoster(
  state: GuidedPlanState,
  pathId: GuidedPathId
): readonly GuidedMemberChoice[] {
  const path = getGuidedPath(state, pathId);
  return path ? [...state.lockedFavorites, ...path.additions] : [];
}

export function getGuidedPathLabel(pathId: GuidedPathId): 'Path A' | 'Path B' {
  return pathId === 'A' ? 'Path A' : 'Path B';
}

export function transitionGuidedPlan(
  state: GuidedPlanState,
  action: GuidedPlanAction
): GuidedPlanTransitionResult {
  if (action.type === 'recommendation-shown') {
    if (state.format.status === 'locked') return { ok: true, changed: false, state };
    return { ok: true, changed: true, state: { ...state, format: { ...state.format, status: 'locked' } } };
  }

  if (action.type === 'add-partner') {
    const path = activePath(state);
    if (!validMember(action.member)) return reject(state, action, 'INVALID_MEMBER_REFERENCE', { pathId: path.id });
    const details = { pathId: path.id, speciesName: action.member.speciesName };
    if (state.format.status !== 'locked') return reject(state, action, 'RECOMMENDATION_NOT_SHOWN', details);
    if (path.status === 'paused-after-two') return reject(state, action, 'PATH_PAUSED', details);
    if (path.status === 'limit-reached') return reject(state, action, 'PATH_LIMIT_REACHED', details);
    if (state.excludedSpecies.includes(action.member.speciesName)) {
      return reject(state, action, 'SPECIES_EXCLUDED', details);
    }
    const rosterSpecies = [...state.lockedFavorites, ...path.additions].map(({ speciesName }) => speciesName);
    if (rosterSpecies.includes(action.member.speciesName)) {
      return reject(state, action, 'DUPLICATE_SPECIES_ON_PATH', details);
    }
    const additions = [...path.additions, cloneMember(action.member)];
    const nextPath: GuidedPath = {
      ...path,
      additions,
      status: additions.length === GUIDED_MAX_ADDITIONS ? 'limit-reached' : 'active'
    };
    return { ok: true, changed: true, state: replaceActivePath(state, nextPath) };
  }

  if (action.type === 'pause-active-path') {
    const path = activePath(state);
    if (path.status === 'limit-reached') return reject(state, action, 'PATH_LIMIT_REACHED', { pathId: path.id });
    if (path.status !== 'active' || path.additions.length !== 2) {
      return reject(state, action, 'PAUSE_REQUIRES_TWO_ADDITIONS', { pathId: path.id });
    }
    return {
      ok: true,
      changed: true,
      state: replaceActivePath(state, { ...path, status: 'paused-after-two' })
    };
  }

  if (action.type === 'resume-active-path') {
    const path = activePath(state);
    if (path.status !== 'paused-after-two') {
      return reject(state, action, 'RESUME_REQUIRES_PAUSED_PATH', { pathId: path.id });
    }
    return { ok: true, changed: true, state: replaceActivePath(state, { ...path, status: 'active' }) };
  }

  if (action.type === 'fork-active-path') {
    const path = activePath(state);
    if (state.format.status !== 'locked') {
      return reject(state, action, 'RECOMMENDATION_NOT_SHOWN', { pathId: path.id });
    }
    if (state.branch.kind === 'forked') return reject(state, action, 'PATH_ALREADY_FORKED', { pathId: path.id });
    if (path.status === 'paused-after-two') return reject(state, action, 'PATH_PAUSED', { pathId: path.id });
    if (path.status === 'limit-reached') return reject(state, action, 'PATH_LIMIT_REACHED', { pathId: path.id });
    const pathB: GuidedPath<'B'> = { id: 'B', status: 'active', additions: path.additions.map(cloneMember) };
    return {
      ok: true,
      changed: true,
      state: {
        ...state,
        branch: {
          kind: 'forked',
          activePathId: 'A',
          forkPointAdditionCount: path.additions.length as 0 | 1 | 2,
          paths: { A: path as GuidedPath<'A'>, B: pathB }
        }
      }
    };
  }

  if (action.type === 'select-path') {
    if (!getGuidedPath(state, action.pathId)) return reject(state, action, 'PATH_NOT_FOUND', { pathId: action.pathId });
    if (action.pathId === state.branch.activePathId) return { ok: true, changed: false, state };
    if (state.branch.kind === 'single-path') return { ok: true, changed: false, state };
    return {
      ok: true,
      changed: true,
      state: { ...state, branch: { ...state.branch, activePathId: action.pathId } }
    };
  }

  if (action.type === 'exclude-species') {
    if (typeof action.speciesName !== 'string' || action.speciesName.trim().length === 0) {
      return reject(state, action, 'INVALID_SPECIES_REFERENCE');
    }
    if (state.lockedFavorites.some(({ speciesName }) => speciesName === action.speciesName)) {
      return reject(state, action, 'CANNOT_EXCLUDE_LOCKED_FAVORITE', { speciesName: action.speciesName });
    }
    if (state.excludedSpecies.includes(action.speciesName)) return { ok: true, changed: false, state };
    return {
      ok: true,
      changed: true,
      state: {
        ...state,
        excludedSpecies: [...state.excludedSpecies, action.speciesName].sort(codePointCompare)
      }
    };
  }

  if (action.type === 'restore-species') {
    if (typeof action.speciesName !== 'string' || action.speciesName.trim().length === 0) {
      return reject(state, action, 'INVALID_SPECIES_REFERENCE');
    }
    if (!state.excludedSpecies.includes(action.speciesName)) return { ok: true, changed: false, state };
    return {
      ok: true,
      changed: true,
      state: { ...state, excludedSpecies: state.excludedSpecies.filter((name) => name !== action.speciesName) }
    };
  }

  if (!isBattleFormatId(action.format)) return reject(state, action, 'INVALID_FORMAT');
  if (state.format.status === 'locked') {
    return {
      ok: false,
      changed: false,
      state,
      error: { code: 'FORMAT_LOCKED', actionType: action.type }
    };
  }
  if (action.format === state.format.id) return { ok: true, changed: false, state };
  return { ok: true, changed: true, state: { ...state, format: { id: action.format, status: 'editable' } } };
}
