// Owner: B (muzair110)
// Maps Ajv errors to field errors that carry limits from the schema, never submitted values.
import type { ErrorObject } from 'ajv';
import type { FieldError } from './errors.js';
import { MAX_FIELD_ERRORS, MAX_FIELD_MESSAGE_LENGTH } from './limits.js';

const MAX_PATH_LENGTH = 200;
const MAX_NAME_LENGTH = 60;

function cut(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function safeName(name: unknown): string {
  return cut(String(name), MAX_NAME_LENGTH).replace(/[^A-Za-z0-9_$.-]/g, '_');
}

function limitOf(error: ErrorObject): string {
  const params = error.params as { limit?: unknown; multipleOf?: unknown };
  const limit = params.limit ?? params.multipleOf;
  return typeof limit === 'number' || typeof limit === 'string' ? String(limit) : '?';
}

function typeOf(error: ErrorObject): string {
  const type = (error.params as { type?: unknown }).type;
  const text = Array.isArray(type) ? type.join(' or ') : typeof type === 'string' ? type : 'the declared type';
  return safeName(text.replace(/ /g, '_')).replace(/_or_/g, ' or ');
}

function messageFor(error: ErrorObject): string {
  switch (error.keyword) {
    case 'maxLength':
      return `must be at most ${limitOf(error)} characters`;
    case 'minLength':
      return `must be at least ${limitOf(error)} characters`;
    case 'maxItems':
      return `must have at most ${limitOf(error)} items`;
    case 'minItems':
      return `must have at least ${limitOf(error)} items`;
    case 'maximum':
      return `must be at most ${limitOf(error)}`;
    case 'minimum':
      return `must be at least ${limitOf(error)}`;
    case 'exclusiveMinimum':
      return `must be greater than ${limitOf(error)}`;
    case 'enum':
      return 'must be one of the allowed values';
    case 'format':
    case 'pattern':
      return 'has an invalid format';
    case 'type':
      return `must be of type ${typeOf(error)}`;
    case 'uniqueItems':
      return 'must be unique';
    case 'multipleOf':
      return `must be a multiple of ${limitOf(error)}`;
    default:
      return 'is invalid';
  }
}

function toEntry(error: ErrorObject): FieldError {
  let path: string;
  let message: string;
  if (error.keyword === 'additionalProperties') {
    const name = (error.params as { additionalProperty?: unknown }).additionalProperty;
    path = `${error.instancePath}/${safeName(name)}`;
    message = 'unexpected property';
  } else if (error.keyword === 'required') {
    const name = (error.params as { missingProperty?: unknown }).missingProperty;
    path = `${error.instancePath}/${safeName(name)}`;
    message = 'is required';
  } else {
    path = error.instancePath === '' ? '/' : error.instancePath;
    message = messageFor(error);
  }
  return { path: cut(path, MAX_PATH_LENGTH), message: cut(message, MAX_FIELD_MESSAGE_LENGTH) };
}

export function toFieldErrors(errors: readonly ErrorObject[]): FieldError[] {
  const seen = new Set<string>();
  const out: FieldError[] = [];
  for (const error of errors) {
    const entry = toEntry(error);
    const key = `${entry.path}\u0000${entry.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= MAX_FIELD_ERRORS) break;
  }
  return out;
}
