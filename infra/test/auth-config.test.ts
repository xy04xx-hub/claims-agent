import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigError, loadStageConfig, scanForSecrets } from '../lib/stage-config.js';

// Validates: Requirements 9.2, 9.3, 9.4, 9.5
const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CONFIG_DIR = resolve(__dirname, '../config');
const STAGES = ['default', 'demo', 'dev-a', 'dev-b'] as const;
const EXPECTED: Record<(typeof STAGES)[number], { origins: string[]; verification: boolean }> = {
  default: { origins: ['http://localhost:5173'], verification: false },
  demo: { origins: [], verification: false },
  'dev-a': { origins: ['http://localhost:5173'], verification: false },
  'dev-b': { origins: ['http://localhost:5173'], verification: true },
};
const read = (stage: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(CONFIG_DIR, `${stage}.json`), 'utf8'));

function loadError(stage: string, cfg: Record<string, unknown>): ConfigError {
  const dir = mkdtempSync(join(tmpdir(), 'auth-config-'));
  tmpDirs.push(dir);
  writeFileSync(join(dir, `${stage}.json`), JSON.stringify(cfg));
  try {
    loadStageConfig(stage, dir);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return e as ConfigError;
  }
  throw new Error('expected ConfigError');
}

describe.each(STAGES)('%s.json auth keys', (stage) => {
  it('loads with the expected authLocalOrigins and enableVerificationClient', () => {
    const cfg = loadStageConfig(stage, CONFIG_DIR);
    expect(cfg.authLocalOrigins).toEqual(EXPECTED[stage].origins);
    expect(cfg.enableVerificationClient).toBe(EXPECTED[stage].verification);
  });

  it('passes the secret scan and holds no 12-digit number', () => {
    const raw = readFileSync(join(CONFIG_DIR, `${stage}.json`), 'utf8');
    expect(() => scanForSecrets(JSON.parse(raw), `${stage}.json`)).not.toThrow();
    expect(raw).not.toMatch(/(?<!\d)\d{12}(?!\d)/);
  });
});

describe('auth key validation errors', () => {
  it('a missing enableVerificationClient names the file and key', () => {
    const cfg = read('default');
    delete cfg.enableVerificationClient;
    const err = loadError('dev-m', cfg);
    expect(err.file).toBe('dev-m.json');
    expect(err.key).toBe('enableVerificationClient');
    expect(err.message).toContain('dev-m.json');
    expect(err.message).toContain('enableVerificationClient');
  });

  it('authLocalOrigins set to a string names the file and key', () => {
    const err = loadError('dev-s', { ...read('default'), authLocalOrigins: 'x' });
    expect(err.file).toBe('dev-s.json');
    expect(err.key).toBe('authLocalOrigins');
  });

  it('an https entry in authLocalOrigins names the file and entry index', () => {
    const err = loadError('dev-h', { ...read('default'), authLocalOrigins: ['https://example.com'] });
    expect(err.file).toBe('dev-h.json');
    expect(err.key).toBe('authLocalOrigins[0]');
    expect(err.message).toContain('dev-h.json');
  });
});
