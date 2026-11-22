// GET /queue (T-09 task 3.5, requirement 10.1-10.3). Reads all QUEUE_SHARDS partitions in parallel,
// merges oldest first and returns 25 per page with a keyset cursor.
import type { RouteContext, RouteHandler } from "../middleware/types.js";
import { fail } from "../middleware/errors.js";
import { QUEUE_SHARDS } from "../../processing/decision/keys.js";
import type { ApiRepo, Item } from "../shared/repo.js";

export const QUEUE_PAGE_SIZE = 25;
const SHARD_LIMIT = QUEUE_PAGE_SIZE * 2;
const ROUTED = "ROUTED_TO_ADJUSTER";
// The middleware does not pass the query string today; the cursor is read from an optional `query` map on the context.
type QueueContext = RouteContext & { readonly query?: Readonly<Record<string, string | undefined>> };

export interface QueueDeps {
  repo: Pick<ApiRepo, "queryQueueShard">;
}

interface Cursor { createdAt: string; claimId: string }

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c), "utf8").toString("base64url");

export function decodeCursor(raw: string): Cursor | undefined {
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    const createdAt = str(v.createdAt);
    const claimId = str(v.claimId);
    if (createdAt === undefined || claimId === undefined || Number.isNaN(Date.parse(createdAt))) return undefined;
    return { createdAt, claimId };
  } catch {
    return undefined;
  }
}

const after = (a: Cursor, b: Cursor): boolean =>
  a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.claimId > b.claimId);

function toListItem(item: Item): Record<string, unknown> {
  const decision = (item.decision ?? {}) as { reasons?: { adjuster?: unknown } };
  const reasons = (item.reasons ?? decision.reasons ?? {}) as { adjuster?: unknown };
  const out: Record<string, unknown> = {
    claimId: item.claimId,
    status: item.status,
    createdAt: item.createdAt,
  };
  for (const k of ["policyId", "itemId", "cause", "lossDate", "decidedAt"] as const) {
    const v = str(item[k]);
    if (v !== undefined) out[k] = v;
  }
  const amount = num(item.amountClaimed);
  if (amount !== undefined) out.amountClaimed = amount;
  if (Array.isArray(item.evidenceIds)) out.evidenceIds = item.evidenceIds.filter((e) => typeof e === "string");
  if (Array.isArray(reasons.adjuster)) {
    out.routedReasons = reasons.adjuster.filter((r): r is string => typeof r === "string").map((r) => r.slice(0, 300));
  }
  return out;
}

export function createQueueHandler(deps: QueueDeps): RouteHandler {
  return async (ctx) => {
    const { tenantId } = ctx.caller;
    const rawCursor = (ctx as QueueContext).query?.cursor;
    let cursor: Cursor | undefined;
    if (rawCursor !== undefined && rawCursor !== "") {
      cursor = decodeCursor(rawCursor);
      if (cursor === undefined) return fail(400, "BAD_REQUEST", "Invalid cursor.");
    }

    const pages = await Promise.all(
      Array.from({ length: QUEUE_SHARDS }, (_, shard) =>
        deps.repo.queryQueueShard(tenantId, ROUTED, shard, cursor?.createdAt ?? "", SHARD_LIMIT),
      ),
    );

    const more = pages.some((p) => p.lastKey !== undefined);
    const merged = pages
      .flatMap((p) => p.items)
      .filter((i) => i.tenantId === undefined || i.tenantId === tenantId)
      .map((i) => ({ item: i, pos: { createdAt: str(i.createdAt) ?? "", claimId: str(i.claimId) ?? "" } }))
      .filter((e) => e.pos.claimId !== "" && (cursor === undefined || after(e.pos, cursor)))
      .sort((a, b) => (after(a.pos, b.pos) ? 1 : after(b.pos, a.pos) ? -1 : 0));

    const page = merged.slice(0, QUEUE_PAGE_SIZE);
    const body: { items: Record<string, unknown>[]; nextCursor?: string } = { items: page.map((e) => toListItem(e.item)) };
    const last = page[page.length - 1];
    if (last !== undefined && (merged.length > QUEUE_PAGE_SIZE || more)) body.nextCursor = encodeCursor(last.pos);
    return { statusCode: 200, body };
  };
}
