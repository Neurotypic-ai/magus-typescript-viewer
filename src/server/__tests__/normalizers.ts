const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const ISO_TIMESTAMP_PATTERN =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;

const TEMP_PATH_PATTERN = /\/var\/folders\/[^\s"']+/g;

function normalizeString(value: string): string {
  return value
    .replace(UUID_PATTERN, '<uuid>')
    .replace(ISO_TIMESTAMP_PATTERN, '<timestamp>')
    .replace(TEMP_PATH_PATTERN, '<temp-path>')
    .replace(/\\/g, '/');
}

export function normalizeForGolden<T>(input: T): T {
  if (typeof input === 'string') {
    return normalizeString(input) as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => normalizeForGolden(item)) as T;
  }

  if (!input || typeof input !== 'object') {
    return input;
  }

  const normalizedEntries = Object.entries(input as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, normalizeForGolden(value)]);

  return Object.fromEntries(normalizedEntries) as T;
}
