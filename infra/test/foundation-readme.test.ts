import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Validates: Requirements 8.8, 13.1, 13.2, 13.3, 13.4
const readme = readFileSync(resolve(__dirname, '../README.md'), 'utf8');

describe('infra/README.md Foundation section', () => {
  it.each([
    'evidenceRetentionDays',
    'consoleOrigins',
    'earlyClaimDays',
    'frequencyWindowDays',
    'frequencyMaxClaims',
    'outlierMultiple',
  ])('documents config key %s', (key) => {
    expect(readme).toContain(key);
  });

  it.each(['EvidenceBucketName', 'ClaimsTableName', 'DataKeyArn'])('lists output %s', (name) => {
    expect(readme).toContain(name);
  });

  it('documents the kill switch command', () => {
    expect(readme).toContain('put-parameter');
  });

  it('mentions deletion protection for demo', () => {
    expect(readme).toMatch(/demo[^\n]*deletion protection/i);
  });
});
