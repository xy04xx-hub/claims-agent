import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { buildApp } from '../lib/build-app.js';
import type { BaseStackProps } from '../lib/stack-props.js';
import { parseStage, resolveAccount } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy } from '../lib/stage-config.js';

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../config');
const REGION = 'us-east-1';

try {
  const app = new cdk.App();

  // Startup order: stage, account, config. Any failure exits before an assembly is written.
  const stage = parseStage(app.node.tryGetContext('stage'));
  const account = resolveAccount(stage, process.env);
  const config = loadStageConfig(stage, CONFIG_DIR, (m) => console.log(m));
  const removalPolicy = cdk.RemovalPolicy[resolveRemovalPolicy(stage, config)];

  const props: BaseStackProps = {
    stage,
    config,
    removalPolicy,
    env: { account, region: REGION },
  };

  buildApp(app, props);
  app.synth();
} catch (e) {
  console.error(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
