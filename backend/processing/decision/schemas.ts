// Runtime validators built from contracts/. Bundled into the Lambda by esbuild.
import { Ajv2020 } from "ajv/dist/2020.js";
import { addFormats } from "./ajv-formats.js";
import auditSchema from "../../../contracts/audit-record.schema.json" with { type: "json" };
import decisionSchema from "../../../contracts/decision.schema.json" with { type: "json" };
import jobMessageSchema from "../../../contracts/job-message.schema.json" with { type: "json" };
import proposalSchema from "../../../contracts/proposal.schema.json" with { type: "json" };

const ajv = new Ajv2020({ strict: false, allErrors: false });
addFormats(ajv);

function make(schema: object) {
  const validate = ajv.compile(schema);
  return (value: unknown): { ok: true } | { ok: false; error: string } =>
    validate(value) ? { ok: true } : { ok: false, error: ajv.errorsText(validate.errors) };
}

export const validateProposal = make(proposalSchema);
export const validateDecision = make(decisionSchema);
export const validateAudit = make(auditSchema);
export const validateJobMessage = make(jobMessageSchema);
