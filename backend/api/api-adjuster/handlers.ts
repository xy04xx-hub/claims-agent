// Route-key map for the api-adjuster function (T-09). Pure wiring: dependencies are injected by index.ts.
import type { RouteHandler } from "../middleware/types.js";
import type { ApiRepo } from "../shared/repo.js";
import { createQueueHandler } from "./queue.js";
import { createResolutionHandler } from "./resolution.js";

export interface AdjusterHandlerDeps {
  repo: ApiRepo;
  now: () => Date;
}

export function createAdjusterHandlers(deps: AdjusterHandlerDeps): Readonly<Record<string, RouteHandler>> {
  const { repo, now } = deps;
  return {
    "GET /queue": createQueueHandler({ repo }),
    "POST /claims/{claimId}/resolution": createResolutionHandler({ repo, now }),
  };
}
