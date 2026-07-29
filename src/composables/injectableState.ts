import { getCurrentInstance, inject, type App, type InjectionKey } from 'vue';

/**
 * Builds a store that is scoped per Vue app rather than per module.
 *
 * Module-level refs are convenient in a single-page app but wrong for a
 * published library: two mounted instances would share one party, and under SSR
 * one request's state would leak into the next. Providing state on the app
 * instance keeps each mount isolated.
 *
 * A lazily created module-level instance remains as a fallback so components
 * still work when a host imports them individually without installing the
 * plugin, and so the store can be exercised outside a component (in tests).
 *
 * @param name Description used for the injection key symbol.
 * @param factory Creates a fresh state object.
 * @returns The injection key plus helpers to resolve, provide and reset state.
 */
export function createInjectableState<T>(name: string, factory: () => T) {
  const key: InjectionKey<T> = Symbol(name);
  let fallbackState: T | null = null;

  const getFallbackState = (): T => {
    if (!fallbackState) fallbackState = factory();
    return fallbackState;
  };

  /**
   * Resolves the state for the current context.
   *
   * @returns Provided app state when available, otherwise the shared fallback.
   */
  const useState = (): T => {
    // inject() is only valid during setup. Passing an explicit default keeps
    // Vue from warning when nothing has been provided.
    if (getCurrentInstance()) {
      return inject(key, undefined) ?? getFallbackState();
    }
    return getFallbackState();
  };

  /**
   * Gives a Vue app its own isolated copy of this state.
   *
   * @param app The app to provide state to.
   * @returns The newly created state.
   */
  const provideState = (app: App): T => {
    const state = factory();
    app.provide(key, state);
    return state;
  };

  /** Discards the shared fallback instance. Intended for tests. */
  const resetFallbackState = () => {
    fallbackState = null;
  };

  return { key, useState, provideState, resetFallbackState };
}
