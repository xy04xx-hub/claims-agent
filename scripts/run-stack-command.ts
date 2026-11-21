// Owner: B (muzair110). `npm run deploy -- <stage>` and `npm run destroy -- <stage>`.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseStageArg, type ScriptStage } from './lib/stage-arg.js';

export type StackCommand = 'deploy' | 'destroy';

export interface ChildResult {
  status: number;
  /** Combined stdout and stderr of the child, used to find the failing stack. */
  output: string;
}

export interface RunDeps {
  /** Runs `npx cdk <args>` in `cwd`, forwarding its output to the terminal. */
  runCdk: (args: string[], cwd: string) => Promise<ChildResult>;
  /** Asks the user to type a line. Only used for `destroy` on `demo`. */
  prompt: (question: string) => Promise<string>;
  isTty: boolean;
  log: (message: string) => void;
  error: (message: string) => void;
  infraDir: string;
}

/** Arguments for `cdk`, pure. */
export function buildCdkArgs(command: StackCommand, stage: ScriptStage): string[] {
  return command === 'deploy'
    ? ['cdk', 'deploy', '--all', '-c', `stage=${stage}`, '--require-approval', 'never']
    : ['cdk', 'destroy', '--all', '--force', '-c', `stage=${stage}`];
}

/** Last `ClaimsAgent-<stage>-<Name>` stack name that appears in the CDK output, if any. */
export function findFailingStack(output: string, stage: string): string | undefined {
  const pattern = new RegExp(`ClaimsAgent-${stage}-[A-Za-z]+`, 'g');
  const matches = output.match(pattern);
  return matches ? matches[matches.length - 1] : undefined;
}

/** Runs the command and returns the process exit code. Validates the stage before any child process starts. */
export async function runStackCommand(
  command: StackCommand,
  argv: string[],
  deps: RunDeps,
): Promise<number> {
  const parsed = parseStageArg(argv);
  if (!parsed.ok) {
    deps.error(parsed.usage);
    return 1;
  }
  const { stage } = parsed;

  if (command === 'destroy' && stage === 'demo' && deps.isTty) {
    const typed = await deps.prompt(`This destroys the "demo" stacks. Type the stage name (demo) to continue: `);
    if (typed.trim() !== stage) {
      deps.error('Stage name did not match. Nothing was destroyed.');
      return 1;
    }
  }

  const result = await deps.runCdk(buildCdkArgs(command, stage), deps.infraDir);
  if (result.status !== 0) {
    const failing = findFailingStack(result.output, stage);
    deps.error(
      `${command} failed with exit status ${result.status}` +
        (failing ? ` (last stack mentioned: ${failing})` : ` (no ClaimsAgent-${stage}-* stack named in the output)`),
    );
    return result.status;
  }
  return 0;
}

function spawnCdk(args: string[], cwd: string): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = spawn('npx', args, { cwd, stdio: ['inherit', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', (err) => resolve({ status: 1, output: `${output}\n${err.message}` }));
    child.on('close', (code) => resolve({ status: code ?? 1, output }));
  });
}

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'deploy' && command !== 'destroy') {
    console.error('Usage: run-stack-command.ts <deploy|destroy> <stage>');
    process.exit(1);
  }
  const code = await runStackCommand(command, rest, {
    runCdk: spawnCdk,
    prompt: promptLine,
    isTty: Boolean(process.stdin.isTTY),
    log: console.log,
    error: console.error,
    infraDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../infra'),
  });
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
