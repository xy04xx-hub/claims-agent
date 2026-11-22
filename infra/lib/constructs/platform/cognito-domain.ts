// Owner: B (muzair110)
import { createHash } from 'node:crypto';

export const RESERVED_DOMAIN_WORDS = ['aws', 'amazon', 'cognito'] as const;

const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_LENGTH = 63;

/**
 * Cognito prefix domain label: `claims-<stage>-<8 hex of SHA-256(account/region/stage)>`.
 * The account only enters the hash, so it never appears in the repo or the template.
 */
export function cognitoDomainPrefix(stage: string, account: string, region: string): string {
  const hash = createHash('sha256').update(`${account}/${region}/${stage}`).digest('hex').slice(0, 8);
  const prefix = `claims-${stage}-${hash}`;
  const reserved = RESERVED_DOMAIN_WORDS.find((w) => prefix.includes(w));
  if (reserved) {
    throw new Error(
      `Cognito domain prefix for stage '${stage}' contains the reserved word '${reserved}'. Choose another stage name.`,
    );
  }
  if (prefix.length > MAX_LENGTH || !DOMAIN_PATTERN.test(prefix)) {
    throw new Error(`Cognito domain prefix for stage '${stage}' is not valid: '${prefix}'.`);
  }
  return prefix;
}
