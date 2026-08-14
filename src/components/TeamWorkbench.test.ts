// @vitest-environment jsdom

import { createApp, nextTick, type App as VueApplication } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetTeamBuilderState, provideTeamBuilder } from '../composables/useTeamBuilder';
import type { PokemonEntry } from '../lib/pokemonEntry';
import TeamWorkbench from './TeamWorkbench.vue';

const stats = {
  hp: 80,
  attack: 100,
  defense: 90,
  'special-attack': 100,
  'special-defense': 90,
  speed: 80
};

const pokemon = (name: string, type: string): PokemonEntry => ({
  name,
  speciesName: name,
  typeName: type,
  types: [type],
  sprite: '',
  stats,
  baseStats: stats,
  statsTotal: 540,
  abilities: [{ name: 'blaze', is_hidden: false }],
  abilityName: 'blaze',
  abilityProfiles: { blaze: {} },
  weaknesses: [],
  quadrupleWeaknesses: [],
  resistances: [],
  immunities: [],
  coverages: [],
  moveCoverages: [],
  normalizedDamageToScore: 0.5,
  normalizedDamageFromScore: 0.5
});

const scan = [
  'fire', 'water', 'grass', 'electric', 'ice', 'rock', 'dark', 'steel', 'psychic', 'flying'
].map((type, index) => pokemon(`mon-${index}`, type));

let app: VueApplication | undefined;
let element: HTMLElement | undefined;

afterEach(() => {
  app?.unmount();
  element?.remove();
  app = undefined;
  element = undefined;
  __resetTeamBuilderState();
});

const mountWorkbench = () => {
  element = document.createElement('div');
  document.body.append(element);
  app = createApp(TeamWorkbench, { allPokemon: scan, filteredPokemon: scan });
  provideTeamBuilder(app);
  app.mount(element);
  return element;
};

describe('TeamWorkbench generation alternatives', () => {
  it('shows option context and swaps when trying another roster', async () => {
    const root = mountWorkbench();
    const generationButton = root.querySelector<HTMLButtonElement>('.workbench-actions .action-btn')!;

    generationButton.click();
    await nextTick();

    expect(root.querySelector('.generation-option')?.textContent).toContain('OPTION 1/6');
    expect(root.querySelector('.generation-detail')?.textContent).toContain('Best roster found');
    expect(root.querySelector('.generation-swap')).toBeNull();

    generationButton.click();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(root.querySelector('.generation-option')?.textContent).toContain('OPTION 2/6');
    expect(root.querySelector('.generation-detail')?.textContent).toContain('Tied with best');
    expect(root.querySelector('.swap-label.out')?.textContent).toBe('OUT');
    expect(root.querySelector('.swap-label.in')?.textContent).toBe('IN');
    expect(root.querySelectorAll('.swap-names')).toHaveLength(2);
  });
});
