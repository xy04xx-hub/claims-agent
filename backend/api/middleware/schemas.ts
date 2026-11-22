// Owner: B (muzair110)
// Request body validators built from contracts/api. Bundled into the Lambda by esbuild and compiled once at module load.
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { addFormats } from './ajv-formats.js';
import type { BodySchemaFile } from '../routes.js';
import evidenceUpload from '../../../contracts/api/evidence-upload.request.schema.json' with { type: 'json' };
import claimCreate from '../../../contracts/api/claim-create.request.schema.json' with { type: 'json' };
import resolution from '../../../contracts/api/resolution.request.schema.json' with { type: 'json' };

// allErrors is safe: bodies are at most 16 KiB and the three schemas are flat.
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

export const BODY_VALIDATORS: Readonly<Record<BodySchemaFile, ValidateFunction>> = {
  'evidence-upload.request.schema.json': ajv.compile(evidenceUpload),
  'claim-create.request.schema.json': ajv.compile(claimCreate),
  'resolution.request.schema.json': ajv.compile(resolution),
};

/** Used by tests only. */
export const ERROR_SCHEMA_FILE = 'error.response.schema.json' as const;
