// Owner: B (muzair110)
import type { StageConfig } from '../../stage-config.js';

export const PARAMETER_KEYS = [
  'autoApproveEnabled',
  'earlyClaimDays',
  'frequencyWindowDays',
  'frequencyMaxClaims',
  'outlierMultiple',
] as const;

export type ParameterKey = (typeof PARAMETER_KEYS)[number];

export interface ParameterSpec {
  name: string;
  value: string;
}

/** The only place that writes the `/claims/` prefix. */
export function parameterName(stage: string, key: ParameterKey): string {
  return `/claims/${stage}/${key}`;
}

export function buildParameters(
  stage: string,
  config: StageConfig,
): Record<ParameterKey, ParameterSpec> {
  const values: Record<ParameterKey, string> = {
    autoApproveEnabled: 'true',
    earlyClaimDays: String(config.earlyClaimDays),
    frequencyWindowDays: String(config.frequencyWindowDays),
    frequencyMaxClaims: String(config.frequencyMaxClaims),
    outlierMultiple: String(config.outlierMultiple),
  };
  const out = {} as Record<ParameterKey, ParameterSpec>;
  for (const key of PARAMETER_KEYS) {
    out[key] = { name: parameterName(stage, key), value: values[key] };
  }
  return out;
}
