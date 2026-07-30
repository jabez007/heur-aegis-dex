type JsonRecord = Record<string, unknown>;

/** Serializes JSON-compatible data with recursively sorted object keys. */
export function canonicalJson(value: unknown): string {
  if (value instanceof Set) return canonicalJson([...value].sort());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as JsonRecord;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Cannot canonicalize undefined');
  return serialized;
}
