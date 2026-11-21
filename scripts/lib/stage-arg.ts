// Owner: B (muzair110). Pure helper that validates the stage argument of the root scripts.
export const SCRIPT_STAGES = ['dev-a', 'dev-b', 'demo'] as const;
export type ScriptStage = (typeof SCRIPT_STAGES)[number];

export type StageArgResult = { ok: true; stage: ScriptStage } | { ok: false; usage: string };

const USAGE = `Usage: <script> <stage>   (seed also accepts: --stage <stage>)
Valid stages: ${SCRIPT_STAGES.join(', ')}`;

function isScriptStage(value: string): value is ScriptStage {
  return (SCRIPT_STAGES as readonly string[]).includes(value);
}

/**
 * Accepts exactly one stage: `<stage>` or `--stage <stage>`.
 * Anything else (none, several, unknown, extra arguments) returns a usage message.
 */
export function parseStageArg(argv: string[]): StageArgResult {
  const candidate =
    argv.length === 1 ? argv[0] : argv.length === 2 && argv[0] === '--stage' ? argv[1] : undefined;
  if (candidate !== undefined && isScriptStage(candidate)) {
    return { ok: true, stage: candidate };
  }
  return { ok: false, usage: USAGE };
}
