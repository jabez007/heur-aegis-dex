import { describe, expect, it } from 'vitest';
// Imported rather than read from disk so this stays typed under the app's
// browser-only tsconfig, which has no Node types.
import pkg from '../package.json';

describe('browser runtime dependencies', () => {
  const dependencies = pkg.dependencies as Record<string, string> | undefined;
  const devDependencies = pkg.devDependencies as Record<string, string> | undefined;

  it('keeps live PokeAPI acquisition out of production dependencies', () => {
    expect(dependencies?.['pokedex-promise-v2']).toBeUndefined();
    expect(devDependencies?.['pokedex-promise-v2']).toBeTruthy();
  });

  it('does not ship the obsolete EventEmitter polyfill', () => {
    expect(dependencies?.events).toBeUndefined();
    expect(devDependencies?.events).toBeUndefined();
  });
});
