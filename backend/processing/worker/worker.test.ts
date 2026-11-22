// Requirements 13.5, 13.6: Bedrock and schema failures route through the Decision Lambda and never throw.
import { describe, expect, it, vi } from "vitest";
import type { ClaimRecord, EvidenceRecord } from "../decision/types.js";
import { createWorker, type WorkerDeps } from "./handler.js";

const tenantId = "t1";
const claimId = "CLM-test-1";

const claim = (status: ClaimRecord["status"]): ClaimRecord => ({
  tenantId,
  claimId,
  customerId: "c1",
  policyId: "POL-001",
  itemId: "item-1",
  cause: "ACCIDENTAL_DAMAGE",
  amountClaimed: 100,
  lossDate: "2025-01-01",
  evidenceIds: ["EVD-1"],
  status,
  createdAt: "2025-01-02T00:00:00Z",
});

const evidence: EvidenceRecord = {
  evidenceId: "EVD-1",
  s3Key: "t1/c1/EVD-1",
  contentType: "image/png",
  sizeBytes: 10,
  processingStatus: "READY",
};

function setup(status: ClaimRecord["status"], converse: WorkerDeps["converse"]) {
  const invokeDecision = vi.fn(async () => ({ result: "DECIDED" }) as never);
  const deps: WorkerDeps = {
    store: {
      getClaim: async () => claim(status),
      getEvidence: async () => [evidence],
    } as unknown as WorkerDeps["store"],
    getObject: async () => ({ bytes: new Uint8Array(10) }),
    converse,
    invokeDecision,
    sleep: async () => undefined,
    random: () => 0,
    now: () => new Date("2025-01-02T00:00:00Z"),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    metrics: { stage: vi.fn(), total: vi.fn(), flush: vi.fn() },
    config: {
      modelId: "test-model",
      maxTokens: 1000,
      maxEvidenceImageBytes: 1000,
      evidenceBucket: "bucket",
      frequencyWindowDays: 30,
    },
  };
  const event = { Records: [{ messageId: "m1", body: JSON.stringify({ tenantId, claimId, attempt: 1, requestId: "req-1" }) }] };
  return { worker: createWorker(deps), invokeDecision, event };
}

describe("worker", () => {
  it("routes with AUTOMATIC_CHECK_UNAVAILABLE after Bedrock fails 3 times, without throwing", async () => {
    const converse = vi.fn(async () => {
      throw Object.assign(new Error("slow down"), { name: "ThrottlingException" });
    });
    const { worker, invokeDecision, event } = setup("PROCESSING", converse as never);
    const res = await worker.handler(event);
    expect(res.batchItemFailures).toEqual([]);
    expect(converse).toHaveBeenCalledTimes(3);
    expect(invokeDecision).toHaveBeenCalledTimes(1);
    expect(invokeDecision).toHaveBeenCalledWith({ tenantId, claimId, route: "AUTOMATIC_CHECK_UNAVAILABLE" });
  });

  it("routes with AUTOMATIC_CHECK_UNAVAILABLE when the proposal fails the schema", async () => {
    const converse = vi.fn(async () => ({
      stopReason: "tool_use",
      output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "tu1", name: "submit_proposal", input: { cause: "ACCIDENTAL_DAMAGE" } } }] } },
      usage: {},
    }));
    const { worker, invokeDecision, event } = setup("PROCESSING", converse as never);
    const res = await worker.handler(event);
    expect(res.batchItemFailures).toEqual([]);
    expect(invokeDecision).toHaveBeenCalledTimes(1);
    expect(invokeDecision).toHaveBeenCalledWith({ tenantId, claimId, route: "AUTOMATIC_CHECK_UNAVAILABLE" });
  });

  it("skips a claim that is no longer PROCESSING", async () => {
    const converse = vi.fn();
    const { worker, invokeDecision, event } = setup("AUTO_APPROVED", converse as never);
    const res = await worker.handler(event);
    expect(res.batchItemFailures).toEqual([]);
    expect(converse).not.toHaveBeenCalled();
    expect(invokeDecision).not.toHaveBeenCalled();
  });
});
