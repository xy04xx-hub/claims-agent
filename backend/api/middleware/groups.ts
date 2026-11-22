// Owner: B (muzair110)
// Total parser for the `cognito:groups` claim. Never throws.

function stripQuotes(token: string): string {
  return token.replace(/^["']+|["']+$/g, '');
}

function fromArray(items: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed !== '') out.push(trimmed);
  }
  return out;
}

function fromBracketed(inner: string): string[] {
  return inner
    .split(/[\s,]+/)
    .map((token) => stripQuotes(token.trim()))
    .filter((token) => token !== '');
}

export function parseGroups(value: unknown): string[] {
  try {
    if (Array.isArray(value)) return fromArray(value);
    if (typeof value !== 'string') return [];
    const text = value.trim();
    if (text === '') return [];
    if (text.startsWith('[') && text.endsWith(']')) {
      const inner = text.slice(1, -1).trim();
      if (inner.startsWith('"')) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (Array.isArray(parsed)) return fromArray(parsed);
        } catch {
          // fall back to the bracket form
        }
      }
      return fromBracketed(inner);
    }
    return [text];
  } catch {
    return [];
  }
}
