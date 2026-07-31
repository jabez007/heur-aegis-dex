import { describe, expect, it } from 'vitest';
import {
  createGuidedPlan,
  getGuidedRoster,
  transitionGuidedPlan,
  type GuidedMemberChoice
} from './guidedPlanReducer';

const member = (varietyName: string, speciesName = varietyName, abilityName = 'ability'): GuidedMemberChoice => ({
  varietyName,
  speciesName,
  abilityName
});

describe.each(['singles', 'doubles'] as const)('guided current-session reducer: %s', (format) => {
  it('creates a plan around one to three unique favorites', () => {
    for (const count of [1, 2, 3]) {
      expect(createGuidedPlan({
        format,
        lockedFavorites: Array.from({ length: count }, (_, index) => member(`favorite-${index}`))
      }).ok).toBe(true);
    }
    expect(createGuidedPlan({ format, lockedFavorites: [] }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_FAVORITE_COUNT' } });
    expect(createGuidedPlan({
      format,
      lockedFavorites: [member('form-a', 'species'), member('form-b', 'species')]
    })).toMatchObject({ ok: false, error: { code: 'DUPLICATE_FAVORITE_SPECIES' } });
  });

  it('locks format when recommendations begin', () => {
    const created = createGuidedPlan({ format, lockedFavorites: [member('favorite')] });
    if (!created.ok) throw new Error('fixture creation failed');
    const locked = transitionGuidedPlan(created.state, { type: 'recommendation-shown' });
    if (!locked.ok) throw new Error('fixture lock failed');

    expect(locked.state.format.status).toBe('locked');
    expect(transitionGuidedPlan(locked.state, {
      type: 'set-format', format: format === 'singles' ? 'doubles' : 'singles'
    })).toMatchObject({ ok: false, error: { code: 'FORMAT_LOCKED' } });
  });

  it('stores up to three exact recommendations without changing favorites', () => {
    const favorite = member('favorite', 'favorite', 'favorite-ability');
    const favorites = [favorite, member('favorite-2'), member('favorite-3')];
    const created = createGuidedPlan({ format, lockedFavorites: favorites });
    if (!created.ok) throw new Error('fixture creation failed');
    const tooEarly = transitionGuidedPlan(created.state, {
      type: 'add-partner', member: member('partner-1')
    });
    expect(tooEarly).toMatchObject({ ok: false, error: { code: 'RECOMMENDATION_NOT_SHOWN' } });
    const locked = transitionGuidedPlan(created.state, { type: 'recommendation-shown' });
    if (!locked.ok) throw new Error('fixture lock failed');
    let state = locked.state;
    for (let index = 1; index <= 3; index++) {
      const added = transitionGuidedPlan(state, {
        type: 'add-partner', member: member(`partner-${index}`, `partner-${index}`, `ability-${index}`)
      });
      if (!added.ok) throw new Error('fixture addition failed');
      state = added.state;
    }

    expect(state.lockedFavorites).toEqual(favorites);
    expect(state.additions.map(({ abilityName }) => abilityName))
      .toEqual(['ability-1', 'ability-2', 'ability-3']);
    expect(getGuidedRoster(state)).toHaveLength(6);
    expect(transitionGuidedPlan(state, { type: 'add-partner', member: member('partner-4') }))
      .toMatchObject({ ok: false, error: { code: 'ADDITION_LIMIT_REACHED' } });
  });

  it('rejects duplicate species and snapshots caller-owned choices', () => {
    const favorite = { ...member('favorite') };
    const created = createGuidedPlan({ format, lockedFavorites: [favorite] });
    if (!created.ok) throw new Error('fixture creation failed');
    favorite.abilityName = 'mutated';
    const locked = transitionGuidedPlan(created.state, { type: 'recommendation-shown' });
    if (!locked.ok) throw new Error('fixture lock failed');

    expect(created.state.lockedFavorites[0].abilityName).toBe('ability');
    expect(transitionGuidedPlan(locked.state, {
      type: 'add-partner', member: member('other-form', 'favorite')
    })).toMatchObject({ ok: false, error: { code: 'DUPLICATE_SPECIES' } });
  });
});
