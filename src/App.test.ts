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
  WORKSPACE_VERSION,
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
  if (!HTMLDialogElement.prototype.close) {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: vi.fn()
    });
  }
  mocks.cacheGet.mockReset();
  mocks.cacheSet.mockReset();
  mocks.getResistantTypes.mockReset();
});

afterEach(() => {
  mounted?.app.unmount();
  mounted?.element.remove();
  mounted = undefined;
  vi.useRealTimers();
});

describe('App scan and storage orchestration', () => {
  it('keeps Advanced Lab as default and destroys Guided Build when leaving it', async () => {
    mocks.cacheGet.mockReturnValue(null);
    mocks.getResistantTypes.mockResolvedValue(scanResult);

    mounted = mountApp();
    const regulationSelect = mounted.element.querySelector<HTMLSelectElement>('.regulation-select')!;
    regulationSelect.value = '__unrestricted__';
    regulationSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(mounted!.element.querySelector('.workspace-mode-options')).not.toBeNull());

    expect(mounted.element.querySelector('#guided-title')).toBeNull();
    const [guidedButton, advancedButton] = mounted.element
      .querySelectorAll<HTMLButtonElement>('.workspace-mode-options button');
    guidedButton.click();
    await nextTick();
    expect(mounted.element.querySelector('#guided-title')).not.toBeNull();

    advancedButton.click();
    await nextTick();
    expect(mounted.element.querySelector('#guided-title')).toBeNull();
  });

  it('requires an explicit regulation choice when the schedule has expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    mocks.cacheGet.mockReturnValue(null);
    mocks.getResistantTypes.mockResolvedValue(scanResult);

    mounted = mountApp();
    await nextTick();
    await Promise.resolve();

    expect(mocks.getResistantTypes).not.toHaveBeenCalled();
    expect(mounted.element.textContent).toContain('No active regulation is recorded');

    const select = mounted.element.querySelector<HTMLSelectElement>('.regulation-select')!;
    select.value = '__unrestricted__';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(mocks.getResistantTypes).toHaveBeenCalledOnce();
  });

  it('does not turn a removed workspace regulation into unrestricted play', async () => {
    const archive = emptyWorkspaceArchive();
    archive.draft = {
      version: WORKSPACE_VERSION,
      scan: {
        inPokedex: 'national',
        regulation: 'M-Z',
        minimumAttacks: 80,
        minimumBulk: 70,
        allowMegas: false,
        includeAbilityImmunities: true,
        includeMoveCoverage: true
      },
      meta: { selectedTypes: [], requireAllTypes: false },
      abilityOverrides: {},
      team: { format: 'doubles', roster: [], bring: null, excluded: [] }
    };
    archive.draftUpdatedAt = '2026-07-30T00:00:00Z';
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(archive));
    mocks.cacheGet.mockReturnValue(null);
    mocks.getResistantTypes.mockResolvedValue(scanResult);

    mounted = mountApp();
    await nextTick();
    await Promise.resolve();

    expect(mocks.getResistantTypes).not.toHaveBeenCalled();
    expect(mounted.element.textContent).toContain('Regulation selection required // scan blocked');
    expect(mounted.element.textContent).toContain('Regulation Selection Required');
  });

  it('clears previous scan results when a loaded workspace regulation was removed', async () => {
    const archive = emptyWorkspaceArchive();
    archive.saves = [{
      id: 'stale-save',
      name: 'Stale Regulation',
      updatedAt: '2026-07-30T00:00:00Z',
      snapshot: {
        version: WORKSPACE_VERSION,
        scan: {
          inPokedex: 'national',
          regulation: 'M-Z',
          minimumAttacks: 80,
          minimumBulk: 70,
          allowMegas: false,
          includeAbilityImmunities: true,
          includeMoveCoverage: true
        },
        meta: { selectedTypes: [], requireAllTypes: false },
        abilityOverrides: {},
        team: { format: 'doubles', roster: [], bring: null, excluded: [] }
      }
    }];
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(archive));
    mocks.cacheGet.mockReturnValue(scanResult);

    mounted = mountApp();
    await vi.waitFor(() => expect(mounted!.element.textContent).toContain('Pokedex Database Ready'));

    mounted.element.querySelector<HTMLButtonElement>('[data-workspace-action="load"]')!.click();
    await nextTick();
    const confirmLoad = [...mounted.element.querySelectorAll<HTMLButtonElement>('.confirm-row button')]
      .find((button) => button.textContent?.trim() === 'Load')!;
    confirmLoad.click();
    await nextTick();
    await Promise.resolve();

    expect(mounted.element.textContent).not.toContain('Pokedex Database Ready');
    expect(mounted.element.textContent).toContain('Regulation selection required // scan blocked');
    expect(mocks.getResistantTypes).not.toHaveBeenCalled();
  });

  it('treats malformed cached scans as misses', async () => {
    mocks.cacheGet.mockReturnValue('{broken-json');
    mocks.getResistantTypes.mockResolvedValue(scanResult);

    mounted = mountApp();

    await vi.waitFor(() => expect(mounted!.element.textContent).toContain('Pokedex Database Ready'));
    expect(mocks.getResistantTypes).toHaveBeenCalledOnce();
    expect(mocks.cacheSet).toHaveBeenCalledWith(
      expect.stringMatching(/^heur_aegis_dex_v21_scan-1_ab1cd34ca0fc4fd13481ea610dbb7ddb4bdd890dbe21525c556dffebe41ee1f0_d7526351fb644511b27bc142e2e6a43f045a7fd2580ce2f9e28ec3fb21e7e09d_types_/),
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
