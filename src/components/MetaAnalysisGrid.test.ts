// @vitest-environment jsdom

import { computed, createApp, defineComponent, h, nextTick, ref, type App as VueApplication } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetTeamBuilderState, provideTeamBuilder } from '../composables/useTeamBuilder';
import MetaAnalysisGrid from './MetaAnalysisGrid.vue';
import type { PokemonEntry } from '../lib/pokemonEntry';

const stats = {
  hp: 80,
  attack: 100,
  defense: 90,
  'special-attack': 100,
  'special-defense': 90,
  speed: 80
};

const pokemon = (name: string): PokemonEntry => ({
  name,
  speciesName: name,
  typeName: 'water',
  types: ['water'],
  sprite: '',
  stats,
  baseStats: stats,
  statsTotal: 540,
  abilities: [
    { name: 'torrent', is_hidden: false },
    { name: 'swift-swim', is_hidden: true }
  ],
  abilityName: 'torrent',
  abilityProfiles: { torrent: {}, 'swift-swim': {} },
  weaknesses: [],
  quadrupleWeaknesses: [],
  resistances: [],
  immunities: [],
  coverages: [],
  moveCoverages: [],
  normalizedDamageToScore: 0.5,
  normalizedDamageFromScore: 0.5
});

let app: VueApplication | undefined;
let element: HTMLElement | undefined;

afterEach(() => {
  app?.unmount();
  element?.remove();
  app = undefined;
  element = undefined;
  __resetTeamBuilderState();
});

/**
 * Mounts the grid under a parent that hands it a fresh array each recompute,
 * which is what `CustomCupBuilder` does: its filtered list is a computed, so
 * every re-rank produces a new array identity.
 */
const mountGrid = (names: string[]) => {
  const order = ref(names);
  element = document.createElement('div');
  document.body.append(element);

  const Parent = defineComponent({
    setup() {
      const list = computed(() => order.value.map((name) => pokemon(name)));
      return () => h(MetaAnalysisGrid, { pokemon: list.value, selectedTypesCount: 1 });
    }
  });

  app = createApp(Parent);
  provideTeamBuilder(app);
  app.mount(element);
  return order;
};

// The card count cannot be read directly: TransitionGroup keeps leaving cards
// in the DOM until a transition ends, and jsdom never ends one. The Show More
// button reports `total - visibleCount`, which is the state under test.
const remaining = () =>
  element?.querySelector('.show-more-btn')?.textContent?.match(/\((\d+) Left\)/)?.[1];

const roster = (count: number) => Array.from({ length: count }, (_, index) => `mon-${index}`);

describe('MetaAnalysisGrid pagination', () => {
  it('keeps the revealed page when the list is only re-ranked', async () => {
    const order = mountGrid(roster(60));
    await nextTick();
    expect(remaining()).toBe('40');

    (element!.querySelector('.show-more-btn') as HTMLButtonElement).click();
    await nextTick();
    expect(remaining()).toBe('20');

    // An ability choice re-scores one Pokemon and re-sorts the rest around it.
    // The user is still looking at the same forty cards.
    order.value = [...order.value].reverse();
    await nextTick();
    expect(remaining()).toBe('20');
  });

  it('starts a genuinely different result set at the first page', async () => {
    const order = mountGrid(roster(60));
    await nextTick();

    (element!.querySelector('.show-more-btn') as HTMLButtonElement).click();
    await nextTick();
    expect(remaining()).toBe('20');

    // A type filter change swaps which Pokemon are on the list at all.
    order.value = roster(60).map((name) => `other-${name}`);
    await nextTick();
    expect(remaining()).toBe('40');
  });
});
