import { canonicalJson } from '../src/lib/canonicalJson.ts';

export { canonicalJson };

export type JsonRecord = Record<string, unknown>;
export interface IndexedResource {
  readonly id: number;
  readonly name: string;
}

export function readRecord(value: unknown, path: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as JsonRecord;
}

export function readArray(record: JsonRecord, key: string, path: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${path}.${key} must be an array`);
  return value;
}

export function readString(record: JsonRecord, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path}.${key} must be a non-empty string`);
  return value;
}

export function readBoolean(record: JsonRecord, key: string, path: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw new Error(`${path}.${key} must be a boolean`);
  return value;
}

export function readPositiveInteger(record: JsonRecord, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path}.${key} must be a positive integer`);
  }
  return value;
}

export function readResourceIndex(value: unknown, endpoint: string): IndexedResource[] {
  const path = `${endpoint}/index`;
  const index = readRecord(value, path);
  const count = readPositiveInteger(index, 'count', path);
  if (index.next !== null || index.previous !== null) throw new Error(`${path} must be an unpaginated complete index`);
  const results = readArray(index, 'results', path).map((entry, position) => {
    const itemPath = `${path}.results[${position}]`;
    const item = readRecord(entry, itemPath);
    const name = readString(item, 'name', itemPath);
    const url = readString(item, 'url', itemPath);
    const match = url.match(new RegExp(`^(?:https://pokeapi\\.co)?/api/v2/${endpoint}/(\\d+)/$`));
    if (!match) throw new Error(`${itemPath}.url is not a ${endpoint} resource URL`);
    return { id: Number(match[1]), name };
  });
  if (results.length !== count) throw new Error(`${path} count does not match its results`);
  if (new Set(results.map((entry) => entry.id)).size !== results.length ||
    new Set(results.map((entry) => entry.name)).size !== results.length) {
    throw new Error(`${path} contains duplicate ids or names`);
  }
  return results.sort((a, b) => a.id - b.id);
}

export async function mapBounded<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<U>
): Promise<U[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer');
  const results = new Array<U>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

interface FetchJsonOptions {
  attempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function fetchJsonWithRetry(url: string, options: FetchJsonOptions = {}): Promise<unknown> {
  const attempts = options.attempts ?? 4;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('attempts must be a positive integer');

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const body = await response.text();
      try {
        return JSON.parse(body) as unknown;
      } catch (error) {
        throw new Error(`Malformed JSON from ${url}`, { cause: error });
      }
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(retryDelayMs * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Failed to fetch ${url} after ${attempts} attempts`, { cause: lastError });
}
