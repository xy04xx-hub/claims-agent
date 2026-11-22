// Owner: B (muzair110)
// Powertools-backed sinks. Used by the Lambda entry points only, so unit tests need no Powertools.
// Modelled on backend/processing/decision/powertools.ts.
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import type { FunctionName } from '../routes.js';
import type { LogSink, MetricsSink } from './types.js';

export function createLogSink(
  service: FunctionName,
  logger: Logger = new Logger({ serviceName: service }),
): LogSink {
  return {
    info: (message, fields) => logger.info(message, fields),
    error: (message, fields) => logger.error(message, fields),
  };
}

export function createMetricsSink(
  service: FunctionName,
  metrics: Metrics = new Metrics({ namespace: 'ClaimsAgent', serviceName: service }),
): MetricsSink {
  return {
    outcome(outcome) {
      metrics.addDimension('outcome', outcome);
      metrics.addMetric('ApiRequestOutcome', MetricUnit.Count, 1);
    },
    // Publishing also clears the dimensions, so `outcome` never leaks into the next request.
    flush: () => metrics.publishStoredMetrics(),
  };
}
