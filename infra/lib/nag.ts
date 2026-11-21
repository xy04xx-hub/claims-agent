// Owner: B (muzair110)
import { Annotations, Aspects, type IAspect, type App } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import type { IConstruct } from 'constructs';

/** A suppression reason is valid when it is a string with at least 10 characters after trimming. */
export function isValidSuppressionReason(reason: unknown): boolean {
  return typeof reason === 'string' && reason.trim().length >= 10;
}

interface SuppressionEntry {
  id?: unknown;
  reason?: unknown;
}

/** Adds an error annotation for every cdk-nag suppression whose reason is missing or too short. */
export class SuppressionReasonCheck implements IAspect {
  visit(node: IConstruct): void {
    for (const entry of node.node.metadata) {
      if (entry.type !== 'cdk_nag') continue;
      const data = entry.data as { rules_to_suppress?: SuppressionEntry[] } | undefined;
      for (const rule of data?.rules_to_suppress ?? []) {
        if (isValidSuppressionReason(rule?.reason)) continue;
        const id = typeof rule?.id === 'string' && rule.id ? rule.id : '(unknown rule)';
        Annotations.of(node).addError(
          `cdk-nag suppression for ${id} on ${node.node.path} needs a reason of at least 10 characters.`,
        );
      }
    }
  }
}

/** Applies cdk-nag AwsSolutions checks and the suppression-reason check to every stack in the app. */
export function applyNag(app: App): void {
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
  Aspects.of(app).add(new SuppressionReasonCheck());
}
