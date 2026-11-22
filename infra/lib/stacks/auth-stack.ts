import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import { ClaimsFunction } from '../constructs/claims-function.js';
import {
  GROUP_NAMES,
  PASSWORD_POLICY,
  TENANT,
  TOKEN_VALIDITY,
  TRIGGER,
} from '../constructs/platform/auth-model.js';
import { buildAppClientUrls } from '../constructs/platform/app-client-urls.js';
import { cognitoDomainPrefix } from '../constructs/platform/cognito-domain.js';
import { resolveDataProtection } from '../constructs/platform/data-protection.js';
import type { BaseStackProps } from '../stack-props.js';
import { stackName } from '../stage.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface AuthStackProps extends BaseStackProps {
  /** `https://<distribution domain>` from the Web stack (a CDK token at synth time). */
  consoleUrl: string;
}

/** Typed handles for later stacks (T-08 builds the JWT authorizer from these). */
export interface AuthResources {
  readonly userPool: cognito.IUserPool;
  readonly appClient: cognito.IUserPoolClient;
  readonly userPoolId: string;
  readonly appClientId: string;
  /** `https://cognito-idp.us-east-1.amazonaws.com/<poolId>` */
  readonly issuerUrl: string;
  /** `<prefix>.auth.us-east-1.amazoncognito.com` */
  readonly cognitoDomain: string;
}

