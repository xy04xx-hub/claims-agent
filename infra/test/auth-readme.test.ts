import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 16.5, 16.6, 16.7, 16.8, 16.9
const readme = readFileSync(resolve(__dirname, '../README.md'), 'utf8');

describe('infra/README.md Auth section', () => {
  it.each([
    'authLocalOrigins',
    'enableVerificationClient',
    'UserPoolId',
    'AppClientId',
    'IssuerUrl',
    'CognitoDomain',
    'seed-users',
    'PKCE',
    'update-user-attributes',
  ])('documents %s', (item) => {
    expect(readme).toContain(item);
  });

  it('says enableVerificationClient must stay false in demo', () => {
    const line = readme
      .split('\n')
      .find((l) => l.includes('enableVerificationClient') && /\bdemo\b/.test(l));
    expect(line).toBeDefined();
  });

  it('has no stale T-06 hand-off and keeps the placeholder notes', () => {
    expect(readme).not.toContain('Give `ConsoleUrl` to T-06');
    expect(readme).toContain('placeholder');
    expect(readme).toContain('frontend/dist');
  });

  it('documents the Cognito CSP hand-off', () => {
    const line = readme
      .split('\n')
      .find((l) => l.includes('cspCognitoOrigins') && l.includes('CognitoDomain'));
    expect(line).toBeDefined();
  });

  it('says the dev stage hosts are not committed', () => {
    expect(readme).toMatch(/no ephemeral CloudFront, API or Cognito host is committed/);
  });
});
