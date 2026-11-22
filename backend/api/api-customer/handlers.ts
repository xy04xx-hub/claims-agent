// Route-key map for the api-customer function (T-09). Pure wiring: dependencies are injected by index.ts.
import type { RouteHandler } from "../middleware/types.js";
import type { PresignPost } from "../shared/presign.js";
import type { ApiRepo } from "../shared/repo.js";
import { createClaimsCreateHandler, type JobMessage } from "./claims-create.js";
import { createClaimsGetHandler } from "./claims-get.js";
import { createClaimsListHandler } from "./claims-list.js";
import { createEvidenceUploadsHandler } from "./evidence-uploads.js";
import { createMePoliciesHandler } from "./me-policies.js";

export interface CustomerHandlerDeps {
  repo: ApiRepo;
  presign: PresignPost;
  /** Read when a request needs them, so a missing variable fails the request, not the cold start. */
  bucket: () => string;
  maxUploadBytes: () => number;
  sendJob: (message: JobMessage) => Promise<void>;
  now: () => number;
}

export function createCustomerHandlers(deps: CustomerHandlerDeps): Readonly<Record<string, RouteHandler>> {
  const { repo, now, sendJob, presign } = deps;
  const uploads = (ctx: Parameters<RouteHandler>[0]) =>
    createEvidenceUploadsHandler({
      repo, presign, now, bucket: deps.bucket(), maxUploadBytes: deps.maxUploadBytes(),
    })(ctx);
  return {
    "GET /me/policies": createMePoliciesHandler({ repo, now }),
    "POST /evidence/uploads": uploads,
    "POST /claims": createClaimsCreateHandler({ repo, sendJob, now }),
    "GET /claims": createClaimsListHandler({ repo }),
    "GET /claims/{claimId}": createClaimsGetHandler({ repo }),
  };
}
