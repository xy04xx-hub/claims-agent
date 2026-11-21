// Owner: B (muzair110)
// Synth and cdk-nag tests for the Foundation stack (T-05, task 4.6).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { applyNag, isValidSuppressionReason } from '../lib/nag.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy } from '../lib/stage-config.js';
import { FoundationStack } from '../lib/stacks/foundation-stack.js';

const tmpDirs: string[] = [];
const trackTmp = (dir: string): string => {
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(HERE, '../config');

function synthFoundation(stage: string) {
  const app = new cdk.App({ outdir: trackTmp(fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'cdk-test-'))) });
  const config = loadStageConfig(stage, CONFIG_DIR, () => undefined);
  new FoundationStack(app, 'Foundation', {
    stage,
    config,
    removalPolicy: cdk.RemovalPolicy[resolveRemovalPolicy(stage, config)],
    env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' },
  });
  applyNag(app);
  const assembly = app.synth();
  const acknowledgments = app.node.findAll().flatMap((c) =>
    c.node.metadata
      .filter((m) => m.type === cdk.Validations.ACKNOWLEDGED_RULES_METADATA_KEY)
      .flatMap((m) =>
        Object.entries((m.data ?? {}) as Record<string, string>).map(([id, reason]) => ({
          path: c.node.path,
          id: id.replace(/^Annotation::/, ''),
          reason,
        })),
      ),
  );
  return { assembly, acknowledgments };
}

describe.each(['dev-a', 'demo', 'ci'])('Foundation synth with nag (%s)', (stage) => {
  it('has zero error messages and only the S1 acknowledgment on the evidence bucket', () => {
    const { assembly, acknowledgments } = synthFoundation(stage);
    const errors = assembly.stacks.flatMap((s) => s.messages).filter((m) => m.level === 'error');
    expect(errors).toEqual([]);
    expect(acknowledgments).toHaveLength(1);
    const [ack] = acknowledgments;
    expect(ack?.id).toBe('AwsSolutions-S1');
    expect(ack?.path).toMatch(/Foundation\/EvidenceBucket$/);
    expect(isValidSuppressionReason(ack?.reason)).toBe(true);
    expect(ack?.reason.trim().length).toBeGreaterThanOrEqual(10);
    // No provider acknowledgments: nothing is acknowledged on the auto-delete provider.
    expect(acknowledgments.filter((a) => /AutoDelete/i.test(a.path))).toEqual([]);
  }, 60_000);
});
