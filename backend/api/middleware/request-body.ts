// Owner: B (muzair110)
// The only file that reads event.body. Order: presence, media type, size, JSON parse, object check, schema.
import type { BodySchemaFile } from '../routes.js';
import type { FieldError } from './errors.js';
import { toFieldErrors } from './fields.js';
import { BODY_LIMIT_BYTES } from './limits.js';
import { BODY_VALIDATORS } from './schemas.js';
import type { ApiEvent } from './types.js';

export type BodyResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string; fields?: FieldError[] };

function mediaType(headers: unknown): string | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'content-type' && typeof value === 'string') {
      return value.split(';')[0]!.trim().toLowerCase();
    }
  }
  return undefined;
}

function base64DecodedLength(text: string): number {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return Math.floor((text.length * 3) / 4) - padding;
}

export function readBody(event: ApiEvent, schemaFile: BodySchemaFile): BodyResult {
  const raw = event.body;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, message: 'Request body is required' };
  }
  if (mediaType(event.headers) !== 'application/json') {
    return { ok: false, message: 'Content-Type must be application/json' };
  }
  let text = raw;
  if (event.isBase64Encoded === true) {
    if (base64DecodedLength(raw) > BODY_LIMIT_BYTES) {
      return { ok: false, message: 'Request body is too large' };
    }
    text = Buffer.from(raw, 'base64').toString('utf8');
  }
  if (Buffer.byteLength(text, 'utf8') > BODY_LIMIT_BYTES) {
    return { ok: false, message: 'Request body is too large' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: 'Request body is not valid JSON' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'Request body must be a JSON object' };
  }
  const validate = BODY_VALIDATORS[schemaFile];
  if (!validate(value)) {
    return { ok: false, message: 'Request body is invalid', fields: toFieldErrors(validate.errors ?? []) };
  }
  return { ok: true, value };
}
