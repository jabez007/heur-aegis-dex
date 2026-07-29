import { describe, expect, it } from 'vitest';
// Imported rather than read from disk so this stays typed under the app's
// browser-only tsconfig, which has no Node types.
import pkg from '../package.json';

/**
 * Node builtins that must be shadowed by an npm polyfill for the browser build.
 *
 * These packages are never imported by our own source, so they look like stray
 * dependencies. They are not. Vite externalizes Node builtins for the browser,
 * and an externalized module throws the moment anything touches it. Installing
 * the same-named npm package makes Node resolution find a browser-safe
 * implementation first.
 *
 * The value is the failure this prevents, so anyone tempted to delete the
 * dependency sees the consequence rather than rediscovering it in the console.
 */
const REQUIRED_BROWSER_POLYFILLS: Record<string, string> = {
  events:
    'node-cache (via pokedex-promise-v2) runs `class NodeCache extends require("events").EventEmitter` ' +
    'at module scope. Without the polyfill Vite externalizes `events`, the class extends undefined, and ' +
    'the app fails to boot with "Class extends value undefined is not a constructor or null".'
};

describe('browser polyfill dependencies', () => {
  const dependencies = pkg.dependencies as Record<string, string> | undefined;
  const devDependencies = pkg.devDependencies as Record<string, string> | undefined;

  // The unit suite runs in Node, where every builtin resolves natively, so no
  // amount of testing our own modules can catch a missing browser polyfill.
  // This asserts the packaging invariant directly instead.
  Object.entries(REQUIRED_BROWSER_POLYFILLS).forEach(([name, reason]) => {
    it(`declares "${name}" as a runtime dependency`, () => {
      expect(dependencies?.[name], `"${name}" must stay in dependencies. ${reason}`).toBeTruthy();
    });
  });

  it('keeps polyfills in dependencies rather than devDependencies', () => {
    Object.keys(REQUIRED_BROWSER_POLYFILLS).forEach((name) => {
      expect(devDependencies?.[name], `"${name}" belongs in dependencies, not devDependencies`).toBeUndefined();
    });
  });
});
