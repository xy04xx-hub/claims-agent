import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigError, loadStageConfig, scanForSecrets } from '../lib/stage-config.js';
// Validates: Requirements 7.2, 7.3, 7.4, 7.5
const CONFIG_DIR = resolve(__dirname, '../config');
const STAGES = ['default', 'demo', 'dev-a', 'dev-b'] as const;
const read = (stage: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(CONFIG_DIR, `${stage}.json`), 'utf8'));

function loadError(stage: string, cfg: Record<string, unknown>): ConfigError {
  const dir = mkdtempSync(join(tmpdir(), 'foundation-config-'));
  writeFileSync(join(dir, `${stage}.json`), JSON.stringify(cfg));
  try {
    loadStageConfig(stage, dir);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return e as ConfigError;
  }
  throw new Error('expected ConfigError');
}

describe.each(STAGES)('%s.json foundation keys', (stage) => {
  it('loads with the six new keys at their expected values', () => {
    const cfg = loadStageConfig(stage, CONFIG_DIR);
    expect(cfg.evidenceRetentionDays).toBe(90);
    expect(cfg.consoleOrigins).toEqual(['http://localhost:5173']);
    expect(cfg.earlyClaimDays).toBe(14);
    expect(cfg.frequencyWindowDays).toBe(30);
    expect(cfg.frequencyMaxClaims).toBe(3);
    expect(cfg.outlierMultiple).toBe(2);
  });

  it('passes the secret scan and holds no 12-digit number', () => {
    const raw = readFileSync(join(CONFIG_DIR, `${stage}.json`), 'utf8');
    expect(() => scanForSecrets(JSON.parse(raw), `${stage}.json`)).not.toThrow();
    expect(raw).not.toMatch(/(?<!\d)\d{12}(?!\d)/);
  });
});

describe('foundation key validation errors', () => {
  const NEW_KEYS = [
    'evidenceRetentionDays',
    'consoleOrigins',
    'earlyClaimDays',
    'frequencyWindowDays',
    'frequencyMaxClaims',
    'outlierMultiple',
  ];

  it.each(NEW_KEYS)('a missing %s names the file and key', (key) => {
    const cfg = read('default');
    delete cfg[key];
    const err = loadError('dev-m', cfg);
    expect(err.file).toBe('dev-m.json');
    expect(err.key).toBe(key);
    expect(err.message).toContain('dev-m.json');
    expect(err.message).toContain(key);
  });

  it('rejects an empty consoleOrigins', () => {
    const err = loadError('dev-e', { ...read('default'), consoleOrigins: [] });
    expect(err.file).toBe('dev-e.json');
    expect(err.key).toBe('consoleOrigins');
  });

  it('rejects an origin with a trailing slash and names its index', () => {
    const err = loadError('dev-o', {
      ...read('default'),
      consoleOrigins: ['http://localhost:5173', 'https://example.com/'],
    });
    expect(err.file).toBe('dev-o.json');
    expect(err.key).toBe('consoleOrigins[1]');
  });

  it('rejects evidenceRetentionDays of 0', () => {
    const err = loadError('dev-r', { ...read('default'), evidenceRetentionDays: 0 });
    expect(err.file).toBe('dev-r.json');
    expect(err.key).toBe('evidenceRetentionDays');
  });
});
