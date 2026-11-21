import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigError, loadStageConfig, scanForSecrets } from '../lib/stage-config.js';

const tmpDirs: string[] = [];
const trackTmp = (dir: string): string => {
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
// Validates: Requirements 6.2, 6.3, 6.4, 6.6
const CONFIG_DIR = resolve(__dirname, '../config');
const STAGES = ['default', 'demo', 'dev-a', 'dev-b'] as const;
const CSP_KEYS = ['cspApiOrigins', 'cspCognitoOrigins', 'cspEvidenceOrigins'] as const;
const read = (stage: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(CONFIG_DIR, `${stage}.json`), 'utf8'));

function loadError(stage: string, cfg: Record<string, unknown>): ConfigError {
  const dir = trackTmp(mkdtempSync(join(tmpdir(), 'web-config-')));
  writeFileSync(join(dir, `${stage}.json`), JSON.stringify(cfg));
  try {
    loadStageConfig(stage, dir);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return e as ConfigError;
  }
  throw new Error('expected ConfigError');
}

describe.each(STAGES)('%s.json web CSP keys', (stage) => {
  it('loads with the three CSP keys at their expected values', () => {
    const cfg = loadStageConfig(stage, CONFIG_DIR);
    expect(cfg.cspApiOrigins).toEqual(['https://*.execute-api.us-east-1.amazonaws.com']);
    expect(cfg.cspCognitoOrigins).toEqual([
      'https://cognito-idp.us-east-1.amazonaws.com',
      'https://*.amazoncognito.com',
    ]);
    expect(cfg.cspEvidenceOrigins).toEqual(['https://*.s3.us-east-1.amazonaws.com']);
  });

  it('passes the secret scan and holds no 12-digit number', () => {
    const raw = readFileSync(join(CONFIG_DIR, `${stage}.json`), 'utf8');
    expect(() => scanForSecrets(JSON.parse(raw), `${stage}.json`)).not.toThrow();
    expect(raw).not.toMatch(/(?<!\d)\d{12}(?!\d)/);
  });
});

describe('web CSP key validation errors', () => {
  it.each(CSP_KEYS)('a missing %s names the file and key', (key) => {
    const cfg = read('default');
    delete cfg[key];
    const err = loadError('dev-m', cfg);
    expect(err.file).toBe('dev-m.json');
    expect(err.key).toBe(key);
    expect(err.message).toContain('dev-m.json');
    expect(err.message).toContain(key);
  });

  it.each(CSP_KEYS)('an empty %s names the file and key', (key) => {
    const err = loadError('dev-e', { ...read('default'), [key]: [] });
    expect(err.file).toBe('dev-e.json');
    expect(err.key).toBe(key);
  });

  it.each(CSP_KEYS)('five entries in %s names the file and key', (key) => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((l) => `https://${l}.example.com`);
    const err = loadError('dev-f', { ...read('default'), [key]: five });
    expect(err.file).toBe('dev-f.json');
    expect(err.key).toBe(key);
  });

  it.each([
    ['http://example.com'],
    ['https://example.com/'],
    ['https://*'],
  ])('rejects the entry %s and names its index', (bad) => {
    const err = loadError('dev-b2', {
      ...read('default'),
      cspApiOrigins: ['https://api.example.com', bad],
    });
    expect(err.file).toBe('dev-b2.json');
    expect(err.key).toBe('cspApiOrigins[1]');
    expect(err.message).toContain('dev-b2.json');
  });
});
