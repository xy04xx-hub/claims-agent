// Powertools-backed sinks. Used by the Lambda entry point only, so unit tests need no Powertools.
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import type { LogSink, MetricsSink } from "./types.js";

export function createLogSink(logger: Logger = new Logger({ serviceName: "decision" })): LogSink {
  return {
    info: (message, fields) => logger.info(message, fields ?? {}),
    warn: (message, fields) => logger.warn(message, fields ?? {}),
    error: (message, fields) => logger.error(message, fields ?? {}),
  };
}

export function createMetricsSink(
  metrics: Metrics = new Metrics({ namespace: "ClaimsAgent", serviceName: "decision" }),
): MetricsSink {
  return {
    count(name, dimensions) {
      for (const [k, v] of Object.entries(dimensions ?? {})) metrics.addDimension(k, v);
      metrics.addMetric(name, MetricUnit.Count, 1);
    },
    latency: (ms) => metrics.addMetric("DecisionLatencyMs", MetricUnit.Milliseconds, ms),
    // Publishing also clears dimensions, so the `reason` dimension stays on the Routed metric only.
    flush: () => metrics.publishStoredMetrics(),
  };
}
