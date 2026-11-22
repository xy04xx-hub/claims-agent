// DynamoDB access for the API handlers (T-09). Reuses DynamoStore (getClaim, getPolicyVersions, getPack,
// getEvidence) and the key formats from the Decision Lambda, and adds only what the API needs.
// This is the only file under backend/api allowed to import the AWS SDK (see source-scan.test.ts).
import { randomUUID } from "node:crypto";
import {
  GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import type { Policy } from "@claims-agent/domain";
import { DynamoStore, type Tables } from "../../processing/decision/dynamo-store.js";
import { auditPk, claimKey, customerPk, queuePkForShard } from "../../processing/decision/keys.js";
import { toPolicy } from "../../processing/decision/normalize.js";

export type Item = Record<string, unknown>;
export type Key = Record<string, unknown>;
export interface Page { items: Item[]; lastKey?: Key }

const isConditionFailure = (err: unknown): boolean => (err as { name?: string }).name === "ConditionalCheckFailedException";
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class ApiRepo extends DynamoStore {
  constructor(doc: Pick<DynamoDBDocumentClient, "send">, tables: Tables) {
    super(doc, tables);
  }

  /** Every policy version of the customer (byCustomer is keyed by tenantId#customerId). Caller picks the version in force. */
  async getPoliciesByCustomer(tenantId: string, customerId: string): Promise<Policy[]> {
    const items: Item[] = [];
    let key: Key | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.tables.policies,
          IndexName: "byCustomer",
          KeyConditionExpression: "gsi1pk = :pk",
          ExpressionAttributeValues: { ":pk": customerPk(tenantId, customerId) },
          ExclusiveStartKey: key,
        }),
      );
      items.push(...((res.Items ?? []) as Item[]));
      key = res.LastEvaluatedKey;
    } while (key);
    return items.map(toPolicy);
  }

  /** The stored Claims item as is (decision, resolution, enqueuedAt), for the claim views. */
  async getClaimItem(tenantId: string, claimId: string): Promise<Item | undefined> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tables.claims, Key: claimKey(tenantId, claimId), ConsistentRead: true }),
    );
    return res.Item as Item | undefined;
  }

  /** Idempotent create: "EXISTS" when the claim ID is already taken (same clientRequestId). */
  async putClaim(tenantId: string, claimId: string, item: Item): Promise<"CREATED" | "EXISTS"> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tables.claims,
          Item: clean({ ...claimKey(tenantId, claimId), ...item }),
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return "CREATED";
    } catch (err) {
      if (isConditionFailure(err)) return "EXISTS";
      throw err;
    }
  }

  /** Sets enqueuedAt once. Returns false when it was already set. */
  async markEnqueued(tenantId: string, claimId: string, enqueuedAt: string): Promise<boolean> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tables.claims,
          Key: claimKey(tenantId, claimId),
          UpdateExpression: "SET enqueuedAt = :t",
          ConditionExpression: "attribute_exists(pk) AND attribute_not_exists(enqueuedAt)",
          ExpressionAttributeValues: { ":t": enqueuedAt },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionFailure(err)) return false;
      throw err;
    }
  }

  /** The customer's claims, newest first. */
  async queryClaimsByCustomer(tenantId: string, customerId: string, limit: number, startKey?: Key): Promise<Page> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.claims,
        IndexName: "byCustomer",
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": customerPk(tenantId, customerId) },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: startKey,
      }),
    );
    return { items: (res.Items ?? []) as Item[], lastKey: res.LastEvaluatedKey };
  }

  /** One shard of the sparse adjuster queue, oldest first, from createdAt `after` (inclusive). */
  async queryQueueShard(tenantId: string, status: string, shard: number, after: string, limit: number): Promise<Page> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.claims,
        IndexName: "byQueue",
        KeyConditionExpression: "gsi2pk = :pk AND gsi2sk >= :after",
        ExpressionAttributeValues: { ":pk": queuePkForShard(tenantId, status, shard), ":after": after },
        ScanIndexForward: true,
        Limit: limit,
      }),
    );
    return { items: (res.Items ?? []) as Item[], lastKey: res.LastEvaluatedKey };
  }

  /** UPLOAD row proving who owns an evidence ID. "EXISTS" when the ID is already taken. */
  async putUpload(tenantId: string, evidenceId: string, item: Item): Promise<"CREATED" | "EXISTS"> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tables.evidenceIndex,
          Item: clean({
            pk: `${tenantId}#UPLOAD#${evidenceId}`,
            sk: `UNASSIGNED#${evidenceId}`,
            gsi1pk: `${tenantId}#${evidenceId}`,
            gsi1sk: "UPLOAD",
            type: "UPLOAD",
            claimId: "UNASSIGNED",
            evidenceId,
            ...item,
          }),
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return "CREATED";
    } catch (err) {
      if (isConditionFailure(err)) return "EXISTS";
      throw err;
    }
  }

  async getUpload(tenantId: string, evidenceId: string): Promise<Item | undefined> {
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.tables.evidenceIndex,
        Key: { pk: `${tenantId}#UPLOAD#${evidenceId}`, sk: `UNASSIGNED#${evidenceId}` },
      }),
    );
    return res.Item as Item | undefined;
  }

  /**
   * One transaction: move a ROUTED_TO_ADJUSTER claim to its resolved status, drop it from the queue index,
   * and put the audit record. Returns "CONFLICT" when the claim is no longer routed.
   */
  async resolveClaim(input: {
    tenantId: string;
    claimId: string;
    newStatus: "APPROVED_BY_ADJUSTER" | "REJECTED_BY_ADJUSTER";
    resolution: Item;
    audit: Item & { timestamp: string };
  }): Promise<"RESOLVED" | "CONFLICT"> {
    const { tenantId, claimId } = input;
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tables.claims,
                Key: claimKey(tenantId, claimId),
                UpdateExpression: "SET #status = :new, resolution = :r REMOVE gsi2pk, gsi2sk",
                ConditionExpression: "attribute_exists(pk) AND #status = :routed",
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: { ":new": input.newStatus, ":r": clean(input.resolution), ":routed": "ROUTED_TO_ADJUSTER" },
              },
            },
            {
              Put: {
                TableName: this.tables.audit,
                Item: clean({ pk: auditPk(tenantId, claimId), sk: `${input.audit.timestamp}#${randomUUID()}`, ...input.audit }),
                ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
              },
            },
          ],
        }),
      );
      return "RESOLVED";
    } catch (err) {
      const e = err as { name?: string; CancellationReasons?: { Code?: string }[] };
      if (e.name === "TransactionCanceledException" && e.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed") {
        return "CONFLICT";
      }
      throw err;
    }
  }
}
