// Owner: B (muzair110)
// Entry point for the api-adjuster function. No AWS SDK client is created here.
import { createHandler, type MiddlewareDeps } from '../middleware/middleware.js';
import { createLogSink, createMetricsSink } from '../middleware/powertools.js';

// No handlers are registered in T-08, so every route that passes the checks answers 501.
const deps: MiddlewareDeps = {
  service: 'api-adjuster',
  log: createLogSink('api-adjuster'),
  metrics: createMetricsSink('api-adjuster'),
  now: Date.now,
};

export const handler = createHandler(deps);
