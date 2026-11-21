import { randomUUID } from "node:crypto";
import {
  GetCommand, QueryCommand, TransactWriteCommand, type DynamoDBDocumentClient, type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { ClaimTypePack, Policy } from "@claims-agent/domain";
import { UNASSIGNED_CLAIM_ID, auditPk, claimKey, customerPk, evidenceByIdPk, evidenceIndexPk, packPk, policyPk, queuePk } from "./keys.js";
import { toClaim, toEvidenceRecord, toPack, toPolicy } from "./normalize.js";
import type { ClaimRecord, CommitInput, CommitResult, EvidenceRecord, IndexType, Store } from "./types.js";

export interface Tables {
  claims: string;
  policies: string;
  packs: string;
  evidenceIndex: string;
  audit: string;
}

type Item = Record<string, unknown>;
const MAX_PAGES = 5;

export class DynamoStore implements Store {
  constructor(
    protected readonly doc: Pick<DynamoDBDocumentClient, "send">,
    protected readonly tables: Tables,
  ) {}

  private async query(input: QueryCommandInput): Promise<Item[]> {
    const out: Item[] = [];
    let key: Record<string, unknown> | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.doc.send(new QueryCommand({ ...input, ExclusiveStartKey: key }));
      out.push(...((res.Items ?? []) as Item[]));
      key = res.LastEvaluatedKey;
      if (!key) break;
    }
    return out;
  }

  async getClaim(tenantId: string, claimId: string): Promise<ClaimRecord | undefined> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tables.claims, Key: claimKey(tenantId, claimId), ConsistentRead: true }),
    );
    return toClaim(tenantId, res.Item as Item | undefined);
  }

  async getPolicyVersions(tenantId: string, policyId: string): Promise<Policy[]> {
    const items = await this.query({
      TableName: this.tables.policies,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": policyPk(tenantId, policyId) },
    });
    return items.map(toPolicy);
  }

  async getPack(tenantId: string, category: string): Promise<ClaimTypePack | undefined> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.packs,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": packPk(tenantId, category) },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return toPack(category, (res.Items?.[0] as Item | undefined));
  }

  async getEvidence(tenantId: string, evidenceIds: string[]): Promise<EvidenceRecord[]> {
    return Promise.all(
      evidenceIds.map(async (evidenceId) => {
        const items = await this.query({
          TableName: this.tables.evidenceIndex,
          IndexName: "byEvidence",
          KeyConditionExpression: "gsi1pk = :pk",
          ExpressionAttributeValues: { ":pk": evidenceByIdPk(tenantId, evidenceId) },
        });
        return toEvidenceRecord(evidenceId, items);
      }),
    );
  }

  async findOtherClaims(tenantId: string, type: IndexType, value: string, excludeClaimId: string): Promise<string[]> {
    const items = await this.query({
      TableName: this.tables.evidenceIndex,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": evidenceIndexPk(tenantId, type, value) },
    });
    const ids = items
      .map((i) => (typeof i.claimId === "string" ? i.claimId : typeof i.sk === "string" ? i.sk.split("#")[0] : ""))
      .filter((id) => id && id !== excludeClaimId && id !== UNASSIGNED_CLAIM_ID);
    return [...new Set(ids)];
  }

  async countRecentClaims(tenantId: string, customerId: string, sinceIso: string, excludeClaimId: string): Promise<number> {
    const items = await this.query({
      TableName: this.tables.claims,
      IndexName: "byCustomer",
      KeyConditionExpression: "gsi1pk = :pk AND gsi1sk >= :since",
      ExpressionAttributeValues: { ":pk": customerPk(tenantId, customerId), ":since": sinceIso },
      ProjectionExpression: "claimId",
    });
    return items.filter((i) => i.claimId !== excludeClaimId).length;
  }

  /**
   * One transaction: update the claim only while it is PROCESSING, and put the audit record.
   * A claim that is already decided makes the condition fail: nothing is written and ALREADY_DECIDED is returned.
   */
  async commitDecision({ claim, decision, audit, decidedAt }: CommitInput): Promise<CommitResult> {
    const t = claim.tenantId;
    const routed = decision.outcome === "ROUTED_TO_ADJUSTER";
    const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    const sets = ["#status = :status", "#decision = :decision", "payout = :payout", "reasons = :reasons", "decidedAt = :decidedAt"];
    const values: Record<string, unknown> = {
      ":status": decision.outcome,
      ":decision": clean(decision),
      ":payout": decision.payout,
      ":reasons": clean(decision.reasons),
      ":decidedAt": decidedAt,
      ":processing": "PROCESSING",
    };
    if (routed) {
      // Sparse adjuster-queue index: only routed claims carry these attributes.
      sets.push("gsi2pk = :q", "gsi2sk = :queued");
      values[":q"] = queuePk(t, decision.outcome, claim.claimId);
      values[":queued"] = claim.createdAt || decidedAt;
    }
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tables.claims,
                Key: claimKey(t, claim.claimId),
                UpdateExpression: `SET ${sets.join(", ")}`,
                ConditionExpression: "attribute_exists(pk) AND #status = :processing",
                ExpressionAttributeNames: { "#status": "status", "#decision": "decision" },
                ExpressionAttributeValues: values,
              },
            },
            {
              Put: {
                TableName: this.tables.audit,
                Item: clean({ pk: auditPk(t, claim.claimId), sk: `${audit.timestamp}#${randomUUID()}`, ...audit }),
                ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
              },
            },
          ],
        }),
      );
      return "COMMITTED";
    } catch (err) {
      const e = err as { name?: string; CancellationReasons?: { Code?: string }[] };
      if (e.name === "TransactionCanceledException" && e.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed") {
        return "ALREADY_DECIDED";
      }
      throw err;
    }
  }
}
