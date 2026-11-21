import {
  GetCommand, QueryCommand, type DynamoDBDocumentClient, type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { ClaimTypePack, Policy } from "@claims-agent/domain";
import { claimKey, customerPk, evidenceByIdPk, evidenceIndexPk, packPk, policyPk } from "./keys.js";
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
      .filter((id) => id && id !== excludeClaimId);
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

  commitDecision(_input: CommitInput): Promise<CommitResult> {
    throw new Error("commitDecision: not implemented");
  }
}
