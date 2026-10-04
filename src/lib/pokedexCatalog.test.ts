import { describe, expect, it } from 'vitest';
import { getBaseTypes, getDualTypes, getResistantTypes } from './pokedex';
import { isResistantTypeResultList } from './pokedexTypes';

describe('catalog-backed public Pokedex facade', () => {
  it('loads base and dual types from the committed catalog', async () => {
    const baseTypes = await getBaseTypes();
    const dualTypes = await getDualTypes(18, baseTypes);

    expect(baseTypes).toHaveLength(18);
    expect(dualTypes).toHaveLength(153);
  });

  it('returns complete cache-compatible scan results without live acquisition', async () => {
    const results = await getResistantTypes({
      typeFilters: {
        maxDamageFromScore: false,
        allowQuadrupleDamage: true,
        limitQuadrupleDamage: false
      },
      statsFilters: { minimumAttacks: 1, minimumBulk: 1 }
    });

    expect(results).toHaveLength(171);
    expect(isResistantTypeResultList(results)).toBe(true);
  });

  it('rejects unknown regulations through the unchanged public error', async () => {
    await expect(getResistantTypes({
      pokemonFilters: { regulation: 'M-Z' }
    })).rejects.toThrow('Unknown regulation: M-Z');
  });
});
