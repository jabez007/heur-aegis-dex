// @vitest-environment jsdom

import { createApp, nextTick, type App as VueApplication } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PokemonEntry } from '../lib/pokemonEntry';

const stats = {
  hp: 90,
  attack: 100,
  defense: 90,
  'special-attack': 80,
  'special-defense': 90,
  speed: 80
};

const pokemon = (
  name: string,
  types: string[],
  abilityName: string,
  weaknesses: string[],
  quadrupleWeaknesses: string[],
  resistances: string[]
): PokemonEntry => ({
  name,
  speciesName: name,
  typeName: types.join('/'),
  types,
  sprite: '',
  stats,
  baseStats: stats,
  statsTotal: 530,
  abilities: [{ name: abilityName, is_hidden: false }],
  abilityName,
  abilityProfiles: { [abilityName]: {} },
  weaknesses,
  quadrupleWeaknesses,
  resistances,
  immunities: [],
  coverages: types,
  moveCoverages: types,
  normalizedDamageToScore: 0.5,
  normalizedDamageFromScore: 0.5
});

const fixtures = [
  pokemon('gyarados', ['water', 'flying'], 'intimidate', ['electric', 'rock'], ['electric'], ['fire']),
  pokemon('pelipper', ['water', 'flying'], 'drizzle', ['electric', 'rock'], ['electric'], ['fire']),
  pokemon('archaludon', ['steel', 'dragon'], 'sturdy', ['fighting', 'ground'], [], ['electric'])
];

vi.mock('../lib/pokemonEntry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/pokemonEntry')>();
  return { ...actual, flattenToPokemon: () => fixtures };
});

import GuidedPartnerBuilder from './GuidedPartnerBuilder.vue';

let app: VueApplication | undefined;
let element: HTMLElement | undefined;

afterEach(() => {
  app?.unmount();
  element?.remove();
  app = undefined;
  element = undefined;
});

const mountBuilder = () => {
  element = document.createElement('div');
  document.body.append(element);
  app = createApp(GuidedPartnerBuilder, { allDataTypes: [] });
  app.mount(element);
  return element;
};

const searchAndAdd = async (root: HTMLElement, query: string) => {
  const input = root.querySelector<HTMLInputElement>('#guided-pokemon-search')!;
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  root.querySelector<HTMLButtonElement>('.search-results button')!.click();
  await nextTick();
};

describe('GuidedPartnerBuilder', () => {
  it('runs a recommendation route without mutating an advanced workspace', async () => {
    const root = mountBuilder();

    expect(root.textContent).toContain('Lock 1-3 favorites');
    await searchAndAdd(root, 'gya');
    await searchAndAdd(root, 'peli');
    expect(root.textContent).toContain('Gyarados');
    expect(root.textContent).toContain('Pelipper');

    root.querySelector<HTMLButtonElement>('[data-guided-action="start"]')!.click();
    await nextTick();

    expect(root.textContent).toContain('Electric threatens the roster');
    expect(root.textContent).toContain('Archaludon');
    expect(root.textContent).toContain('Adds a resistance to Electric');

    root.querySelector<HTMLButtonElement>('[data-guided-action="add"]')!.click();
    await nextTick();

    expect(root.textContent).toContain('No eligible partner improves this need');
    expect(root.textContent).toContain('3/6');
  });

  it('discards current-session state when remounted', async () => {
    let root = mountBuilder();
    await searchAndAdd(root, 'gya');
    expect(root.textContent).toContain('Gyarados');

    app!.unmount();
    root.remove();
    app = undefined;
    element = undefined;

    root = mountBuilder();
    expect(root.textContent).not.toContain('Gyarados');
    expect(root.textContent).toContain('Lock 1-3 favorites');
  });
});
