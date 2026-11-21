import * as fs from 'node:fs';
import * as path from 'node:path';

export type RemovalPolicyName = 'DESTROY' | 'RETAIN' | 'SNAPSHOT';

export interface StageConfig {
  autoApproveCaps: {
    phoneAccidentalDamage: number;
    phoneTheft: number;
    phoneLoss: number;
    carWindscreenOrCosmetic: number;
    carSevere: number;
  };
  bedrockModelId: string;
  maxTokens: number;
  maxEvidenceImageBytes: number;
  maxUploadBytes: number;
  maxEvidenceFilesPerClaim: number;
  maxDescriptionLength: number;
  jobTicketTtlSeconds: number;
  workerTimeoutSeconds: number;
  sqsMaxReceiveCount: number;
  removalPolicy?: RemovalPolicyName;
}

const REMOVAL_POLICIES: readonly RemovalPolicyName[] = ['DESTROY', 'RETAIN', 'SNAPSHOT'];
const CAP_KEYS = [
  'phoneAccidentalDamage',
  'phoneTheft',
  'phoneLoss',
  'carWindscreenOrCosmetic',
  'carSevere',
] as const;
const POSITIVE_KEYS = [
  'maxTokens',
  'maxEvidenceImageBytes',
  'maxUploadBytes',
  'maxEvidenceFilesPerClaim',
  'maxDescriptionLength',
  'jobTicketTtlSeconds',
  'workerTimeoutSeconds',
  'sqsMaxReceiveCount',
] as const;

/** Error that names the config file and the offending key (or parse position). */
export class ConfigError extends Error {
  constructor(
    public readonly file: string,
    public readonly key: string,
    detail: string,
  ) {
    super(`${file}: ${key}: ${detail}`);
    this.name = 'ConfigError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateStageConfig(value: unknown, file: string): StageConfig {
  if (!isRecord(value)) {
    throw new ConfigError(file, '(root)', 'config must be a JSON object');
  }

  const caps = value.autoApproveCaps;
  if (!isRecord(caps)) {
    throw new ConfigError(file, 'autoApproveCaps', 'required object is missing or not an object');
  }
  for (const k of CAP_KEYS) {
    const v = caps[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new ConfigError(file, `autoApproveCaps.${k}`, 'must be a finite number >= 0');
    }
  }

  if (typeof value.bedrockModelId !== 'string' || value.bedrockModelId.trim() === '') {
    throw new ConfigError(file, 'bedrockModelId', 'must be a non-empty string');
  }

  for (const k of POSITIVE_KEYS) {
    const v = value[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new ConfigError(file, k, 'must be a finite number > 0');
    }
  }

  const rp = value.removalPolicy;
  if (rp !== undefined && !REMOVAL_POLICIES.includes(rp as RemovalPolicyName)) {
    throw new ConfigError(
      file,
      'removalPolicy',
      `must be one of ${REMOVAL_POLICIES.join(', ')}`,
    );
  }

  return value as unknown as StageConfig;
}

function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function secretKeyProblem(key: string): boolean {
  const words = keyWords(key);
  if (words.some((w) => w === 'secret' || w === 'password' || w === 'token')) return true;
  return key.replace(/[^A-Za-z0-9]/g, '').toLowerCase().includes('apikey');
}

const ACCOUNT_ID = /(?<!\d)\d{12}(?!\d)/;

export function scanForSecrets(value: unknown, file: string): void {
  const walk = (v: unknown, keyPath: string): void => {
    if (typeof v === 'string') {
      if (ACCOUNT_ID.test(v)) {
        throw new ConfigError(file, keyPath || '(root)', 'value looks like a 12-digit AWS account ID');
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${keyPath}[${i}]`));
      return;
    }
    if (isRecord(v)) {
      for (const [k, child] of Object.entries(v)) {
        const p = keyPath ? `${keyPath}.${k}` : k;
        if (secretKeyProblem(k)) {
          throw new ConfigError(file, p, 'key name looks like a secret; config must not hold secrets');
        }
        walk(child, p);
      }
    }
  };
  walk(value, '');
}

export function loadStageConfig(
  stage: string,
  dir: string,
  log: (m: string) => void = () => undefined,
): StageConfig {
  let file = `${stage}.json`;
  if (!fs.existsSync(path.join(dir, file))) {
    file = 'default.json';
    log(`Config for stage "${stage}": using ${file}`);
  }
  const full = path.join(dir, file);

  let raw: string;
  try {
    raw = fs.readFileSync(full, 'utf8');
  } catch (e) {
    throw new ConfigError(file, '(file)', `cannot read ${full}: ${(e as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(file, '(parse)', `invalid JSON: ${(e as Error).message}`);
  }

  scanForSecrets(parsed, file);
  return validateStageConfig(parsed, file);
}

export function resolveRemovalPolicy(stage: string, config: StageConfig): RemovalPolicyName {
  if (config.removalPolicy) return config.removalPolicy;
  return stage === 'demo' ? 'RETAIN' : 'DESTROY';
}
