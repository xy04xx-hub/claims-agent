import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
const readme = readFileSync(resolve(__dirname, '../README.md'), 'utf8');

describe('infra/README.md Web section', () => {
  it.each(['cspApiOrigins', 'cspCognitoOrigins', 'cspEvidenceOrigins'])(
    'documents config key %s',
    (key) => {
      expect(readme).toContain(key);
    },
  );

  it.each(['ConsoleUrl', 'DistributionDomainName', 'DistributionId', 'ConsoleBucketName'])(
    'lists output %s',
    (name) => {
      expect(readme).toContain(name);
    },
  );

  it('documents the consoleOrigins hand-off', () => {
    expect(readme).toContain('consoleOrigins');
  });

  it('documents the placeholder page and the console build path', () => {
    expect(readme).toContain('placeholder');
    expect(readme).toContain('frontend/dist');
  });

  it.each(['WAF', 'ACM', 'access logging'])('lists pilot item %s', (item) => {
    expect(readme).toContain(item);
  });
});
