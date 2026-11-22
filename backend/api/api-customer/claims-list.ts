// GET /claims (T-09 task 3.4, requirements 5.4-5.6). The caller's claims, newest first, 25 per page.
import type { RouteContext, RouteHandler } from "../middleware/types.js";
import { fail } from "../middleware/errors.js";
import { customerPk } from "../../processing/decision/keys.js";
import type { ApiRepo, Key } from "../shared/repo.js";
import { baseClaimView } from "./claims-get.js";

export const CLAIMS_PAGE_SIZE = 25;

// The middleware does not pass the query string today; the cursor is read from an optional `query` map on the context.
type ListContext = RouteContext & { readonly query?: Readonly<Record<string, string | undefined>> };

export interface ClaimsListDeps {
  repo: Pick<ApiRepo, "queryClaimsByCustomer">;
}

export const encodeKey = (key: Key): string => Buffer.from(JSON.stringify(key), "utf8").toString("base64url");

/** Parses the cursor and checks it points into the caller's own partition. Undefined when malformed or foreign. */
export function decodeKey(raw: string, expectedPk: string): Key | undefined {
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
    const key = v as Key;
    if (key.gsi1pk !== expectedPk || typeof key.pk !== "string" || typeof key.sk !== "string" || typeof key.gsi1sk !== "string") {
      return undefined;
    }
    return { pk: key.pk, sk: key.sk, gsi1pk: key.gsi1pk, gsi1sk: key.gsi1sk };
  } catch {
    return undefined;
  }
}

export function createClaimsListHandler(deps: ClaimsListDeps): RouteHandler {
  return async (rawCtx) => {
    const ctx = rawCtx as ListContext;
    const { tenantId, sub: customerId } = ctx.caller;
    const cursor = ctx.query?.cursor;
    let startKey: Key | undefined;
    if (cursor !== undefined && cursor !== "") {
      startKey = decodeKey(cursor, customerPk(tenantId, customerId));
      if (!startKey) return fail(400, "BAD_REQUEST", "Invalid cursor.", [{ path: "cursor", message: "Invalid cursor." }]);
    }
    const page = await deps.repo.queryClaimsByCustomer(tenantId, customerId, CLAIMS_PAGE_SIZE, startKey);
    const body: { items: Record<string, unknown>[]; nextCursor?: string } = { items: page.items.map(baseClaimView) };
    if (page.lastKey) body.nextCursor = encodeKey(page.lastKey);
    return { statusCode: 200, body };
  };
}
