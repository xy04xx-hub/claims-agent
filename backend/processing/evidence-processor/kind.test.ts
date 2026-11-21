import { describe, expect, it, vi } from "vitest";
import { EVIDENCE_KINDS, resolveKind } from "./kind.js";

describe("resolveKind", () => {
  it.each(EVIDENCE_KINDS)("metadata %s wins and does not warn", (k) => {
    const warn = vi.fn();
    expect(resolveKind(k, "image/png", warn)).toBe(k);
    expect(warn).not.toHaveBeenCalled();
  });
  it.each([
    ["image/png", "DEVICE_PHOTO"], ["image/jpeg", "DEVICE_PHOTO"], ["IMAGE/JPEG; charset=x", "DEVICE_PHOTO"],
    ["application/pdf", "POLICE_REPORT"], ["text/plain", "STATEMENT"], [undefined, "STATEMENT"],
  ])("falls back for %s to %s and warns", (type, expected) => {
    const warn = vi.fn();
    expect(resolveKind(undefined, type, warn)).toBe(expected);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it("is case-sensitive: an invalid value falls back and the warning does not repeat the value", () => {
    const warn = vi.fn();
    expect(resolveKind("device_photo", "application/pdf", warn)).toBe("POLICE_REPORT");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("device_photo");
  });
});
