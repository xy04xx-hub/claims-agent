// Owner: A. Finds the table, bucket and function names of a stage from CloudFormation.
// scripts/outputs.ts (B) needs all seven stacks, so it is not reused: the seed must work with only Foundation deployed.
import {
  CloudFormationClient, DescribeStacksCommand, ListStackResourcesCommand,
} from "@aws-sdk/client-cloudformation";

export interface FoundationNames {
  claims: string;
  policies: string;
  packs: string;
  evidenceIndex: string;
  bucket: string;
}

export interface CfnLike {
  /** Outputs of one stack, key to value. Throws if the stack does not exist. */
  describeOutputs(stackName: string): Promise<Record<string, string>>;
  /** AWS::DynamoDB::Table resources of one stack. The physical ID of a table is its name. */
  listTables(stackName: string): Promise<{ logicalId: string; physicalId: string }[]>;
}

export class MissingResourceError extends Error {
  constructor(readonly what: string) {
    super(`Missing ${what}`);
    this.name = "MissingResourceError";
  }
}

const TABLE_PATTERNS = {
  policies: { output: "PoliciesTableName", logical: /^PoliciesTable[0-9A-F]{8}$/, label: "table Policies" },
  packs: { output: "ClaimTypePacksTableName", logical: /^ClaimTypePacksTable[0-9A-F]{8}$/, label: "table ClaimTypePacks" },
  evidenceIndex: { output: "EvidenceIndexTableName", logical: /^EvidenceIndexTable[0-9A-F]{8}$/, label: "table EvidenceIndex" },
} as const;

export const foundationStack = (stage: string) => `ClaimsAgent-${stage}-Foundation`;
export const processingStack = (stage: string) => `ClaimsAgent-${stage}-Processing`;

function need(outputs: Record<string, string>, key: string): string {
  const v = outputs[key];
  if (!v) throw new MissingResourceError(`output ${key}`);
  return v;
}

/** Outputs first. The three tables that have no output are found by the logical ID of the Foundation resources. */
export async function resolveFoundation(cfn: CfnLike, stage: string): Promise<FoundationNames> {
  const stack = foundationStack(stage);
  const outputs = await cfn.describeOutputs(stack);
  const claims = need(outputs, "ClaimsTableName");
  const bucket = need(outputs, "EvidenceBucketName");
  let tables: { logicalId: string; physicalId: string }[] | undefined;
  const pick = async (p: (typeof TABLE_PATTERNS)[keyof typeof TABLE_PATTERNS]): Promise<string> => {
    const fromOutput = outputs[p.output];
    if (fromOutput) return fromOutput;
    tables ??= await cfn.listTables(stack);
    const hits = tables.filter((t) => p.logical.test(t.logicalId));
    if (hits.length !== 1 || !hits[0]) throw new MissingResourceError(p.label);
    return hits[0].physicalId;
  };
  return {
    claims,
    bucket,
    policies: await pick(TABLE_PATTERNS.policies),
    packs: await pick(TABLE_PATTERNS.packs),
    evidenceIndex: await pick(TABLE_PATTERNS.evidenceIndex),
  };
}

export async function resolveProcessing(cfn: CfnLike, stage: string): Promise<{ decisionFunction: string }> {
  const outputs = await cfn.describeOutputs(processingStack(stage));
  return { decisionFunction: need(outputs, "DecisionFunctionName") };
}

export function realCfn(region = "us-east-1"): CfnLike {
  const client = new CloudFormationClient({ region, maxAttempts: 5 });
  return {
    async describeOutputs(stackName) {
      const res = await client.send(new DescribeStacksCommand({ StackName: stackName }));
      const stack = res.Stacks?.[0];
      if (!stack) throw new MissingResourceError(`stack ${stackName}`);
      return Object.fromEntries((stack.Outputs ?? []).flatMap((o) => (o.OutputKey && o.OutputValue ? [[o.OutputKey, o.OutputValue]] : [])));
    },
    async listTables(stackName) {
      const out: { logicalId: string; physicalId: string }[] = [];
      let next: string | undefined;
      do {
        const res = await client.send(new ListStackResourcesCommand({ StackName: stackName, NextToken: next }));
        for (const r of res.StackResourceSummaries ?? []) {
          if (r.ResourceType === "AWS::DynamoDB::Table" && r.LogicalResourceId && r.PhysicalResourceId) {
            out.push({ logicalId: r.LogicalResourceId, physicalId: r.PhysicalResourceId });
          }
        }
        next = res.NextToken;
      } while (next);
      return out;
    },
  };
}
