import { describe, expect, it } from 'vitest';
import {
  createGuidedPlan,
  getGuidedPathLabel,
  getGuidedRoster,
  isGuidedPlanState,
  transitionGuidedPlan,
  type GuidedPlanAction,
  type GuidedPlanState,
  type GuidedMemberChoice
} from './guidedPlanReducer';

const member = (varietyName: string, speciesName = varietyName, abilityName = 'ability'): GuidedMemberChoice => ({
  varietyName,
  speciesName,
  abilityName
});

describe('guided plan creation and format lock', () => {
  it('accepts one to three unique favorite species and rejects malformed cores', () => {
    for (const count of [1, 2, 3]) {
      expect(createGuidedPlan({
        format: 'doubles',
        lockedFavorites: Array.from({ length: count }, (_, index) => member(`favorite-${index}`))
      }).ok).toBe(true);
    }

    expect(createGuidedPlan({ format: 'doubles', lockedFavorites: [] }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_FAVORITE_COUNT' } });
    expect(createGuidedPlan({
      format: 'doubles',
      lockedFavorites: [member('form-a', 'species'), member('form-b', 'species')]
    })).toMatchObject({ ok: false, error: { code: 'DUPLICATE_FAVORITE_SPECIES' } });
    expect(createGuidedPlan({ format: 'doubles', lockedFavorites: [member('', 'species')] }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_MEMBER_REFERENCE' } });
  });

  it('locks the selected format when the first recommendation is shown', () => {
    const created = createGuidedPlan({
      format: 'singles',
      lockedFavorites: [member('favorite')]
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const edited = transitionGuidedPlan(created.state, { type: 'set-format', format: 'doubles' });
    expect(edited).toMatchObject({ ok: true, changed: true });
    if (!edited.ok) return;

    const locked = transitionGuidedPlan(edited.state, { type: 'recommendation-shown' });
    expect(locked).toMatchObject({
      ok: true,
      changed: true,
      state: { format: { id: 'doubles', status: 'locked' } }
    });
    if (!locked.ok) return;

    const rejected = transitionGuidedPlan(locked.state, { type: 'set-format', format: 'singles' });
    expect(rejected).toMatchObject({ ok: false, error: { code: 'FORMAT_LOCKED' } });
    expect(rejected.state).toBe(locked.state);
  });
});

describe('guided path lifecycle', () => {
  it('adds up to three exact partner choices through active, paused, and limit states', () => {
    const created = createGuidedPlan({
      format: 'doubles',
      lockedFavorites: [member('favorite-a'), member('favorite-b'), member('favorite-c')]
    });
    if (!created.ok) throw new Error('fixture creation failed');

    const tooEarly = transitionGuidedPlan(created.state, { type: 'add-partner', member: member('partner-1') });
    expect(tooEarly).toMatchObject({ ok: false, error: { code: 'RECOMMENDATION_NOT_SHOWN' } });

    const locked = transitionGuidedPlan(created.state, { type: 'recommendation-shown' });
    if (!locked.ok) throw new Error('fixture lock failed');
    const first = transitionGuidedPlan(locked.state, { type: 'add-partner', member: member('partner-1') });
    if (!first.ok) throw new Error('first addition failed');
    const second = transitionGuidedPlan(first.state, { type: 'add-partner', member: member('partner-2') });
    expect(second).toMatchObject({ ok: true, state: { branch: { paths: { A: { status: 'active' } } } } });
    if (!second.ok) return;

    const paused = transitionGuidedPlan(second.state, { type: 'pause-active-path' });
    expect(paused).toMatchObject({ ok: true, state: { branch: { paths: { A: { status: 'paused-after-two' } } } } });
    if (!paused.ok) return;
    expect(transitionGuidedPlan(paused.state, { type: 'add-partner', member: member('partner-3') }))
      .toMatchObject({ ok: false, error: { code: 'PATH_PAUSED' } });

    const resumed = transitionGuidedPlan(paused.state, { type: 'resume-active-path' });
    if (!resumed.ok) throw new Error('resume failed');
    const third = transitionGuidedPlan(resumed.state, { type: 'add-partner', member: member('partner-3') });
    expect(third).toMatchObject({
      ok: true,
      state: { branch: { paths: { A: { status: 'limit-reached', additions: expect.any(Array) } } } }
    });
    if (!third.ok) return;
    expect(third.state.branch.paths.A.additions).toEqual([
      member('partner-1'), member('partner-2'), member('partner-3')
    ]);
    expect(transitionGuidedPlan(third.state, { type: 'add-partner', member: member('partner-4') }))
      .toMatchObject({ ok: false, error: { code: 'PATH_LIMIT_REACHED' } });
    expect(transitionGuidedPlan(third.state, { type: 'fork-active-path' }))
      .toMatchObject({ ok: false, error: { code: 'PATH_LIMIT_REACHED' } });
  });
});

describe('guided path fork and exclusions', () => {
  it('copies the pre-fork prefix and keeps later choices path-local', () => {
    const created = createGuidedPlan({ format: 'singles', lockedFavorites: [member('favorite')] });
    if (!created.ok) throw new Error('fixture creation failed');
    const locked = transitionGuidedPlan(created.state, { type: 'recommendation-shown' });
    if (!locked.ok) throw new Error('fixture lock failed');
    const first = transitionGuidedPlan(locked.state, {
      type: 'add-partner',
      member: member('shared-partner', 'shared-species', 'shared-ability')
    });
    if (!first.ok) throw new Error('fixture addition failed');

    const forked = transitionGuidedPlan(first.state, { type: 'fork-active-path' });
    expect(forked).toMatchObject({
      ok: true,
      state: {
        branch: {
          kind: 'forked',
          activePathId: 'A',
          forkPointAdditionCount: 1,
          paths: { B: { id: 'B', status: 'active' } }
        }
      }
    });
    if (!forked.ok || forked.state.branch.kind !== 'forked') return;
    expect(forked.state.branch.paths.B.additions).toEqual(forked.state.branch.paths.A.additions);
    expect(forked.state.branch.paths.B.additions).not.toBe(forked.state.branch.paths.A.additions);
    expect(forked.state.branch.paths.B.additions[0]).not.toBe(forked.state.branch.paths.A.additions[0]);
    expect(transitionGuidedPlan(forked.state, { type: 'fork-active-path' }))
      .toMatchObject({ ok: false, error: { code: 'PATH_ALREADY_FORKED' } });

    const selectedB = transitionGuidedPlan(forked.state, { type: 'select-path', pathId: 'B' });
    if (!selectedB.ok) throw new Error('path selection failed');
    const changedB = transitionGuidedPlan(selectedB.state, {
      type: 'add-partner',
      member: member('path-b-partner', 'path-b-species', 'path-b-ability')
    });
    if (!changedB.ok) throw new Error('path B addition failed');

    expect(changedB.state.branch.paths.A.additions).toHaveLength(1);
    expect(changedB.state.branch.kind).toBe('forked');
    if (changedB.state.branch.kind !== 'forked') return;
    expect(changedB.state.branch.paths.B.additions).toHaveLength(2);
    expect(getGuidedRoster(changedB.state, 'B').map(({ varietyName }) => varietyName))
      .toEqual(['favorite', 'shared-partner', 'path-b-partner']);
    expect(getGuidedPathLabel('A')).toBe('Path A');
    expect(getGuidedPathLabel('B')).toBe('Path B');
  });

  it('applies exclusions prospectively to both paths without removing choices', () => {
    const created = createGuidedPlan({ format: 'doubles', lockedFavorites: [member('favorite')] });
    if (!created.ok) throw new Error('fixture creation failed');
    const locked = transitionGuidedPlan(created.state, { type: 'recommendation-shown' });
    if (!locked.ok) throw new Error('fixture lock failed');
    const forked = transitionGuidedPlan(locked.state, { type: 'fork-active-path' });
    if (!forked.ok) throw new Error('fixture fork failed');

    const excluded = transitionGuidedPlan(forked.state, { type: 'exclude-species', speciesName: 'blocked' });
    expect(excluded).toMatchObject({ ok: true, state: { excludedSpecies: ['blocked'] } });
    if (!excluded.ok) return;
    expect(transitionGuidedPlan(excluded.state, {
      type: 'add-partner', member: member('blocked-form', 'blocked')
    })).toMatchObject({ ok: false, error: { code: 'SPECIES_EXCLUDED' } });

    const selectedB = transitionGuidedPlan(excluded.state, { type: 'select-path', pathId: 'B' });
    if (!selectedB.ok) throw new Error('path selection failed');
    expect(transitionGuidedPlan(selectedB.state, {
      type: 'add-partner', member: member('blocked-other-form', 'blocked')
    })).toMatchObject({ ok: false, error: { code: 'SPECIES_EXCLUDED' } });
    expect(transitionGuidedPlan(selectedB.state, { type: 'exclude-species', speciesName: 'favorite' }))
      .toMatchObject({ ok: false, error: { code: 'CANNOT_EXCLUDE_LOCKED_FAVORITE' } });

    const restored = transitionGuidedPlan(selectedB.state, { type: 'restore-species', speciesName: 'blocked' });
    expect(restored).toMatchObject({ ok: true, state: { excludedSpecies: [] } });
  });

  it('counts the copied two-partner prefix toward each path limit', () => {
    const created = createGuidedPlan({ format: 'doubles', lockedFavorites: [member('favorite')] });
    if (!created.ok) throw new Error('fixture creation failed');
    let state = transitionGuidedPlan(created.state, { type: 'recommendation-shown' });
    if (!state.ok) throw new Error('fixture lock failed');
    for (const shared of [member('shared-a'), member('shared-b')]) {
      state = transitionGuidedPlan(state.state, { type: 'add-partner', member: shared });
      if (!state.ok) throw new Error('shared addition failed');
    }
    const forked = transitionGuidedPlan(state.state, { type: 'fork-active-path' });
    if (!forked.ok) throw new Error('fork failed');
    const pathA = transitionGuidedPlan(forked.state, {
      type: 'add-partner', member: member('path-a-final', 'path-a-final', 'ability-a')
    });
    if (!pathA.ok) throw new Error('path A addition failed');
    const selectedB = transitionGuidedPlan(pathA.state, { type: 'select-path', pathId: 'B' });
    if (!selectedB.ok) throw new Error('path B selection failed');
    const pathB = transitionGuidedPlan(selectedB.state, {
      type: 'add-partner', member: member('path-b-final', 'path-b-final', 'ability-b')
    });
    if (!pathB.ok) throw new Error('path B addition failed');

    expect(pathB.state.branch.paths.A).toMatchObject({ status: 'limit-reached' });
    expect(pathB.state.branch.kind).toBe('forked');
    if (pathB.state.branch.kind !== 'forked') return;
    expect(pathB.state.branch.paths.B).toMatchObject({ status: 'limit-reached' });
    expect(pathB.state.branch.paths.A.additions[2].abilityName).toBe('ability-a');
    expect(pathB.state.branch.paths.B.additions[2].abilityName).toBe('ability-b');
  });
});

const assertPlanInvariants = (state: GuidedPlanState, originalFavorites: readonly GuidedMemberChoice[]) => {
  const invariant = (holds: boolean, message: string) => {
    if (!holds) throw new Error(message);
  };
  invariant(isGuidedPlanState(state), 'state validator rejected a reachable state');
  invariant(JSON.stringify(state.lockedFavorites) === JSON.stringify(originalFavorites), 'favorites changed');
  invariant(state.lockedFavorites.length >= 1 && state.lockedFavorites.length <= 3, 'favorite count invalid');
  invariant(
    JSON.stringify(state.excludedSpecies) === JSON.stringify([...new Set(state.excludedSpecies)].sort()),
    'exclusions are not canonical'
  );

  const paths = state.branch.kind === 'forked'
    ? [state.branch.paths.A, state.branch.paths.B]
    : [state.branch.paths.A];
  invariant(paths.length === (state.branch.kind === 'forked' ? 2 : 1), 'branch path count invalid');
  for (const path of paths) {
    const roster = [...state.lockedFavorites, ...path.additions];
    invariant(new Set(roster.map(({ speciesName }) => speciesName)).size === roster.length,
      'path contains duplicate species');
    invariant(path.additions.length <= 3, 'addition limit exceeded');
    invariant(roster.length <= 6, 'roster limit exceeded');
    invariant(path.status !== 'paused-after-two' || path.additions.length === 2, 'paused path count invalid');
    invariant(path.status !== 'limit-reached' || path.additions.length === 3, 'limited path count invalid');
    invariant(path.status !== 'active' || path.additions.length <= 2, 'active path count invalid');
  }
  if (state.branch.kind === 'forked') {
    invariant(state.branch.paths.A.id === 'A' && state.branch.paths.B.id === 'B', 'forked path ID invalid');
    invariant(state.branch.activePathId === 'A' || state.branch.activePathId === 'B', 'active path invalid');
    const count = state.branch.forkPointAdditionCount;
    invariant(count <= 2, 'fork point invalid');
    invariant(
      JSON.stringify(state.branch.paths.B.additions.slice(0, count)) ===
        JSON.stringify(state.branch.paths.A.additions.slice(0, count)),
      'fork prefix changed'
    );
  } else {
    invariant(state.branch.activePathId === 'A' && state.branch.paths.A.id === 'A', 'single path invalid');
  }
};

describe('guided plan exhaustive invariants', () => {
  it('returns structured errors for malformed runtime payloads', () => {
    const created = createGuidedPlan({ format: 'singles', lockedFavorites: [member('favorite')] });
    if (!created.ok) throw new Error('fixture creation failed');

    expect(transitionGuidedPlan(created.state, {
      type: 'add-partner', member: null
    } as unknown as GuidedPlanAction)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_MEMBER_REFERENCE' }
    });
    expect(transitionGuidedPlan(created.state, {
      type: 'exclude-species', speciesName: null
    } as unknown as GuidedPlanAction)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_SPECIES_REFERENCE' }
    });
  });

  it('snapshots caller-owned favorites and partner choices', () => {
    const favorite = { varietyName: 'favorite', speciesName: 'favorite', abilityName: 'first-ability' };
    const created = createGuidedPlan({ format: 'singles', lockedFavorites: [favorite] });
    if (!created.ok) throw new Error('fixture creation failed');
    favorite.abilityName = 'mutated';
    expect(created.state.lockedFavorites[0].abilityName).toBe('first-ability');

    const locked = transitionGuidedPlan(created.state, { type: 'recommendation-shown' });
    if (!locked.ok) throw new Error('fixture lock failed');
    const partner = { varietyName: 'partner', speciesName: 'partner', abilityName: 'selected-ability' };
    const added = transitionGuidedPlan(locked.state, { type: 'add-partner', member: partner });
    if (!added.ok) throw new Error('fixture addition failed');
    partner.abilityName = 'mutated';
    expect(added.state.branch.paths.A.additions[0].abilityName).toBe('selected-ability');
  });

  it.each(['singles', 'doubles'] as const)('preserves every invariant across reachable %s transitions', (format) => {
    const favorites = [member('favorite')];
    const created = createGuidedPlan({ format, lockedFavorites: favorites });
    if (!created.ok) throw new Error('fixture creation failed');
    const actionTypes = [
      'set-format', 'recommendation-shown', 'add-partner', 'pause-active-path',
      'resume-active-path', 'fork-active-path', 'select-path', 'exclude-species', 'restore-species'
    ] as const;
    const allActionTypesCovered: Exclude<GuidedPlanAction['type'], typeof actionTypes[number]> extends never
      ? true
      : false = true;
    expect(allActionTypesCovered).toBe(true);
    const actions: GuidedPlanAction[] = [
      { type: 'set-format', format: 'singles' },
      { type: 'set-format', format: 'doubles' },
      { type: 'recommendation-shown' },
      { type: 'add-partner', member: member('partner-a') },
      { type: 'add-partner', member: member('partner-b') },
      { type: 'add-partner', member: member('partner-c') },
      { type: 'add-partner', member: member('favorite') },
      { type: 'pause-active-path' },
      { type: 'resume-active-path' },
      { type: 'fork-active-path' },
      { type: 'select-path', pathId: 'A' },
      { type: 'select-path', pathId: 'B' },
      { type: 'exclude-species', speciesName: 'partner-a' },
      { type: 'restore-species', speciesName: 'partner-a' }
    ];
    expect(new Set(actions.map(({ type }) => type))).toEqual(new Set(actionTypes));
    const seen = new Set([JSON.stringify(created.state)]);
    let frontier = [created.state];

    let depth = 0;
    while (frontier.length > 0 && depth < 20) {
      const next: GuidedPlanState[] = [];
      for (const state of frontier) {
        assertPlanInvariants(state, favorites);
        for (const action of actions) {
          const before = JSON.stringify(state);
          const result = transitionGuidedPlan(state, action);
          if (JSON.stringify(state) !== before) throw new Error('transition mutated its input state');
          if (!result.ok) {
            if (result.state !== state) throw new Error('rejection replaced its input state');
            continue;
          }
          assertPlanInvariants(result.state, favorites);
          if (state.format.status === 'locked' && JSON.stringify(result.state.format) !== JSON.stringify(state.format)) {
            throw new Error('locked format changed');
          }
          const key = JSON.stringify(result.state);
          if (!seen.has(key)) {
            seen.add(key);
            next.push(result.state);
          }
        }
      }
      frontier = next;
      depth++;
    }

    expect(frontier).toEqual([]);
    expect(seen.size).toBeGreaterThan(20);
  }, 15_000);
});
