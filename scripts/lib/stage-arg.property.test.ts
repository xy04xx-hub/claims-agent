// Owner: B (muzair110).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseStageArg, SCRIPT_STAGES } from './stage-arg';

// Feature: b-t04-cdk-skeleton, Property 9: Script stage argument
// **Validates: Requirements 9.5**
describe('Property 9: Script stage argument', () => {
  const validStage = fc.constantFrom(...SCRIPT_STAGES);
  const anyArgs = fc.array(
    fc.oneof(fc.string(), validStage, fc.constant('--stage'), fc.constantFrom('DEV-A', 'dev-a ', 'demo\n', '')),
    { maxLength: 4 },
  );

  it('succeeds iff the argument list is [stage] or ["--stage", stage] with an exact valid stage', () => {
    fc.assert(
      fc.property(anyArgs, (args) => {
        const expected =
          args.length === 1 && (SCRIPT_STAGES as readonly string[]).includes(args[0])
            ? args[0]
            : args.length === 2 &&
                args[0] === '--stage' &&
                (SCRIPT_STAGES as readonly string[]).includes(args[1])
              ? args[1]
              : undefined;
        const result = parseStageArg(args);
        if (expected !== undefined) {
          expect(result).toEqual({ ok: true, stage: expected });
        } else {
          expect(result.ok).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('accepts both valid forms for every stage', () => {
    fc.assert(
      fc.property(validStage, (stage) => {
        expect(parseStageArg([stage])).toEqual({ ok: true, stage });
        expect(parseStageArg(['--stage', stage])).toEqual({ ok: true, stage });
      }),
      { numRuns: 100 },
    );
  });

  it('failure usage message lists all three valid stages', () => {
    fc.assert(
      fc.property(anyArgs, (args) => {
        const result = parseStageArg(args);
        if (!result.ok) {
          for (const s of SCRIPT_STAGES) expect(result.usage).toContain(s);
        }
      }),
      { numRuns: 100 },
    );
  });
});
