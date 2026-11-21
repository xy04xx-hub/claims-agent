// Owner: B (muzair110)
import { Annotations, Aspects, Validations, type IAspect, type App } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import type { IConstruct } from 'constructs';

/** A suppression reason is valid when it is a string with at least 10 characters after trimming. */
export function isValidSuppressionReason(reason: unknown): boolean {
  return typeof reason === 'string' && reason.trim().length >= 10;
}

/**
 * Adds an error annotation for every acknowledged rule whose reason is missing or too short.
 * cdk-nag v3 records acknowledgments as `{ [ruleId]: reason }` metadata under
 * `Validations.ACKNOWLEDGED_RULES_METADATA_KEY`.
 */
export class SuppressionReasonCheck implements IAspect {
  visit(node: IConstruct): void {
    for (const entry of node.node.metadata) {
      if (entry.type !== Validations.ACKNOWLEDGED_RULES_METADATA_KEY) continue;
      const data = entry.data as Record<string, unknown> | undefined;
      for (const [id, reason] of Object.entries(data ?? {})) {
        if (isValidSuppressionReason(reason)) continue;
        Annotations.of(node).addError(
          `cdk-nag suppression for ${id || '(unknown rule)'} on ${node.node.path} needs a reason of at least 10 characters.`,
        );
      }
    }
  }
}

/**
 * Applies cdk-nag AwsSolutions checks (v3 policy-validation plugin, verbose) and the
 * suppression-reason check to every stack in the app.
 */
export function applyNag(app: App): void {
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
  Aspects.of(app).add(new SuppressionReasonCheck());
}
