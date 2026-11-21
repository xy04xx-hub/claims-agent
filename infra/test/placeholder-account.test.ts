import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { App, Stack } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';

describe('CI placeholder account', () => {
  it('synthesizes a stack with no AWS environment variables set', () => {
    const saved = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AWS_') || key.startsWith('CDK_DEFAULT_')) delete process.env[key];
    }
    try {
      const app = new App();
      const stack = new Stack(app, 'PlaceholderTest', {
        env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' },
      });
      const assembly = app.synth();
      expect(stack.account).toBe(CI_PLACEHOLDER_ACCOUNT);
      const artifact = assembly.getStackByName('PlaceholderTest');
      expect(artifact.template).toBeDefined();
      expect(existsSync(join(assembly.directory, artifact.templateFile))).toBe(true);
      expect(readdirSync(assembly.directory)).toContain('manifest.json');
    } finally {
      process.env = saved;
    }
  });
});
