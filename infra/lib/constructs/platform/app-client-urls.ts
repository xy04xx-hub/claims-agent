// Owner: B (muzair110)
import { Token } from 'aws-cdk-lib';
import { isValidLocalOrigin } from '../../stage-config.js';
import { CALLBACK_PATH } from './auth-model.js';

export interface AppClientUrls {
  callbackUrls: string[];
  logoutUrls: string[];
}

const HTTPS_ORIGIN = /^https:\/\/[^/?#\s]+$/;

/**
 * Callback and logout URLs: the console URL first, then each local origin, each ending in `/`.
 * `consoleUrl` is usually an unresolved CDK token, so only its `https://` prefix is checked then.
 */
export function buildAppClientUrls(
  consoleUrl: string,
  localOrigins: readonly string[],
): AppClientUrls {
  if (!consoleUrl.startsWith('https://')) {
    throw new Error(`Console URL must start with https://, got '${consoleUrl}'`);
  }
  if (!Token.isUnresolved(consoleUrl) && !HTTPS_ORIGIN.test(consoleUrl)) {
    throw new Error(
      `Console URL must be an origin with no path, trailing slash, query or fragment, got '${consoleUrl}'`,
    );
  }
  for (const origin of localOrigins) {
    if (!isValidLocalOrigin(origin)) {
      throw new Error(`Local origin must be http://localhost[:port], got '${origin}'`);
    }
  }
  const callbackUrls = [
    ...new Set([consoleUrl, ...localOrigins].map((o) => `${o}${CALLBACK_PATH}`)),
  ];
  return { callbackUrls, logoutUrls: [...callbackUrls] };
}
