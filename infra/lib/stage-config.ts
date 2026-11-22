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
  evidenceRetentionDays: number;
  consoleOrigins: string[];
  cspApiOrigins: string[];
  cspCognitoOrigins: string[];
  cspEvidenceOrigins: string[];
  earlyClaimDays: number;
  frequencyWindowDays: number;
  frequencyMaxClaims: number;
  outlierMultiple: number;
  authLocalOrigins: string[];
  enableVerificationClient: boolean;
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

const INTEGER_RANGES = [
  ['evidenceRetentionDays', 1, 3650],
  ['earlyClaimDays', 0, 365],
  ['frequencyWindowDays', 1, 365],
  ['frequencyMaxClaims', 1, 1000],
] as const;
const MAX_CONSOLE_ORIGINS = 5;
const ORIGIN_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
/** True for `https://<host>` or `http://localhost[:port]`, with no path, query, fragment or wildcard. */
export function isValidConsoleOrigin(origin: unknown): boolean {
  if (typeof origin !== 'string') return false;
  const m = /^(https?):\/\/([^/?#@*:\s]+)(?::(\d{1,5}))?$/.exec(origin);
  if (!m) return false;
  const [, scheme, host, port] = m;
  if (host.length > 253 || !ORIGIN_HOST.test(host)) return false;
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return false;
  return scheme === 'https' ? true : host === 'localhost';
}
const MAX_AUTH_LOCAL_ORIGINS = 3;
/** True only for `http://localhost` with an optional port from 1 to 65535. */
export function isValidLocalOrigin(origin: unknown): boolean {
  if (typeof origin !== 'string') return false;
  const m = /^http:\/\/localhost(?::(\d{1,5}))?$/.exec(origin);
  if (!m) return false;
  const port = m[1];
  return port === undefined || (Number(port) >= 1 && Number(port) <= 65535);
}
const CSP_KEYS = ['cspApiOrigins', 'cspCognitoOrigins', 'cspEvidenceOrigins'] as const;
const MAX_CSP_ORIGINS = 4;
const CSP_SOURCE = /^https:\/\/(\*\.(?=[a-z0-9-]+\.[a-z0-9-]+))?([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
/** True for `https://<dns name>` with optional single leading `*.` label followed by at least two labels. */
export function isValidCspSource(source: unknown): boolean {
  if (typeof source !== 'string') return false;
  if (!CSP_SOURCE.test(source)) return false;
  const host = source.slice('https://'.length);
  const bare = host.startsWith('*.') ? host.slice(2) : host;
  if (bare.length > 253) return false;
  // A wildcard needs two further labels (checked by the lookahead); a plain host needs no minimum.
  return true;
}
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

  for (const [k, min, max] of INTEGER_RANGES) {
    const v = value[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw new ConfigError(file, k, `must be an integer from ${min} to ${max}`);
    }
  }
  const om = value.outlierMultiple;
  if (typeof om !== 'number' || !Number.isFinite(om) || om <= 0 || om > 100) {
    throw new ConfigError(file, 'outlierMultiple', 'must be a number > 0 and <= 100');
  }
  const origins = value.consoleOrigins;
  if (!Array.isArray(origins) || origins.length < 1 || origins.length > MAX_CONSOLE_ORIGINS) {
    throw new ConfigError(
      file,
      'consoleOrigins',
      `must be an array of 1 to ${MAX_CONSOLE_ORIGINS} origins`,
    );
  }
  origins.forEach((o, i) => {
    if (!isValidConsoleOrigin(o)) {
      throw new ConfigError(
        file,
        `consoleOrigins[${i}]`,
        'must be https://<host> or http://localhost[:port], with no path, query or wildcard',
      );
    }
  });
  for (const key of CSP_KEYS) {
    const list = value[key];
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_CSP_ORIGINS) {
      throw new ConfigError(
        file,
        key,
        `must be an array of 1 to ${MAX_CSP_ORIGINS} CSP sources`,
      );
    }
    list.forEach((o, i) => {
      if (!isValidCspSource(o)) {
        throw new ConfigError(
          file,
          `${key}[${i}]`,
          'must be https://<host>, optionally with one leading *. label and at least two labels after it, with no path, port or keyword',
        );
      }
    });
  }
  const local = value.authLocalOrigins;
  if (!Array.isArray(local) || local.length > MAX_AUTH_LOCAL_ORIGINS) {
    throw new ConfigError(
      file,
      'authLocalOrigins',
      `must be an array of 0 to ${MAX_AUTH_LOCAL_ORIGINS} origins`,
    );
  }
  local.forEach((o, i) => {
    if (!isValidLocalOrigin(o)) {
      throw new ConfigError(
        file,
        `authLocalOrigins[${i}]`,
        'must be http://localhost or http://localhost:<port> with a port from 1 to 65535',
      );
    }
  });
  if (typeof value.enableVerificationClient !== 'boolean') {
    throw new ConfigError(file, 'enableVerificationClient', 'must be a boolean');
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
  // Words by camelCase boundary (authToken) and by delimiters only (a_secRet, any letter case).
  const words = [
    ...keyWords(key),
    ...key.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase()),
  ];
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
