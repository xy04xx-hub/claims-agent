import { describe, expect, it } from "vitest";
import { decodeS3Key, evidenceSk, parseEvidenceKey } from "./key.js";
import { evidenceSk as seedSk } from "../../../seed/definitions/keys.js";

describe("decodeS3Key", () => {
  it("decodes + as space and %XX", () => {
    expect(decodeS3Key("a+b%2Fc")).toBe("a b/c");
    expect(decodeS3Key("demo-insurer/cust-demo/EVD-1")).toBe("demo-insurer/cust-demo/EVD-1");
  });
  it("throws on a malformed escape", () => expect(() => decodeS3Key("a%E0%A4%A")).toThrow());
});

describe("parseEvidenceKey", () => {
  it("accepts tenant/customer/evidence", () => {
    expect(parseEvidenceKey("demo-insurer/cust-demo/EVD-1042-1")).toEqual({ tenantId: "demo-insurer", customerId: "cust-demo", evidenceId: "EVD-1042-1" });
  });
  it.each([
    ["too few parts", "a/b"], ["too many parts", "a/b/EVD-1/x"], ["empty part", "a//EVD-1"], ["empty key", ""],
    ["hash in tenant", "a#b/c/EVD-1"], ["space", "a b/c/EVD-1"], ["bad evidence id", "a/b/IMG-1"],
    ["evidence id too long", `a/b/EVD-${"x".repeat(41)}`], ["tenant too long", `${"t".repeat(41)}/b/EVD-1`], ["normalized prefix", "normalized/x"],
  ])("rejects %s", (_n, key) => expect(parseEvidenceKey(key)).toBeUndefined());
});

describe("evidenceSk", () => {
  it("matches the seed format", () => {
    expect(evidenceSk("UNASSIGNED", "EVD-1")).toBe("UNASSIGNED#EVD-1");
    for (const [c, e] of [["CLM-1042", "EVD-1042-1"], ["CLM-SCN-A", "EVD-SCN-A-1"]] as const) expect(evidenceSk(c, e)).toBe(seedSk(c, e));
  });
});
