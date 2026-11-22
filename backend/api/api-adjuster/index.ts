// Owner: B (muzair110)
// Entry point for the api-adjuster function. AWS clients are created here; env is read lazily (shared/env.ts).
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createHandler, type MiddlewareDeps } from '../middleware/middleware.js';
import { createLogSink, createMetricsSink } from '../middleware/powertools.js';
import { lazyTables } from '../shared/env.js';
import { ApiRepo } from '../shared/repo.js';
import { createAdjusterHandlers } from './handlers.js';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const repo = new ApiRepo(doc, lazyTables());

// GET /impact stays unregistered (T-24) and answers 501.
const deps: MiddlewareDeps = {
  service: 'api-adjuster',
  log: createLogSink('api-adjuster'),
  metrics: createMetricsSink('api-adjuster'),
  now: Date.now,
  handlers: createAdjusterHandlers({ repo, now: () => new Date() }),
};

export const handler = createHandler(deps);
