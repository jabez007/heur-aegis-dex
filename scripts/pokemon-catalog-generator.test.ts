import { describe, expect, it, vi } from 'vitest';
import {
  canonicalJson,
  fetchJsonWithRetry,
  mapBounded,
  readArray,
  readBoolean,
  readPositiveInteger,
  readRecord,
  readResourceIndex,
  readString
} from './pokemon-catalog-generator';

describe('Pokemon catalog generator helpers', () => {
  it('canonicalizes object keys and sets while preserving array order', () => {
    const first = { z: new Set(['water', 'fire']), a: [2, 1] };
    const second = { a: [2, 1], z: new Set(['fire', 'water']) };

    expect(canonicalJson(first)).toBe('{"a":[2,1],"z":["fire","water"]}');
    expect(canonicalJson(second)).toBe(canonicalJson(first));
  });

  it('preserves result order while bounding concurrency', async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await mapBounded([4, 3, 2, 1], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 2;
    });

    expect(results).toEqual([8, 6, 4, 2]);
    expect(maximumActive).toBe(2);
  });

  it('retries network errors as well as unsuccessful responses', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('socket reset'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    await expect(fetchJsonWithRetry('https://example.test/static.json', {
      attempts: 3,
      retryDelayMs: 0,
      fetchImpl
    })).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('fails loudly for missing or malformed required fields', () => {
    const record = readRecord({ name: '', entries: null, enabled: 1, id: 0 }, 'resource');

    expect(() => readString(record, 'name', 'resource')).toThrow('resource.name');
    expect(() => readArray(record, 'entries', 'resource')).toThrow('resource.entries');
    expect(() => readBoolean(record, 'enabled', 'resource')).toThrow('resource.enabled');
    expect(() => readPositiveInteger(record, 'id', 'resource')).toThrow('resource.id');
    expect(() => readRecord(null, 'resource')).toThrow('resource must be an object');
  });

  it('requires authoritative indexes to be complete and unpaginated', () => {
    const index = {
      count: 2,
      next: null,
      previous: null,
      results: [
        { name: 'ivysaur', url: '/api/v2/pokemon/2/' },
        { name: 'bulbasaur', url: '/api/v2/pokemon/1/' }
      ]
    };

    expect(readResourceIndex(index, 'pokemon')).toEqual([
      { id: 1, name: 'bulbasaur' },
      { id: 2, name: 'ivysaur' }
    ]);
    expect(() => readResourceIndex({ ...index, count: 3 }, 'pokemon')).toThrow('count does not match');
    expect(() => readResourceIndex({ ...index, next: '/page/2' }, 'pokemon')).toThrow('unpaginated');
  });
});
