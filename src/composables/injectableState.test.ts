import { describe, expect, it } from 'vitest';
import { createApp, inject, ref } from 'vue';
import { createInjectableState } from './injectableState';

const makeCounterState = () => createInjectableState('test:counter', () => ({ count: ref(0) }));

describe('createInjectableState', () => {
  it('gives each app its own isolated state', () => {
    const state = makeCounterState();
    const appA = createApp({});
    const appB = createApp({});

    const stateA = state.provideState(appA);
    const stateB = state.provideState(appB);

    stateA.count.value = 5;

    expect(stateB.count.value).toBe(0);
    expect(stateA).not.toBe(stateB);
  });

  it('provides the state under the injection key the composable reads', () => {
    const state = makeCounterState();
    const app = createApp({});
    const provided = state.provideState(app);

    expect(app.runWithContext(() => inject(state.key))).toBe(provided);
  });

  it('falls back to a single shared instance outside a component', () => {
    const state = makeCounterState();

    expect(state.useState()).toBe(state.useState());
  });

  it('does not let a provided app state leak into the fallback', () => {
    const state = makeCounterState();
    const app = createApp({});

    const providedState = state.provideState(app);
    providedState.count.value = 9;

    expect(state.useState().count.value).toBe(0);
  });

  it('discards the shared fallback on reset', () => {
    const state = makeCounterState();
    const first = state.useState();

    state.resetFallbackState();

    expect(state.useState()).not.toBe(first);
  });
});
