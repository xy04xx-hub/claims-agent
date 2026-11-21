// Owner: A. In-memory DynamoDB that answers the commands DynamoStore sends. Test helper only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PhotoInfo } from "../seed/definitions/index.js";
import { dhash64Hex, sha256Hex } from "../seed/lib/hashing.js";
import { decodePng } from "../seed/lib/png.js";

type Item = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const evidenceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../seed/evidence");
export function realPhoto(): PhotoInfo {
  const bytes = readFileSync(path.join(evidenceDir, "phone-damaged-imei2.png"));
  return { sha256: sha256Hex(bytes), phash: dhash64Hex(decodePng(bytes)), sizeBytes: bytes.length, contentType: "image/png" };
}
export const TABLES = { claims: "claims", policies: "policies", packs: "packs", evidenceIndex: "evidence", audit: "audit" };

/** Same rule as normId in backend/processing/decision/evaluate.ts (not exported there). */
export const normId = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

export class FakeDynamo {
  private tables = new Map<string, Item[]>();
  load(table: string, items: Item[]): void {
    const rows = this.tables.get(table) ?? [];
    for (const it of items) {
      const i = rows.findIndex((r) => r.pk === it.pk && r.sk === it.sk);
      if (i >= 0) rows[i] = structuredClone(it);
      else rows.push(structuredClone(it));
    }
    this.tables.set(table, rows);
  }
  all(table: string): Item[] { return this.tables.get(table) ?? []; }

  async send(cmd: { constructor: { name: string }; input: Record<string, Any> }): Promise<unknown> {
    const input = cmd.input;
    switch (cmd.constructor.name) {
      case "GetCommand": {
        const k = input.Key as Item;
        return { Item: structuredClone(this.all(input.TableName).find((r) => r.pk === k.pk && r.sk === k.sk)) };
      }
      case "QueryCommand": {
        const v = input.ExpressionAttributeValues as Record<string, string>;
        const gsi = Boolean(input.IndexName);
        const pkAttr = gsi ? "gsi1pk" : "pk";
        const skAttr = gsi ? "gsi1sk" : "sk";
        let rows = this.all(input.TableName).filter((r) => r[pkAttr] === v[":pk"]);
        if (v[":since"]) rows = rows.filter((r) => typeof r[skAttr] === "string" && (r[skAttr] as string) >= v[":since"]!);
        rows = [...rows].sort((a, b) => String(a[skAttr]).localeCompare(String(b[skAttr])));
        if (input.ScanIndexForward === false) rows.reverse();
        if (input.Limit) rows = rows.slice(0, input.Limit);
        return { Items: structuredClone(rows) };
      }
      case "PutCommand":
        this.load(input.TableName, [input.Item]);
        return {};
      case "TransactWriteCommand": {
        for (const t of input.TransactItems as Record<string, Any>[]) {
          if (t.Update) {
            const u = t.Update;
            const row = this.all(u.TableName).find((r) => r.pk === u.Key.pk && r.sk === u.Key.sk);
            if (!row || row.status !== u.ExpressionAttributeValues[":processing"]) {
              throw Object.assign(new Error("cancelled"), { name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
            }
            for (const part of String(u.UpdateExpression).replace(/^SET /, "").split(", ")) {
              const [lhs, rhs] = part.split(" = ") as [string, string];
              row[(u.ExpressionAttributeNames?.[lhs] as string | undefined) ?? lhs] = structuredClone(u.ExpressionAttributeValues[rhs]);
            }
          } else if (t.Put) this.load(t.Put.TableName, [t.Put.Item]);
        }
        return {};
      }
      default:
        throw new Error(`FakeDynamo: unsupported ${cmd.constructor.name}`);
    }
  }
}
