import { isBattleFormatId, type BattleFormatId } from './battleFormats';

export const GUIDED_MAX_ADDITIONS = 3 as const;

export interface GuidedMemberChoice {
  readonly varietyName: string;
  readonly speciesName: string;
  readonly abilityName: string;
}

export interface GuidedPlanState {
  readonly format: Readonly<{
    id: BattleFormatId;
    status: 'editable' | 'locked';
  }>;
  readonly lockedFavorites: readonly GuidedMemberChoice[];
  readonly additions: readonly GuidedMemberChoice[];
}

export type GuidedPlanAction =
  | Readonly<{ type: 'set-format'; format: BattleFormatId }>
  | Readonly<{ type: 'recommendation-shown' }>
  | Readonly<{ type: 'add-partner'; member: GuidedMemberChoice }>;

export type GuidedPlanErrorCode =
  | 'INVALID_FORMAT'
  | 'INVALID_FAVORITE_COUNT'
  | 'INVALID_MEMBER_REFERENCE'
  | 'DUPLICATE_FAVORITE_SPECIES'
  | 'FORMAT_LOCKED'
  | 'RECOMMENDATION_NOT_SHOWN'
  | 'DUPLICATE_SPECIES'
  | 'ADDITION_LIMIT_REACHED';

export interface GuidedPlanError {
  readonly code: GuidedPlanErrorCode;
  readonly actionType: 'create-plan' | GuidedPlanAction['type'];
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
      format: { id: input.format, status: 'editable' },
      lockedFavorites: input.lockedFavorites.map(cloneMember),
      additions: []
    }
  };
}

const reject = (
  state: GuidedPlanState,
  action: GuidedPlanAction,
  code: GuidedPlanErrorCode,
  speciesName?: string
): GuidedPlanTransitionResult => ({
  ok: false,
  changed: false,
  state,
  error: { code, actionType: action.type, ...(speciesName ? { speciesName } : {}) }
});

export function transitionGuidedPlan(
  state: GuidedPlanState,
  action: GuidedPlanAction
): GuidedPlanTransitionResult {
  if (action.type === 'recommendation-shown') {
    if (state.format.status === 'locked') return { ok: true, changed: false, state };
    return { ok: true, changed: true, state: { ...state, format: { ...state.format, status: 'locked' } } };
  }
  if (action.type === 'set-format') {
    if (!isBattleFormatId(action.format)) return reject(state, action, 'INVALID_FORMAT');
    if (state.format.status === 'locked') return reject(state, action, 'FORMAT_LOCKED');
    if (state.format.id === action.format) return { ok: true, changed: false, state };
    return { ok: true, changed: true, state: { ...state, format: { id: action.format, status: 'editable' } } };
  }

  if (!validMember(action.member)) return reject(state, action, 'INVALID_MEMBER_REFERENCE');
  if (state.format.status !== 'locked') {
    return reject(state, action, 'RECOMMENDATION_NOT_SHOWN', action.member.speciesName);
  }
  if (state.additions.length >= GUIDED_MAX_ADDITIONS) {
    return reject(state, action, 'ADDITION_LIMIT_REACHED', action.member.speciesName);
  }
  const species = [...state.lockedFavorites, ...state.additions].map(({ speciesName }) => speciesName);
  if (species.includes(action.member.speciesName)) {
    return reject(state, action, 'DUPLICATE_SPECIES', action.member.speciesName);
  }
  return {
    ok: true,
    changed: true,
    state: { ...state, additions: [...state.additions, cloneMember(action.member)] }
  };
}

export function getGuidedRoster(state: GuidedPlanState): readonly GuidedMemberChoice[] {
  return [...state.lockedFavorites, ...state.additions];
}
