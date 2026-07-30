// @vitest-environment jsdom

import { createApp, nextTick, type App as VueApplication, type Plugin } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  getResistantTypes: vi.fn()
}));

vi.mock('lscache', () => ({
  default: {
    get: mocks.cacheGet,
    set: mocks.cacheSet
  }
}));

vi.mock('./lib/pokedex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/pokedex')>();
  return { ...actual, getResistantTypes: mocks.getResistantTypes };
});

import App from './App.vue';
import { provideMetaFilters } from './composables/useMetaFilters';
import { provideNotifications } from './composables/useNotifications';
import { provideTeamBuilder } from './composables/useTeamBuilder';
import { provideWorkspaceState } from './composables/useWorkspaceState';
import type { ResistantTypeResult } from './lib/pokedexTypes';
import {
  WORKSPACE_STORAGE_KEY,
  emptyWorkspaceArchive
} from './lib/workspacePersistence';

const scanResult: ResistantTypeResult[] = [{
  name: 'water',
  weaknesses: [],
  quadruple_weaknesses: [],
  resistances: [],
  immunities: [],
  ineffectives: [],
  coverages: [],
  pokemon: [],
  include_ability_immunities: true
}];

const statePlugin: Plugin = {
  install(app) {
    provideTeamBuilder(app);
    provideMetaFilters(app);
    provideNotifications(app);
    provideWorkspaceState(app);
  }
};

const mountApp = () => {
  const element = document.createElement('div');
  document.body.append(element);
  const app = createApp(App);
  app.use(statePlugin);
  app.mount(element);
  return { app, element };
};

let mounted: { app: VueApplication; element: HTMLElement } | undefined;

beforeEach(() => {
  localStorage.clear();
  mocks.cacheGet.mockReset();
  mocks.cacheSet.mockReset();
  mocks.getResistantTypes.mockReset();
});

afterEach(() => {
  mounted?.app.unmount();
  mounted?.element.remove();
  mounted = undefined;
});

describe('App scan and storage orchestration', () => {
  it('treats malformed cached scans as misses', async () => {
    mocks.cacheGet.mockReturnValue('{broken-json');
    mocks.getResistantTypes.mockResolvedValue(scanResult);

    mounted = mountApp();

    await vi.waitFor(() => expect(mounted!.element.textContent).toContain('Pokedex Database Ready'));
    expect(mocks.getResistantTypes).toHaveBeenCalledOnce();
    expect(mocks.cacheSet).toHaveBeenCalledWith(
      expect.stringMatching(/^heur_aegis_dex_v20_types_/),
      scanResult,
      60 * 24
    );
  });

  it('rejects parsed cache entries with malformed nested Pokemon data', async () => {
    mocks.cacheGet.mockReturnValue([{
      ...scanResult[0],
      pokemon: [{
        pokemon: { name: 'broken' },
        stats: { hp: 1, attack: 1, defense: 1, 'special-attack': 1, 'special-defense': 1, speed: 1 },
        base_stats: { hp: 1, attack: 1, defense: 1, 'special-attack': 1, 'special-defense': 1, speed: 1 },
        types: {},
        abilities: [],
        ability_profiles: {}
      }]
    }]);
    mocks.getResistantTypes.mockResolvedValue(scanResult);

    mounted = mountApp();

    await vi.waitFor(() => expect(mounted!.element.textContent).toContain('Pokedex Database Ready'));
    expect(mocks.getResistantTypes).toHaveBeenCalledOnce();
  });

  it('re-enables workspace saving after another tab repairs storage', async () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, '{broken-json');
    mocks.cacheGet.mockReturnValue(scanResult);

    mounted = mountApp();
    await vi.waitFor(() => {
      expect(mounted!.element.querySelector('.storage-error')?.textContent).not.toBe('');
    });

    const attacks = mounted.element.querySelector<HTMLInputElement>('input[type="number"]')!;
    attacks.value = '95';
    attacks.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(emptyWorkspaceArchive()));
    window.dispatchEvent(new StorageEvent('storage', { key: WORKSPACE_STORAGE_KEY }));
    await vi.waitFor(() => expect(mounted!.element.querySelector('.storage-error')).toBeNull());

    const recovered = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
    expect(recovered.draft.scan.minimumAttacks).toBe(95);
  });

  it('defers a repaired-storage draft save until the initial scan is ready', async () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, '{broken-json');
    mocks.cacheGet.mockReturnValue(null);
    let resolveScan!: (result: ResistantTypeResult[]) => void;
    mocks.getResistantTypes.mockReturnValue(new Promise((resolve) => {
      resolveScan = resolve;
    }));

    mounted = mountApp();
    await vi.waitFor(() => expect(mocks.getResistantTypes).toHaveBeenCalledOnce());

    const attacks = mounted.element.querySelector<HTMLInputElement>('input[type="number"]')!;
    attacks.value = '95';
    attacks.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(emptyWorkspaceArchive()));
    window.dispatchEvent(new StorageEvent('storage', { key: WORKSPACE_STORAGE_KEY }));
    await nextTick();
    expect(JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).draft).toBeNull();

    resolveScan(scanResult);
    await vi.waitFor(() => {
      const archive = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      expect(archive.draft?.scan.minimumAttacks).toBe(95);
    });

    const recovered = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
    expect(recovered.draft.scan.minimumAttacks).toBe(95);
  });
});
