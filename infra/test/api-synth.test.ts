// Owner: B (muzair110)
// Synth and cdk-nag tests for the Api stack (T-08, task 8.3).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { applyNag, isValidSuppressionReason } from '../lib/nag.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy } from '../lib/stage-config.js';
import { ApiStack } from '../lib/stacks/api-stack.js';
import { AuthStack } from '../lib/stacks/auth-stack.js';
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

interface Acknowledgment {
  path: string;
  id: string;
  reason: string;
}

function synthApi(stage: string) {
  const app = new cdk.App({ outdir: trackTmp(fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'cdk-test-'))) });
  const config = loadStageConfig(stage, CONFIG_DIR, () => undefined);
  const props = {
    stage,
    config,
    removalPolicy: cdk.RemovalPolicy[resolveRemovalPolicy(stage, config)],
    env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' },
  };
  const web = new WebStack(app, 'Web', props);
  const auth = new AuthStack(app, 'Auth', { ...props, consoleUrl: web.consoleUrl });
  new ApiStack(app, 'Api', { ...props, auth });
  applyNag(app);
  const assembly = app.synth();
  const acknowledgments: Acknowledgment[] = app.node.findAll().flatMap((c) =>
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

const EXPECTED: Array<{ path: string; id: string }> = [
  { path: 'Api/api-customer', id: 'AwsSolutions-IAM5[Resource::*]' },
  { path: 'Api/api-customer', id: 'AwsSolutions-L1' },
  { path: 'Api/api-adjuster', id: 'AwsSolutions-IAM5[Resource::*]' },
  { path: 'Api/api-adjuster', id: 'AwsSolutions-L1' },
];

describe.each(['dev-a', 'dev-b', 'demo', 'ci'])('Api synth with nag (%s)', (stage) => {
  it('has zero errors and exactly the expected Api acknowledgments with reasons', () => {
    const { assembly, acknowledgments } = synthApi(stage);
    const errors = assembly.stacks.flatMap((s) => s.messages).filter((m) => m.level === 'error');
    expect(errors).toEqual([]);

    const api = acknowledgments.filter((a) => a.path === 'Api' || a.path.startsWith('Api/'));
    expect(api).toHaveLength(EXPECTED.length);
    for (const exp of EXPECTED) {
      const matches = api.filter((a) => a.id === exp.id && a.path === exp.path);
      expect(matches, `${exp.id} on ${exp.path}`).toHaveLength(1);
    }
    for (const ack of api) {
      expect(isValidSuppressionReason(ack.reason)).toBe(true);
      expect(ack.reason.trim().length).toBeGreaterThanOrEqual(10);
    }
  }, 180_000);
});
