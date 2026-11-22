// Owner: B (muzair110). `npm run seed-users -- <stage>` creates the synthetic Cognito users (idempotent).
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { runSeedUsers, type SeedUsersDeps } from './lib/seed-users.js';

export function buildDeps(): SeedUsersDeps {
  const region = 'us-east-1';
  const cfn = new CloudFormationClient({ region });
  const idp = new CognitoIdentityProviderClient({ region });
  return {
    getPoolId: async (stage) => {
      const res = await cfn.send(new DescribeStacksCommand({ StackName: `ClaimsAgent-${stage}-Auth` }));
      const value = res.Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === 'UserPoolId')?.OutputValue;
      if (!value) throw new Error('output UserPoolId not found');
      return value;
    },
    getUser: async (poolId, email) => {
      try {
        const res = await idp.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: email }));
        const attr = (name: string): string | undefined =>
          res.UserAttributes?.find((a) => a.Name === name)?.Value;
        return { tenantId: attr('custom:tenantId'), sub: attr('sub') };
      } catch (e) {
        if (e instanceof UserNotFoundException) return undefined;
        throw e;
      }
    },
    createUser: async (poolId, u) => {
      const res = await idp.send(
        new AdminCreateUserCommand({
          UserPoolId: poolId,
          Username: u.email,
          TemporaryPassword: u.temporaryPassword,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: u.email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name', Value: u.displayName },
            { Name: 'custom:tenantId', Value: u.tenantId },
          ],
        }),
      );
      return { sub: res.User?.Attributes?.find((a) => a.Name === 'sub')?.Value };
    },
    addToGroup: async (poolId, email, group) => {
      await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: poolId, Username: email, GroupName: group }));
    },
    randomInt: (maxExclusive) => randomInt(maxExclusive),
    print: console.log,
    error: console.error,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Build the AWS clients lazily so invalid arguments never touch AWS.
  let built: SeedUsersDeps | undefined;
  const lazy = (): SeedUsersDeps => (built ??= buildDeps());
  const code = await runSeedUsers(argv, {
    getPoolId: (s) => lazy().getPoolId(s),
    getUser: (p, e) => lazy().getUser(p, e),
    createUser: (p, u) => lazy().createUser(p, u),
    addToGroup: (p, e, g) => lazy().addToGroup(p, e, g),
    randomInt: (m) => randomInt(m),
    print: console.log,
    error: console.error,
  });
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
