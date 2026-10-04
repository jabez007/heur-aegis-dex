import { parseAndVerifyPokemonCatalog, type PokemonCatalogV1 } from './pokemonCatalog';

let catalogPromise: Promise<PokemonCatalogV1> | undefined;

/** Lazily loads and verifies the committed catalog, sharing concurrent work. */
export function loadPokemonCatalog(): Promise<PokemonCatalogV1> {
  if (catalogPromise) return catalogPromise;

  const pending = import('../../data/pokemon-catalog.v1.json')
    .then((module) => parseAndVerifyPokemonCatalog(module.default))
    .catch((error) => {
      if (catalogPromise === pending) catalogPromise = undefined;
      throw error;
    });
  catalogPromise = pending;
  return pending;
}

/** Clears the memoized load. Intended for tests. */
export function __resetPokemonCatalogLoader(): void {
  catalogPromise = undefined;
}
