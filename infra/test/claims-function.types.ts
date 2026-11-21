// Compile-time checks for ClaimsFunctionProps. Not executed; `npm run typecheck` compiles it.
import { Duration } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { ClaimsFunctionProps } from '../lib/constructs/claims-function.js';

const entry = 'test/fixtures/handler.ts';

export const ok: ClaimsFunctionProps = { entry, timeout: Duration.seconds(10), memorySize: 256 };

// @ts-expect-error timeout is required
export const noTimeout: ClaimsFunctionProps = { entry, memorySize: 256 };

// @ts-expect-error memorySize is required
export const noMemory: ClaimsFunctionProps = { entry, timeout: Duration.seconds(10) };

export const withRole: ClaimsFunctionProps = {
  ...ok,
  // @ts-expect-error role is not a prop
  role: new iam.Role(undefined as never, 'R', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') }),
};

export const withRuntime: ClaimsFunctionProps = {
  ...ok,
  // @ts-expect-error runtime is not a prop
  runtime: lambda.Runtime.NODEJS_20_X,
};

export const withArchitecture: ClaimsFunctionProps = {
  ...ok,
  // @ts-expect-error architecture is not a prop
  architecture: lambda.Architecture.X86_64,
};
