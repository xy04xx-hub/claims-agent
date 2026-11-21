import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { applyNag } from '../lib/nag.js';
import type { BaseStackProps } from '../lib/stack-props.js';
import { AgentStack } from '../lib/stacks/agent-stack.js';
import { ApiStack } from '../lib/stacks/api-stack.js';
import { AuthStack } from '../lib/stacks/auth-stack.js';
import { FoundationStack } from '../lib/stacks/foundation-stack.js';
import { OpsStack } from '../lib/stacks/ops-stack.js';
import { ProcessingStack } from '../lib/stacks/processing-stack.js';
import { WebStack } from '../lib/stacks/web-stack.js';
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

  // ---- Foundation: owner B (muzair110) ----
  new FoundationStack(app, 'Foundation', props);

  // ---- Auth: owner B (muzair110) ----
  new AuthStack(app, 'Auth', props);

  // ---- Api: owner B (muzair110) ----
  new ApiStack(app, 'Api', props);

  // ---- Web: owner B (muzair110) ----
  new WebStack(app, 'Web', props);

  // ---- Ops: owner B (muzair110) ----
  new OpsStack(app, 'Ops', props);

  // ---- Processing: owner A ----
  new ProcessingStack(app, 'Processing', props);

  // ---- Agent: owner A ----
  new AgentStack(app, 'Agent', props);

  cdk.Tags.of(app).add('project', 'claims-agent');
  cdk.Tags.of(app).add('stage', stage);
  applyNag(app);

  app.synth();
} catch (e) {
  console.error(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
