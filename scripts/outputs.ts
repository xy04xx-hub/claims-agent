// Owner: B (muzair110). `npm run outputs -- <stage>` writes frontend/.env.<stage> from the CloudFormation outputs.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { formatEnvFile } from './lib/env-file.js';
import { parseStageArg } from './lib/stage-arg.js';

export const STACK_SHORT_NAMES = ['Foundation', 'Auth', 'Api', 'Processing', 'Agent', 'Web', 'Ops'] as const;

export interface OutputsDeps {
  /** Returns the outputs of one stack as key to value. Throws on failure. */
  describeOutputs: (stackName: string) => Promise<Record<string, string>>;
  /** Writes text to `file` atomically (temp file, then rename). */
  writeFileAtomic: (file: string, text: string) => void;
  envFilePath: (stage: string) => string;
  error: (message: string) => void;
  log: (message: string) => void;
}

/** Reads all seven stacks first, so a failure leaves the existing env file untouched. */
export async function collectOutputs(
  stage: string,
  describeOutputs: OutputsDeps['describeOutputs'],
): Promise<{ ok: true; outputs: Record<string, string> } | { ok: false; stack: string; message: string }> {
  const outputs: Record<string, string> = {};
  for (const short of STACK_SHORT_NAMES) {
    const stack = `ClaimsAgent-${stage}-${short}`;
    try {
      Object.assign(outputs, await describeOutputs(stack));
    } catch (e) {
      return { ok: false, stack, message: (e as Error).message };
    }
  }
  return { ok: true, outputs };
}

export async function runOutputs(argv: string[], deps: OutputsDeps): Promise<number> {
  const parsed = parseStageArg(argv);
  if (!parsed.ok) {
    deps.error(parsed.usage);
    return 1;
  }
  const collected = await collectOutputs(parsed.stage, deps.describeOutputs);
  if (!collected.ok) {
    deps.error(`Could not read outputs of stack ${collected.stack}: ${collected.message}`);
    return 1;
  }
  let text: string;
  try {
    text = formatEnvFile(collected.outputs);
  } catch (e) {
    deps.error((e as Error).message);
    return 1;
  }
  const file = deps.envFilePath(parsed.stage);
  try {
    deps.writeFileAtomic(file, text);
  } catch (e) {
    deps.error(`Could not write ${file}: ${(e as Error).message}`);
    return 1;
  }
  deps.log(`Wrote ${Object.keys(collected.outputs).length} output(s) to ${file}`);
  return 0;
}

export function writeFileAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = new CloudFormationClient({ region: 'us-east-1' });
  const code = await runOutputs(process.argv.slice(2), {
    describeOutputs: async (stackName) => {
      const res = await client.send(new DescribeStacksCommand({ StackName: stackName }));
      const result: Record<string, string> = {};
      for (const o of res.Stacks?.[0]?.Outputs ?? []) {
        if (o.OutputKey && o.OutputValue !== undefined) result[o.OutputKey] = o.OutputValue;
      }
      return result;
    },
    writeFileAtomic,
    envFilePath: (stage) => path.join(root, 'frontend', `.env.${stage}`),
    error: console.error,
    log: console.log,
  });
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
