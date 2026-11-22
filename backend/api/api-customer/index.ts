// Owner: B (muzair110)
// Entry point for the api-customer function. AWS clients are created here; env is read lazily (shared/env.ts).
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createHandler, type MiddlewareDeps } from '../middleware/middleware.js';
import { createLogSink, createMetricsSink } from '../middleware/powertools.js';
import { env, lazyTables, maxUploadBytes } from '../shared/env.js';
import { createPresigner } from '../shared/presign.js';
import { ApiRepo } from '../shared/repo.js';
import type { JobMessage } from './claims-create.js';
import { createCustomerHandlers } from './handlers.js';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({});
const sqs = new SQSClient({});
const repo = new ApiRepo(doc, lazyTables());

// The job carries IDs only (no personal data). The user's token never reaches the queue.
const sendJob = async (message: JobMessage): Promise<void> => {
  await sqs.send(new SendMessageCommand({ QueueUrl: env('JOB_QUEUE_URL'), MessageBody: JSON.stringify(message) }));
};

// GET /claims/{claimId}/evidence/{evidenceId} stays unregistered (T-10) and answers 501.
const deps: MiddlewareDeps = {
  service: 'api-customer',
  log: createLogSink('api-customer'),
  metrics: createMetricsSink('api-customer'),
  now: Date.now,
  handlers: createCustomerHandlers({
    repo,
    presign: createPresigner(s3),
    bucket: () => env('EVIDENCE_BUCKET'),
    maxUploadBytes,
    sendJob,
    now: Date.now,
  }),
};

export const handler = createHandler(deps);
