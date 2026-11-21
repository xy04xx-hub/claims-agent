import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigError, loadStageConfig } from '../lib/stage-config.js';
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6

const CONFIG_DIR = resolve(__dirname, '../config');
const defaultJson = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(CONFIG_DIR, 'default.json'), 'utf8'));

function tempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'stage-config-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function catchError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return e as ConfigError;
  }
  throw new Error('expected ConfigError');
}

describe('loadStageConfig fallback', () => {
  it('falls back to default.json and logs one line naming stage and file', () => {
    const dir = tempDir({ 'default.json': JSON.stringify(defaultJson()) });
    const lines: string[] = [];
    const cfg = loadStageConfig('dev-zzz', dir, (m) => lines.push(m));
    expect(cfg.bedrockModelId).toBe('global.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('dev-zzz');
    expect(lines[0]).toContain('default.json');
  });

  it('uses the stage file without logging when it exists', () => {
    const dir = tempDir({ 'dev-x.json': JSON.stringify(defaultJson()) });
    const lines: string[] = [];
    loadStageConfig('dev-x', dir, (m) => lines.push(m));
    expect(lines).toHaveLength(0);
  });
});

describe('shipped config files', () => {
  it('default.json holds the architecture values', () => {
    const cfg = loadStageConfig('default', CONFIG_DIR);
    expect(cfg.autoApproveCaps).toEqual({
      phoneAccidentalDamage: 500,
      phoneTheft: 300,
      phoneLoss: 0,
      carWindscreenOrCosmetic: 250,
      carSevere: 0,
    });
    expect(cfg.bedrockModelId).toBe('global.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(cfg.maxEvidenceImageBytes).toBe(3670016);
    expect(cfg.maxUploadBytes).toBe(5242880);
    expect(cfg.maxEvidenceFilesPerClaim).toBe(6);
    expect(cfg.maxDescriptionLength).toBe(1000);
    expect(cfg.jobTicketTtlSeconds).toBe(60);
    expect(cfg.workerTimeoutSeconds).toBe(60);
    expect(cfg.sqsMaxReceiveCount).toBe(3);
    expect(cfg.maxTokens).toBeGreaterThan(0);
  });

  const files = readdirSync(CONFIG_DIR).filter((f) => f.endsWith('.json'));

  it('ships default, demo, dev-a and dev-b', () => {
    expect(files.sort()).toEqual(['default.json', 'demo.json', 'dev-a.json', 'dev-b.json']);
  });

  it.each(['default', 'demo', 'dev-a', 'dev-b'])('%s.json loads', (stage) => {
    const lines: string[] = [];
    expect(() => loadStageConfig(stage, CONFIG_DIR, (m) => lines.push(m))).not.toThrow();
    expect(lines).toHaveLength(0);
  });

  it.each(['default', 'demo', 'dev-a', 'dev-b'])('%s.json has no secret-like key', (stage) => {
    const keys: string[] = [];
    const walk = (v: unknown): void => {
      if (v && typeof v === 'object') {
        for (const [k, c] of Object.entries(v)) {
          keys.push(k);
          walk(c);
        }
      }
    };
    walk(JSON.parse(readFileSync(join(CONFIG_DIR, `${stage}.json`), 'utf8')));
    for (const k of keys) expect(k).not.toMatch(/secret|password|token(?!s)|api[-_]?key/i);
  });
});

describe('loadStageConfig errors', () => {
  it('reports invalid JSON with the file and a parse position', () => {
    const dir = tempDir({ 'bad.json': '{ "maxTokens": 1,, }' });
    const err = catchError(() => loadStageConfig('bad', dir));
    expect(err.file).toBe('bad.json');
    expect(err.key).toBe('(parse)');
    expect(err.message).toContain('bad.json');
    expect(err.message).toMatch(/JSON|position|token/i);
  });

  it('reports a missing key by file and key', () => {
    const cfg = defaultJson();
    delete cfg.sqsMaxReceiveCount;
    const dir = tempDir({ 'dev-m.json': JSON.stringify(cfg) });
    const err = catchError(() => loadStageConfig('dev-m', dir));
    expect(err.file).toBe('dev-m.json');
    expect(err.key).toBe('sqsMaxReceiveCount');
    expect(err.message).toContain('dev-m.json');
    expect(err.message).toContain('sqsMaxReceiveCount');
  });

  it('reports a wrong type by file and key', () => {
    const cfg = { ...defaultJson(), maxUploadBytes: '5242880' };
    const dir = tempDir({ 'dev-t.json': JSON.stringify(cfg) });
    const err = catchError(() => loadStageConfig('dev-t', dir));
    expect(err.file).toBe('dev-t.json');
    expect(err.key).toBe('maxUploadBytes');
  });

  it('reports a wrong type in a nested cap with the dotted key', () => {
    const cfg = defaultJson() as { autoApproveCaps: Record<string, unknown> };
    cfg.autoApproveCaps.phoneTheft = 'x';
    const dir = tempDir({ 'dev-n.json': JSON.stringify(cfg) });
    const err = catchError(() => loadStageConfig('dev-n', dir));
    expect(err.key).toBe('autoApproveCaps.phoneTheft');
  });
});
