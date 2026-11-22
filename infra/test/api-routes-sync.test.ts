// Owner: B (muzair110)
// Route table sync test: infra API_ROUTES must stay equal to backend/api ROUTES and to the API table
// in .kiro/steering/architecture.md. Importing backend/api/routes.ts from infra tests is allowed.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTES, type FunctionName } from '../../backend/api/routes.js';
import { TENANT_PATTERN } from '../../backend/api/middleware/limits.js';
import { GROUP_NAMES, TENANT } from '../lib/constructs/platform/auth-model.js';
import { API_ROUTES, FUNCTION_ENTRIES, routeConstructId, type FunctionKey } from '../lib/constructs/platform/api-model.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const FUNCTION_MAP: Readonly<Record<FunctionKey, FunctionName>> = {
  'api-customer': 'api-customer',
  'api-adjuster': 'api-adjuster',
};

const BODY_ROUTE_KEYS = ['POST /evidence/uploads', 'POST /claims', 'POST /claims/{claimId}/resolution'];

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function architectureRouteKeys(): string[] {
  const text = readFileSync(resolve(repoRoot, '.kiro/steering/architecture.md'), 'utf8');
  const start = text.indexOf('| Route | Role | Purpose |');
  expect(start).toBeGreaterThanOrEqual(0);
  const keys: string[] = [];
  for (const line of text.slice(start).split('\n').slice(2)) {
    if (!line.startsWith('|')) break;
    const match = /^\| `((?:GET|POST) \/[^`]*)` \|/.exec(line);
    if (match?.[1] !== undefined) keys.push(match[1]);
  }
  return keys;
}

describe('API route table sync', () => {
  const handlerByKey = new Map(ROUTES.map((r) => [r.routeKey, r]));

  it('has the same route keys in the infra model and the handler table', () => {
    expect(sorted(API_ROUTES.map((r) => r.routeKey))).toEqual(sorted(ROUTES.map((r) => r.routeKey)));
    expect(API_ROUTES).toHaveLength(9);
    expect(handlerByKey.size).toBe(ROUTES.length);
  });

  it('agrees per route on function, groups, state and ticket', () => {
    for (const infra of API_ROUTES) {
      const handler = handlerByKey.get(infra.routeKey);
      expect(handler, infra.routeKey).toBeDefined();
      if (handler === undefined) continue;
      expect(handler.function, infra.routeKey).toBe(FUNCTION_MAP[infra.function]);
      expect([...handler.groups].sort(), infra.routeKey).toEqual([...infra.groups].sort());
      expect(handler.state, infra.routeKey).toBe(infra.state);
      expect(handler.ticket, infra.routeKey).toBe(infra.ticket);
    }
  });

  it('declares a body schema for exactly the three body routes', () => {
    expect(sorted(ROUTES.filter((r) => r.bodySchema !== undefined).map((r) => r.routeKey))).toEqual(
      sorted(BODY_ROUTE_KEYS),
    );
  });

  it('uses group literals equal to the Auth group names', () => {
    const allowed = new Set<string>(Object.values(GROUP_NAMES));
    for (const r of ROUTES) {
      for (const g of r.groups) expect(allowed.has(g), r.routeKey).toBe(true);
    }
    expect(allowed).toEqual(new Set(['Customer', 'Adjuster']));
  });

  it('gives no path to both functions', () => {
    const customerPaths = new Set(API_ROUTES.filter((r) => r.function === 'api-customer').map((r) => r.path));
    const adjusterPaths = new Set(API_ROUTES.filter((r) => r.function === 'api-adjuster').map((r) => r.path));
    expect([...customerPaths].filter((p) => adjusterPaths.has(p))).toEqual([]);
    // Every route key belongs to exactly one function in both tables.
    expect(customerPaths.size + adjusterPaths.size).toBe(new Set(API_ROUTES.map((r) => r.path)).size);
    const keys = ROUTES.map((r) => r.routeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has a unique construct ID per route', () => {
    const ids = API_ROUTES.map((r) => routeConstructId(r));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists the same route keys as the API table in architecture.md', () => {
    expect(sorted(architectureRouteKeys())).toEqual(sorted(API_ROUTES.map((r) => r.routeKey)));
  });

  it('uses the same tenant pattern in the API middleware and the Auth model', () => {
    expect(TENANT_PATTERN.source).toBe(TENANT.pattern.source);
    expect(TENANT_PATTERN.flags).toBe(TENANT.pattern.flags);
  });

  it('points FUNCTION_ENTRIES at files that exist', () => {
    for (const entry of Object.values(FUNCTION_ENTRIES)) {
      expect(existsSync(resolve(repoRoot, entry)), entry).toBe(true);
    }
  });
});
