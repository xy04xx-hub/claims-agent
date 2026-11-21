// Owner: B (muzair110)
import fc from 'fast-check';

/** One DNS label: lowercase letters, digits and inner hyphens, 1 to 12 characters. */
const labelArb = fc.stringMatching(/^[a-z0-9]([a-z0-9-]{0,10}[a-z0-9])?$/);

/** A host of 1 to 4 labels joined with dots. */
export const hostArb: fc.Arbitrary<string> = fc
  .array(labelArb, { minLength: 1, maxLength: 4 })
  .map((labels) => labels.join('.'));

const httpsOriginArb = hostArb.map((h) => `https://${h}`);
const localhostOriginArb = fc
  .option(fc.integer({ min: 1, max: 65535 }), { nil: undefined })
  .map((port) => (port === undefined ? 'http://localhost' : `http://localhost:${port}`));

/** A single valid console origin: `https://<host>` or `http://localhost[:port]`. */
export const validOriginArb: fc.Arbitrary<string> = fc.oneof(httpsOriginArb, localhostOriginArb);

/** A valid `consoleOrigins` list: 1 to 5 origins. */
export const validOriginsArb: fc.Arbitrary<string[]> = fc.array(validOriginArb, {
  minLength: 1,
  maxLength: 5,
});
