// Owner: B (muzair110)
// Feature: b-t08-api-stack. Cold start: schemas compile once at module load, a handled request does no
// file read and no recompile, and both entry points bundle with esbuild as the Lambda build does.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from './routes.js';
import { JSON_HEADERS, makeEvent, validBodyFor, validClaims, validPathParametersFor } from './test/helpers.js';

const API_DIR = dirname(fileURLToPath(import.meta.url));
const ENTRIES = [
  { name: 'api-customer', group: 'Customer' as const, routeKey: 'POST /claims' },
  { name: 'api-adjuster', group: 'Adjuster' as const, routeKey: 'GET /queue' },
];
const BODY_SCHEMA_COUNT = 3;
// A handler with Ajv, Powertools and three schemas bundles to well under this. A jump past it means
// something large (an SDK, a CDK library) was pulled in.
const BUNDLE_MAX_BYTES = 1_500_000;

type Handler = (event: unknown) => Promise<{ statusCode: number }>;
type EntryModule = { handler?: Handler };

// Literal paths so Vite can resolve them.
const LOADERS: Record<string, () => Promise<EntryModule>> = {
  'api-customer': () => import('./api-customer/index.js'),
  'api-adjuster': () => import('./api-adjuster/index.js'),
};
const load = (name: string): Promise<EntryModule> => {
  const loader = LOADERS[name];
  if (loader === undefined) throw new Error(`unknown entry ${name}`);
  return loader();
};

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
});

function requestFor(routeKey: string, group: 'Customer' | 'Adjuster'): Record<string, unknown> {
  const route = ROUTES.find((r) => r.routeKey === routeKey);
  if (route === undefined) throw new Error(`unknown route ${routeKey}`);
  const body = validBodyFor(route);
  return makeEvent({
    routeKey,
    claims: validClaims(group),
    body,
    headers: body === undefined ? {} : JSON_HEADERS,
    pathParameters: validPathParametersFor(route),
  });
}

describe.each(ENTRIES)('cold start: $name', ({ name, group, routeKey }) => {
  it('exports handler and compiles each schema once, at load', async () => {
    vi.resetModules();
    const compile = vi.spyOn(Ajv2020.prototype, 'compile');
    const mod = await load(name);
    expect(typeof mod.handler).toBe('function');
    const compiledAtLoad = compile.mock.calls.length;
    expect(compiledAtLoad).toBe(BODY_SCHEMA_COUNT);

    const handler = mod.handler as Handler;
    for (let i = 0; i < 3; i += 1) {
      const res = await handler(requestFor(routeKey, group));
      expect(res.statusCode).toBe(501);
    }
    expect(compile.mock.calls.length).toBe(compiledAtLoad);
  });

  it('performs no file read while handling a request', async () => {
    vi.resetModules();
    const mod = await load(name);
    if (mod.handler === undefined) throw new Error('no handler');
    // The test helper reads an example file to build the event, so build it before spying.
    const event = requestFor(routeKey, group);
    const readFile = vi.spyOn(fs, 'readFileSync');
    const readStream = vi.spyOn(fs, 'createReadStream');
    const open = vi.spyOn(fs, 'openSync');
    const readPromise = vi.spyOn(fs.promises, 'readFile');
    syncBuiltinESMExports();
    const res = await mod.handler(event);
    expect(res.statusCode).toBe(501);
    expect(readFile).not.toHaveBeenCalled();
    expect(readStream).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(readPromise).not.toHaveBeenCalled();
  });
});

describe.each(ENTRIES)('esbuild bundle: $name', ({ name }) => {
  it('bundles with only @aws-sdk and node built-ins external, schemas inside, under the size bound', async () => {
    const result = await build({
      entryPoints: [join(API_DIR, name, 'index.ts')],
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      external: ['@aws-sdk/*'],
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    const outputs = Object.values(result.metafile.outputs);
    expect(outputs).toHaveLength(1);
    const output = outputs[0];
    if (output === undefined) throw new Error('no output');

    const externals = output.imports.filter((i) => i.external).map((i) => i.path);
    const unexpected = externals.filter((p) => !p.startsWith('node:') && !p.startsWith('@aws-sdk/'));
    expect(unexpected).toEqual([]);

    const inputs = Object.keys(output.inputs);
    const schemas = inputs.filter((p) => /contracts\/api\/.+\.request\.schema\.json$/.test(p));
    expect(schemas).toHaveLength(BODY_SCHEMA_COUNT);
    expect(inputs.some((p) => p.includes('infra/') || p.includes('aws-cdk-lib'))).toBe(false);

    const text = result.outputFiles[0]?.text ?? '';
    expect(Buffer.byteLength(text)).toBeLessThan(BUNDLE_MAX_BYTES);
  });
});