// Owner: B (muzair110)
export class AuthStack extends cdk.Stack implements AuthResources {
  readonly removalPolicy: cdk.RemovalPolicy;
  readonly userPool: cognito.IUserPool;
  readonly appClient: cognito.IUserPoolClient;
  readonly userPoolId: string;
  readonly appClientId: string;
  readonly issuerUrl: string;
  readonly cognitoDomain: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, { ...props, stackName: stackName(props.stage, 'Auth') });
    this.removalPolicy = props.removalPolicy;

    // 1. Guard: the test-only client must never exist in the judged stage.
    if (props.stage === 'demo' && props.config.enableVerificationClient) {
      throw new Error(
        `Config key 'enableVerificationClient' must be false in stage 'demo' (the verification client allows password sign-in)`,
      );
    }
    // 2-4. Settings.
    const protection = resolveDataProtection(props.stage, props.removalPolicy);
    if (cdk.Token.isUnresolved(this.account) || cdk.Token.isUnresolved(this.region)) {
      throw new Error('AuthStack needs a concrete account and region to build the Cognito domain prefix');
    }
    const prefix = cognitoDomainPrefix(props.stage, this.account, this.region);
    const urls = buildAppClientUrls(props.consoleUrl, props.config.authLocalOrigins);

    // 5. Pre token generation trigger. No environment, no extra IAM.
    const trigger = new ClaimsFunction(this, 'PreTokenGeneration', {
      entry: path.join(REPO_ROOT, TRIGGER.entry),
      timeout: cdk.Duration.seconds(TRIGGER.timeoutSeconds),
      memorySize: TRIGGER.memorySize,
    });

    // 6. User pool.
    const pool = new cognito.UserPool(this, 'UserPool', {
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      standardAttributes: { email: { required: true, mutable: true } },
      customAttributes: {
        [TENANT.attributeName]: new cognito.StringAttribute({
          minLen: TENANT.minLength,
          maxLen: TENANT.maxLength,
          mutable: false,
        }),
      },
      passwordPolicy: {
        minLength: PASSWORD_POLICY.minLength,
        requireLowercase: PASSWORD_POLICY.requireLowercase,
        requireUppercase: PASSWORD_POLICY.requireUppercase,
        requireDigits: PASSWORD_POLICY.requireDigits,
        requireSymbols: PASSWORD_POLICY.requireSymbols,
        tempPasswordValidity: cdk.Duration.days(PASSWORD_POLICY.tempPasswordValidityDays),
      },
      mfa: cognito.Mfa.OFF,
      accountRecovery: cognito.AccountRecovery.NONE,
      deletionProtection: protection.deletionProtection,
      removalPolicy: protection.removalPolicy,
    });
    pool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      trigger.function,
      cognito.LambdaVersion.V2_0,
    );

    // 7. Groups, no IAM role and no precedence.
    new cognito.UserPoolGroup(this, 'CustomerGroup', {
      userPool: pool,
      groupName: GROUP_NAMES.customer,
      description: 'Customers file claims and see only their own.',
    });
    new cognito.UserPoolGroup(this, 'AdjusterGroup', {
      userPool: pool,
      groupName: GROUP_NAMES.adjuster,
      description: 'Adjusters work the routed queue and approve or reject.',
    });

    // 8. Managed login domain.
    const domain = pool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: prefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    // 9. Console client (authorization code + PKCE applied by the client, no secret).
    const clientAttributes = {
      read: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, emailVerified: true, fullname: true })
        .withCustomAttributes(TENANT.attributeName),
      // email is required in the pool schema, so Cognito requires it to be writable.
      write: new cognito.ClientAttributes().withStandardAttributes({ email: true, fullname: true }),
    };
    const validity = {
      accessTokenValidity: cdk.Duration.minutes(TOKEN_VALIDITY.accessMinutes),
      idTokenValidity: cdk.Duration.minutes(TOKEN_VALIDITY.idMinutes),
      refreshTokenValidity: cdk.Duration.days(TOKEN_VALIDITY.refreshDays),
    };
    const consoleClient = pool.addClient('ConsoleClient', {
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false, clientCredentials: false },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: urls.callbackUrls,
        logoutUrls: urls.logoutUrls,
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      ...validity,
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
      readAttributes: clientAttributes.read,
      writeAttributes: clientAttributes.write,
    });

    // L1 escape hatch: aws-cdk-lib 2.278 has no L2 for managed login branding.
    // A client has no managed login style until one exists, so create it with Cognito's defaults.
    const branding = new cognito.CfnManagedLoginBranding(this, 'ConsoleBranding', {
      userPoolId: pool.userPoolId,
      clientId: consoleClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    branding.node.addDependency(domain);

    // 10. Verification client (dev stages only): password flow, no OAuth, same attribute rights.
    let verificationClient: cognito.UserPoolClient | undefined;
    if (props.config.enableVerificationClient) {
      verificationClient = pool.addClient('VerificationClient', {
        generateSecret: false,
        disableOAuth: true,
        authFlows: { userPassword: true },
        ...validity,
        enableTokenRevocation: true,
        preventUserExistenceErrors: true,
        readAttributes: clientAttributes.read,
        writeAttributes: clientAttributes.write,
      });
    }

    this.userPool = pool;
    this.appClient = consoleClient;
    this.userPoolId = pool.userPoolId;
    this.appClientId = consoleClient.userPoolClientId;
    this.issuerUrl = `https://cognito-idp.${this.region}.amazonaws.com/${pool.userPoolId}`;
    this.cognitoDomain = `${prefix}.auth.${this.region}.amazoncognito.com`;

    // cdk-nag acknowledgments, each on the narrowest construct that carries the finding.
    cdk.Validations.of(pool).acknowledge({
      id: 'AwsSolutions-COG8',
      reason:
        'Essentials plan chosen on purpose: the ticket and docs/cost-estimate.md price Essentials per active user. Plus threat protection is a pilot item.',
    });
    cdk.Validations.of(pool).acknowledge({
      id: 'AwsSolutions-COG2',
      reason:
        'MFA is off because the demo users are synthetic and a TOTP step would slow the 4-minute demo. MFA is a pilot item.',
    });
    cdk.Validations.of(trigger).acknowledge({
      id: 'AwsSolutions-IAM5[Resource::*]',
      reason:
        'The X-Ray write actions do not support resource-level permissions, so AWS requires a wildcard. The statement comes from the shared ClaimsFunction.',
    });
    cdk.Validations.of(trigger).acknowledge({
      id: 'AwsSolutions-L1',
      reason:
        'The project standard is Node.js 22 on ARM64 (repository.md, .nvmrc). Raising the runtime is a project-wide decision for both owners.',
    });

    // 11. Outputs, no export names.
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPoolId });
    new cdk.CfnOutput(this, 'AppClientId', { value: this.appClientId });
    new cdk.CfnOutput(this, 'IssuerUrl', { value: this.issuerUrl });
    new cdk.CfnOutput(this, 'CognitoDomain', { value: this.cognitoDomain });
    if (verificationClient) {
      new cdk.CfnOutput(this, 'VerificationClientId', { value: verificationClient.userPoolClientId });
    }
  }
}
