import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verify: vi.fn()
}));

vi.mock('./pokemonCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pokemonCatalog')>();
  return { ...actual, parseAndVerifyPokemonCatalog: mocks.verify };
});

import catalogData from '../../data/pokemon-catalog.v1.json';
import { __resetPokemonCatalogLoader, loadPokemonCatalog } from './pokemonCatalogLoader';

describe('Pokemon catalog loader', () => {
  beforeEach(() => {
    __resetPokemonCatalogLoader();
    mocks.verify.mockReset();
    mocks.verify.mockResolvedValue(catalogData);
  });

  it('shares one import and verification across concurrent callers', async () => {
    const first = loadPokemonCatalog();
    const second = loadPokemonCatalog();

    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toEqual([catalogData, catalogData]);
    expect(mocks.verify).toHaveBeenCalledOnce();
  });

  it('evicts a rejected load so a later scan can retry', async () => {
    mocks.verify.mockRejectedValueOnce(new Error('invalid catalog'));
    await expect(loadPokemonCatalog()).rejects.toThrow('invalid catalog');

    await expect(loadPokemonCatalog()).resolves.toBe(catalogData);
    expect(mocks.verify).toHaveBeenCalledTimes(2);
  });
});
