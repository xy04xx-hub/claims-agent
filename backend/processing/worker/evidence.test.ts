// Requirement 13.13: image blocks only for files at or under maxEvidenceImageBytes; larger files are never fetched.
import { describe, expect, it, vi } from "vitest";
import type { ClaimRecord, EvidenceRecord } from "../decision/types.js";
import { loadEvidenceBlocks } from "./evidence.js";
import { buildAgentInput } from "./prompt.js";

const MAX = 1000;

const claim: ClaimRecord = {
  tenantId: "t1",
  claimId: "CLM-1",
  customerId: "c1",
  policyId: "POL-001",
  itemId: "item-1",
  cause: "ACCIDENTAL_DAMAGE",
  amountClaimed: 100,
  lossDate: "2025-01-01",
  evidenceIds: ["ev-ok", "ev-big"],
  status: "PROCESSING",
  createdAt: "2025-01-02T00:00:00Z",
};

const ev = (evidenceId: string, sizeBytes: number): EvidenceRecord => ({
  evidenceId,
  s3Key: `t1/c1/${evidenceId}`,
  contentType: "image/png",
  sizeBytes,
});

function setup() {
  const getObject = vi.fn(async (_bucket: string, key: string) => ({
    bytes: new Uint8Array(key.endsWith("ev-ok") ? MAX : MAX + 1),
  }));
  const deps = { getObject, config: { evidenceBucket: "bucket", maxEvidenceImageBytes: MAX } };
  const evidence = [ev("ev-ok", MAX), ev("ev-big", MAX + 1)];
  return { getObject, deps, evidence };
}

describe("loadEvidenceBlocks image limit", () => {
  it("returns an image block for a PNG at the limit", async () => {
    const { deps, getObject } = setup();
    const out = await loadEvidenceBlocks(deps, [ev("ev-ok", MAX)]);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.block).toMatchObject({ image: { format: "png" } });
    expect(getObject).toHaveBeenCalledTimes(1);
  });

  it("returns no block and makes no getObject call for a file over the limit", async () => {
    const { deps, getObject } = setup();
    const out = await loadEvidenceBlocks(deps, [ev("ev-big", MAX + 1)]);
    expect(out.items[0]?.block).toBeUndefined();
    expect(out.notes.get("ev-big")).toBe("not shown to the model: too large");
    expect(getObject).not.toHaveBeenCalled();
  });

  it("puts exactly one image block and a too-large note in the Converse content", async () => {
    const { deps, getObject, evidence } = setup();
    const loaded = await loadEvidenceBlocks(deps, evidence);
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(getObject).toHaveBeenCalledWith("bucket", "t1/c1/ev-ok");

    const content = buildAgentInput(
      claim,
      evidence,
      loaded.items.map((i) => ({
        evidenceId: i.evidenceId,
        block: i.block,
        notShown: i.note?.replace("not shown to the model: ", ""),
      })),
    );
    expect(content.filter((b) => "image" in b)).toHaveLength(1);
    expect(content.some((b) => "text" in b && b.text === "not shown to the model: too large")).toBe(true);
  });
});
