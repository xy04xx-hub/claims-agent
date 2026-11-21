// Owner: B (muzair110). Unit tests for the root script wrappers (T-04 task 7.5).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runOutputs, writeFileAtomic, type OutputsDeps } from './outputs.js';
import { runStackCommand, type RunDeps } from './run-stack-command.js';
import { seedEntry, type SeedDeps } from './seed-entry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function seedDeps(over: Partial<SeedDeps> = {}): SeedDeps & { errors: string[] } {
  const errors: string[] = [];
  return {
    seedExists: () => false,
    runSeed: vi.fn(async () => 0),
    error: (m) => errors.push(m),
    errors,
    ...over,
  };
}

describe('seedEntry', () => {
  it('exits 1 with the T-12 message when scripts/seed.ts is absent', async () => {
    const deps = seedDeps();
    expect(await seedEntry(['--stage', 'dev-b'], deps)).toBe(1);
    expect(deps.errors.join('\n')).toContain('Seeding arrives in T-12');
    expect(deps.runSeed).not.toHaveBeenCalled();
  });

  it('returns the child exit code when scripts/seed.ts exists', async () => {
    const deps = seedDeps({ seedExists: () => true, runSeed: vi.fn(async () => 7) });
    expect(await seedEntry(['--stage', 'dev-b'], deps)).toBe(7);
    expect(deps.runSeed).toHaveBeenCalledWith('dev-b');
  });

  it('rejects an invalid stage without running the seed', async () => {
    const deps = seedDeps({ seedExists: () => true });
    expect(await seedEntry(['prod'], deps)).toBe(1);
    expect(deps.runSeed).not.toHaveBeenCalled();
  });
});

function runDeps(over: Partial<RunDeps> = {}): RunDeps & { errors: string[] } {
  const errors: string[] = [];
  return {
    runCdk: vi.fn(async () => ({ status: 0, output: '' })),
    prompt: vi.fn(async () => 'demo'),
    isTty: true,
    log: () => undefined,
    error: (m) => errors.push(m),
    infraDir: '/tmp/infra',
    errors,
    ...over,
  };
}

describe('runStackCommand', () => {
  it.each([[[]], [['prod']], [['dev-b', 'extra']], [['DEV-B']]])(
    'never starts a child for invalid stage args %j',
    async (argv) => {
      for (const command of ['deploy', 'destroy'] as const) {
        const deps = runDeps();
        expect(await runStackCommand(command, argv, deps)).toBe(1);
        expect(deps.runCdk).not.toHaveBeenCalled();
      }
    },
  );

  it('prints the failing stack name and returns the child status', async () => {
    const deps = runDeps({
      runCdk: vi.fn(async () => ({
        status: 3,
        output: 'ClaimsAgent-dev-b-Foundation: creating\nClaimsAgent-dev-b-Auth failed',
      })),
    });
    expect(await runStackCommand('deploy', ['dev-b'], deps)).toBe(3);
    expect(deps.errors.join('\n')).toContain('ClaimsAgent-dev-b-Auth');
  });

  it('passes the stage to cdk and returns 0 on success', async () => {
    const deps = runDeps();
    expect(await runStackCommand('deploy', ['dev-a'], deps)).toBe(0);
    const [args, cwd] = (deps.runCdk as ReturnType<typeof vi.fn>).mock.calls[0] as [string[], string];
    expect(args).toContain('stage=dev-a');
    expect(cwd).toBe('/tmp/infra');
  });

  it('asks for the stage name on demo destroy and aborts on mismatch', async () => {
    const deps = runDeps({ prompt: vi.fn(async () => 'nope') });
    expect(await runStackCommand('destroy', ['demo'], deps)).toBe(1);
    expect(deps.prompt).toHaveBeenCalledTimes(1);
    expect(deps.runCdk).not.toHaveBeenCalled();
  });

  it('continues demo destroy when the stage name matches', async () => {
    const deps = runDeps({ prompt: vi.fn(async () => 'demo') });
    expect(await runStackCommand('destroy', ['demo'], deps)).toBe(0);
    expect(deps.runCdk).toHaveBeenCalledTimes(1);
  });

  it('does not prompt for a non-demo destroy', async () => {
    const deps = runDeps();
    expect(await runStackCommand('destroy', ['dev-b'], deps)).toBe(0);
    expect(deps.prompt).not.toHaveBeenCalled();
  });
});

describe('outputs', () => {
  function withTempFile<T>(fn: (file: string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(path.join(tmpdir(), 'outputs-test-'));
    return fn(path.join(dir, '.env.dev-b')).finally(() => rmSync(dir, { recursive: true, force: true }));
  }

  function deps(file: string, describeOutputs: OutputsDeps['describeOutputs']): OutputsDeps {
    return {
      describeOutputs,
      writeFileAtomic,
      envFilePath: () => file,
      error: () => undefined,
      log: () => undefined,
    };
  }

  it('leaves an existing file unchanged when a stack read fails', () =>
    withTempFile(async (file) => {
      writeFileSync(file, 'OLD=1\n');
      const describe = async (stack: string) => {
        if (stack.endsWith('-Api')) throw new Error('boom');
        return { A: '1' };
      };
      expect(await runOutputs(['dev-b'], deps(file, describe))).toBe(1);
      expect(readFileSync(file, 'utf8')).toBe('OLD=1\n');
    }));

  it('writes an empty file for an empty output set', () =>
    withTempFile(async (file) => {
      writeFileSync(file, 'OLD=1\n');
      expect(await runOutputs(['dev-b'], deps(file, async () => ({})))).toBe(0);
      expect(readFileSync(file, 'utf8')).toBe('');
    }));

  it('writes NAME=value lines on success', () =>
    withTempFile(async (file) => {
      const describe = async (stack: string): Promise<Record<string, string>> =>
        stack.endsWith('-Web') ? { SiteUrl: 'https://x.example' } : {};
      expect(await runOutputs(['dev-b'], deps(file, describe))).toBe(0);
      expect(readFileSync(file, 'utf8').trim()).toBe('SiteUrl=https://x.example');
    }));

  it('rejects an invalid stage without reading any stack', async () => {
    const describe = vi.fn(async () => ({}));
    expect(await runOutputs(['prod'], deps('/nonexistent/x', describe))).toBe(1);
    expect(describe).not.toHaveBeenCalled();
  });
});

describe('gitignore', () => {
  it('ignores frontend/.env.test-stage', () => {
    const out = execFileSync('git', ['check-ignore', 'frontend/.env.test-stage'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('frontend/.env.test-stage');
  });
});
