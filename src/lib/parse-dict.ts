/**
 * Parses Python-dict-style strings (e.g. "{'gpt-5': 590, 'Canvas': 11}")
 * into a JS Record. Returns empty object on any parse failure.
 */
export function parsePythonDict(raw: string): Record<string, number> {
  if (!raw) return {};
  try {
    const json = raw.replace(/'/g, '"');
    return JSON.parse(json) as Record<string, number>;
  } catch {
    return {};
  }
}
