import { nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useGuidedPartnerSession } from './useGuidedPartnerSession';
import type { PokemonEntry } from '../lib/pokemonEntry';

const stats = {
  hp: 80,
  attack: 80,
  defense: 80,
  'special-attack': 80,
  'special-defense': 80,
  speed: 80
};

const pokemon: PokemonEntry = {
  name: 'favorite',
  speciesName: 'favorite',
  typeName: 'water',
  types: ['water'],
  sprite: '',
  stats,
  baseStats: stats,
  statsTotal: 480,
  abilities: [{ name: 'torrent', is_hidden: false }],
  abilityName: 'torrent',
  abilityProfiles: { torrent: {} },
  weaknesses: ['electric'],
  quadrupleWeaknesses: [],
  resistances: ['fire'],
  immunities: [],
  coverages: ['fire'],
  moveCoverages: ['fire'],
  normalizedDamageToScore: 0.5,
  normalizedDamageFromScore: 0.5
};

describe('useGuidedPartnerSession', () => {
  it('drops setup choices when the legal scan pool changes', async () => {
    const pool = ref<PokemonEntry[]>([pokemon]);
    const session = useGuidedPartnerSession(pool);
    session.addFavorite(pokemon);

    pool.value = [];
    await nextTick();

    expect(session.favorites.value).toEqual([]);
    expect(session.message.value).toBe('The scan changed, so the guided session was restarted.');
  });
});
