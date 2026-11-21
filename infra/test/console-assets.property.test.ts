import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FRONTEND_DIST,
  PLACEHOLDER_DIR,
  resolveConsoleAssetDir,
} from '../lib/constructs/platform/console-assets.js';

// Feature: b-t07-web-stack, Property 6: The asset resolver prefers a built console only when index.html exists
// **Validates: Requirements 7.1**

const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/);
const dirArb = fc
  .array(segment, { minLength: 1, maxLength: 4 })
  .map((parts) => '/' + parts.join('/'));
const fileNameArb = fc.constantFrom('index.html', 'assets/app.js', 'favicon.ico', 'main.css');

describe('resolveConsoleAssetDir (Property 6)', () => {
  it('returns the built console iff frontendDist/index.html exists', () => {
    fc.assert(
      fc.property(
        dirArb,
        dirArb,
        fc.array(fc.tuple(fc.boolean(), fileNameArb), { maxLength: 12 }),
        (frontendDist, placeholder, entries) => {
          fc.pre(frontendDist !== placeholder);
          const existing = new Set(
            entries.map(([inFrontend, f]) =>
              path.join(inFrontend ? frontendDist : placeholder, f),
            ),
          );
          const result = resolveConsoleAssetDir(frontendDist, placeholder, (p) =>
            existing.has(p),
          );
          const built = existing.has(path.join(frontendDist, 'index.html'));
          if (built) {
            expect(result).toEqual({ dir: frontendDist, isPlaceholder: false });
          } else {
            expect(result).toEqual({ dir: placeholder, isPlaceholder: true });
          }
          // Other files do not change the result.
          const withoutOthers = new Set(
            [...existing].filter((p) => p === path.join(frontendDist, 'index.html')),
          );
          expect(
            resolveConsoleAssetDir(frontendDist, placeholder, (p) => withoutOthers.has(p)),
          ).toEqual(result);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('console asset path constants', () => {
  it('are absolute paths under the repo', () => {
    expect(path.isAbsolute(FRONTEND_DIST)).toBe(true);
    expect(path.isAbsolute(PLACEHOLDER_DIR)).toBe(true);
    expect(FRONTEND_DIST.endsWith(path.join('frontend', 'dist'))).toBe(true);
    expect(PLACEHOLDER_DIR.endsWith(path.join('infra', 'assets', 'web-placeholder'))).toBe(true);
  });

  it('do not depend on the working directory', async () => {
    const before = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'console-assets-'));
    try {
      process.chdir(tmp);
      const mod = await import('../lib/constructs/platform/console-assets.js?cwd=' + Date.now());
      expect(mod.FRONTEND_DIST).toBe(FRONTEND_DIST);
      expect(mod.PLACEHOLDER_DIR).toBe(PLACEHOLDER_DIR);
    } finally {
      process.chdir(before);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
