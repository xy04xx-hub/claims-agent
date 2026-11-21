// Owner: B (muzair110)
// Synth and cdk-nag tests for the Web stack (T-07, task 4.4).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { applyNag, isValidSuppressionReason } from '../lib/nag.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy } from '../lib/stage-config.js';
import { WebStack } from '../lib/stacks/web-stack.js';

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
const REPO_ROOT = path.resolve(HERE, '../..');

function synthWeb(stage: string) {
  const app = new cdk.App({ outdir: trackTmp(fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'cdk-test-'))) });
  const config = loadStageConfig(stage, CONFIG_DIR, () => undefined);
  new WebStack(app, 'Web', {
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

const HANDLER = /^Web\/Custom::CDKBucketDeployment[^/]+/;
const EXPECTED: Array<{ path: RegExp; id: string }> = [
  { path: /^Web\/ConsoleBucket$/, id: 'AwsSolutions-S1' },
  { path: /^Web\/Distribution$/, id: 'AwsSolutions-CFR1' },
  { path: /^Web\/Distribution$/, id: 'AwsSolutions-CFR2' },
  { path: /^Web\/Distribution$/, id: 'AwsSolutions-CFR3' },
  { path: /^Web\/Distribution$/, id: 'AwsSolutions-CFR4' },
  { path: new RegExp(`${HANDLER.source}$`), id: 'AwsSolutions-L1' },
  { path: new RegExp(`${HANDLER.source}/ServiceRole$`), id: 'AwsSolutions-IAM4' },
  { path: new RegExp(`${HANDLER.source}/ServiceRole/DefaultPolicy$`), id: 'AwsSolutions-IAM5' },
];

describe.each(['dev-a', 'demo', 'ci'])('Web synth with nag (%s)', (stage) => {
  it('has zero errors and exactly the expected acknowledgments with reasons', () => {
    const { assembly, acknowledgments } = synthWeb(stage);
    const errors = assembly.stacks.flatMap((s) => s.messages).filter((m) => m.level === 'error');
    expect(errors).toEqual([]);

    expect(acknowledgments).toHaveLength(EXPECTED.length);
    for (const exp of EXPECTED) {
      const matches = acknowledgments.filter((a) => a.id === exp.id && exp.path.test(a.path));
      expect(matches, `${exp.id} on ${exp.path}`).toHaveLength(1);
    }
    for (const ack of acknowledgments) {
      expect(isValidSuppressionReason(ack.reason)).toBe(true);
      expect(ack.reason.trim().length).toBeGreaterThanOrEqual(10);
    }
    // Nothing is acknowledged on the auto-delete provider (absent in demo, finding-free in dev-a).
    expect(acknowledgments.filter((a) => /AutoDelete/i.test(a.path))).toEqual([]);
  }, 120_000);

  it('warns about the placeholder page because the repo has no frontend/dist', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'frontend/dist/index.html'))).toBe(false);
    const { assembly } = synthWeb(stage);
    const warnings = assembly.stacks
      .flatMap((s) => s.messages)
      .filter((m) => m.level === 'warning')
      .map((m) => String(m.entry.data));
    expect(warnings.some((w) => w.includes('placeholder page'))).toBe(true);
  }, 120_000);
});
