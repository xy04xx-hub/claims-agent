// Owner: B (muzair110)
import fc from 'fast-check';

/** One DNS label: lowercase letters, digits and inner hyphens, 1 to 12 characters. */
const labelArb = fc.stringMatching(/^[a-z0-9]([a-z0-9-]{0,10}[a-z0-9])?$/);

/** A DNS name of 2 to 5 lowercase labels. */
export const dnsNameArb: fc.Arbitrary<string> = fc
  .array(labelArb, { minLength: 2, maxLength: 5 })
  .map((labels) => labels.join('.'));

/** A valid CSP source: `https://` plus a DNS name, optionally with one leading `*.` label. */
export const validCspSourceArb: fc.Arbitrary<string> = fc
  .tuple(dnsNameArb, fc.boolean())
  .map(([host, wildcard]) => (wildcard ? `https://*.${host}` : `https://${host}`));

/** A valid list for one CSP key: 1 to 4 sources. */
export const validCspListArb: fc.Arbitrary<string[]> = fc.array(validCspSourceArb, {
  minLength: 1,
  maxLength: 4,
});

/** A valid CSP source with exactly one defect. Every result must be rejected. */
export const invalidCspSourceArb: fc.Arbitrary<string> = fc
  .tuple(dnsNameArb, labelArb, fc.stringMatching(/^[a-z0-9]{1,8}$/))
  .chain(([host, label, seg]) =>
    fc.constantFrom(
      `http://${host}`, // other scheme
      `ftp://${host}`,
      `//${host}`, // no scheme
      host, // no scheme at all
      `https://${host}:443`, // port
      `https://${host}/${seg}`, // path
      `https://${host}/`, // trailing slash
      `https://${host}?q=${seg}`, // query
      `https://${host}#${seg}`, // fragment
      `https://user@${host}`, // credentials
      `https://*.${label}`, // wildcard with one label after it
      `https://${label}.*.${host}`, // wildcard not leading
      `https://*${host}`, // wildcard glued to a label
      `https://*.*.${host}`, // two wildcards
      `https://${host}.*`, // trailing wildcard
      '*', // bare wildcard
      'https://*', // wildcard host only
      `https://A${host}`, // uppercase
      `HTTPS://${host}`, // uppercase scheme
      `https://${label} ${seg}.${host}`, // space
      ` https://${host}`, // leading space
      "'self'", // CSP keywords
      "'unsafe-inline'",
      'data:',
      'blob:',
      '',
      `https://-${host}`, // label starts with hyphen
      `https://${host}.`, // empty trailing label
    ),
  );

/** Values that are not strings. */
export const nonStringArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  null,
  undefined,
  42,
  true,
  {},
  [],
  ['https://example.com'],
);

/** The CSP keys added by T-07. */
export const CSP_KEYS = ['cspApiOrigins', 'cspCognitoOrigins', 'cspEvidenceOrigins'] as const;
export type CspKey = (typeof CSP_KEYS)[number];

/** The three CSP lists as an object. */
export const cspListsArb: fc.Arbitrary<Record<CspKey, string[]>> = fc.record({
  cspApiOrigins: validCspListArb,
  cspCognitoOrigins: validCspListArb,
  cspEvidenceOrigins: validCspListArb,
});

/** Shipped values for every non-CSP key, as in the other property tests. */
export const baseConfig: Record<string, unknown> = {
  autoApproveCaps: {
    phoneAccidentalDamage: 500,
    phoneTheft: 300,
    phoneLoss: 0,
    carWindscreenOrCosmetic: 250,
    carSevere: 0,
  },
  bedrockModelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  maxTokens: 1024,
  maxEvidenceImageBytes: 3670016,
  maxUploadBytes: 5242880,
  maxEvidenceFilesPerClaim: 6,
  maxDescriptionLength: 1000,
  jobTicketTtlSeconds: 60,
  workerTimeoutSeconds: 60,
  sqsMaxReceiveCount: 3,
  evidenceRetentionDays: 90,
  consoleOrigins: ['http://localhost:5173'],
  earlyClaimDays: 14,
  frequencyWindowDays: 30,
  frequencyMaxClaims: 3,
  outlierMultiple: 2,
};

/** A valid config with the three CSP keys generated. */
export const validCspConfigArb: fc.Arbitrary<Record<string, unknown>> = cspListsArb.map((l) => ({
  ...baseConfig,
  ...l,
}));
