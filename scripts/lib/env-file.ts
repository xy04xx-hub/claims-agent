// Owner: B (muzair110). Pure helpers for the frontend/.env.<stage> file written by `npm run outputs`.
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One `NAME=value` per line, each newline-terminated. Empty map gives an empty string. */
export function formatEnvFile(outputs: Record<string, string>): string {
  let text = '';
  for (const [name, value] of Object.entries(outputs)) {
    if (!NAME_PATTERN.test(name)) {
      throw new Error(`Invalid env variable name: "${name}". Use [A-Za-z_][A-Za-z0-9_]*.`);
    }
    if (/[\r\n]/.test(value)) {
      throw new Error(`Value for "${name}" contains a newline, which is not allowed in an env file.`);
    }
    text += `${name}=${value}\n`;
  }
  return text;
}

/** Inverse of formatEnvFile. Splits each line at the first `=`. */
export function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const index = line.indexOf('=');
    if (index < 0) {
      throw new Error(`Invalid env file line (no "="): "${line}"`);
    }
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}
