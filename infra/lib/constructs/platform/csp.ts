// Owner: B (muzair110)
import type { StageConfig } from '../../stage-config.js';

export type CspDirectives = ReadonlyArray<readonly [name: string, sources: readonly string[]]>;

type CspConfig = Pick<StageConfig, 'cspApiOrigins' | 'cspCognitoOrigins' | 'cspEvidenceOrigins'>;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** The ten CSP directives in a fixed order, so the header is stable. */
export function cspDirectives(c: CspConfig): CspDirectives {
  return [
    ['default-src', ["'none'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'"]],
    ['img-src', ["'self'", 'data:', ...c.cspEvidenceOrigins]],
    ['font-src', ["'self'"]],
    [
      'connect-src',
      unique(["'self'", ...c.cspApiOrigins, ...c.cspCognitoOrigins, ...c.cspEvidenceOrigins]),
    ],
    ['form-action', ["'self'", ...c.cspEvidenceOrigins]],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
  ];
}

/** Content-Security-Policy header value: directives joined by '; ', sources by ' '. */
export function buildCsp(c: CspConfig): string {
  return cspDirectives(c)
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ');
}
