// Owner: B (muzair110). `npm run seed -- --stage <stage>`. The seed script itself arrives in T-12 (owner A).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseStageArg } from './lib/stage-arg.js';

export interface SeedDeps {
  seedExists: () => boolean;
  /** Runs scripts/seed.ts with `--stage <stage>` and resolves with its exit code. */
  runSeed: (stage: string) => Promise<number>;
  error: (message: string) => void;
}

export async function seedEntry(argv: string[], deps: SeedDeps): Promise<number> {
  const parsed = parseStageArg(argv);
  if (!parsed.ok) {
    deps.error(parsed.usage);
    return 1;
  }
  if (!deps.seedExists()) {
    deps.error('Seeding arrives in T-12');
    return 1;
  }
  return deps.runSeed(parsed.stage);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(here, 'seed.ts');

async function main(): Promise<void> {
  const code = await seedEntry(process.argv.slice(2), {
    seedExists: () => existsSync(seedPath),
    runSeed: (stage) =>
      new Promise((resolve) => {
        const child = spawn('npx', ['tsx', seedPath, '--stage', stage], { stdio: 'inherit' });
        child.on('error', () => resolve(1));
        child.on('close', (c) => resolve(c ?? 1));
      }),
    error: console.error,
  });
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
