import { describe, expect, it } from "vitest";
import { processObject, type ObjectData, type S3ObjectCreatedEvent } from "./process.js";
import { BUCKET, KEY, buildJpeg, buildPdf, buildPng, fakeDeps, s3Event } from "./test/helpers.js";
import { sha256Hex } from "./hashing.js";

const cfg = { bucket: BUCKET, maxObjectBytes: 10 * 1024 * 1024 };
const png = buildPng();
const obj = (bytes: Uint8Array, contentType = "image/png", kind: string | null = "DEVICE_PHOTO"): ObjectData => ({
  bytes, contentType, metadata: kind ? { kind } : {},
});
const run = (f: ReturnType<typeof fakeDeps>, ev: S3ObjectCreatedEvent = s3Event()) => processObject(ev, f.deps, cfg, "req-1");

describe("processObject: rows", () => {
  it("PNG gives a SHA256 and a PHASH row with the seed row shape", async () => {
    const f = fakeDeps({ [KEY]: obj(png) });
    const out = await run(f);
    expect(out).toMatchObject({ result: "WRITTEN", processingStatus: "READY" });
    const rows = [...f.table.values()];
    expect(rows.map((r) => r.type).sort()).toEqual(["PHASH", "SHA256"]);
    const sha = rows.find((r) => r.type === "SHA256")!;
    expect(sha).toEqual({
      pk: `demo-insurer#SHA256#${sha256Hex(png)}`, sk: "UNASSIGNED#EVD-T13-1", gsi1pk: "demo-insurer#EVD-T13-1", gsi1sk: "SHA256",
      type: "SHA256", value: sha256Hex(png), kind: "DEVICE_PHOTO", claimId: "UNASSIGNED", evidenceId: "EVD-T13-1",
      customerId: "cust-demo", exifDate: null, processingStatus: "READY", contentType: "image/png",
      createdAt: "2026-11-21T10:00:00Z", s3Key: KEY, sizeBytes: png.length,
    });
    expect(rows.find((r) => r.type === "PHASH")!.value).toMatch(/^[0-9a-f]{16}$/);
  });
  it("JPEG gives a SHA256 row only, with the EXIF date", async () => {
    const jpg = buildJpeg({ date: "2026:11:15 10:20:30" });
    const f = fakeDeps({ [KEY]: obj(jpg, "image/jpeg") });
    await run(f);
    const rows = [...f.table.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "SHA256", exifDate: "2026-11-15", processingStatus: "READY" });
  });
  it("JPEG without EXIF and PDF store exifDate as an explicit null", async () => {
    for (const [bytes, type] of [[buildJpeg(), "image/jpeg"], [buildPdf(), "application/pdf"]] as const) {
      const f = fakeDeps({ [KEY]: obj(bytes, type) });
      await run(f);
      const rows = [...f.table.values()];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveProperty("exifDate", null);
    }
  });
  it("the same bytes give the same SHA-256 and a different image a different one", async () => {
    const a = fakeDeps({ [KEY]: obj(png) });
    const b = fakeDeps({ [KEY]: obj(png) });
    const c = fakeDeps({ [KEY]: obj(buildPng(16, 16, 9)) });
    await Promise.all([run(a), run(b), run(c)]);
    const sha = (f: typeof a) => [...f.table.values()].find((r) => r.type === "SHA256")!.value;
    expect(sha(a)).toBe(sha(b));
    expect(sha(a)).not.toBe(sha(c));
  });
  it("takes tenant, customer and evidence ID from the (URL-encoded) key", async () => {
    const f = fakeDeps({ "t-1/c.2/EVD-a-b": obj(png) });
    await run(f, s3Event({ key: "t-1/c.2/EVD-a-b" }));
    expect([...f.table.values()][0]).toMatchObject({ customerId: "c.2", evidenceId: "EVD-a-b", pk: expect.stringMatching(/^t-1#/) });
  });
  it("falls back to a kind from the content type and warns when metadata is missing", async () => {
    const f = fakeDeps({ [KEY]: obj(buildPdf(), "application/pdf", null) });
    await run(f);
    expect([...f.table.values()][0]!.kind).toBe("POLICE_REPORT");
    expect(f.logs.some((l) => l.level === "warn" && l.message.includes("kind metadata"))).toBe(true);
  });
  it("uses the event time as createdAt, and the clock only when it is missing", async () => {
    const f = fakeDeps({ [KEY]: obj(png) });
    await run(f, s3Event({ time: "not a date" }));
    expect([...f.table.values()][0]!.createdAt).toMatch(/^2026-11-21T10:00:00\.0\d\dZ$/);
  });
});

describe("processObject: undecodable and skipped input", () => {
  const truncated = png.subarray(0, 40);
  const gray16 = Buffer.from(png); gray16[24] = 16; // bit depth 16 is unsupported
  const huge = Buffer.from(png); huge.writeUInt32BE(5000, 16); huge.writeUInt32BE(5000, 20);
  it.each([
    ["truncated png", truncated], ["unsupported bit depth", gray16], ["more than 16 million pixels", huge],
    ["wrong signature claiming image/png", Buffer.from("not an image at all, just text of some length")],
  ])("%s gives FAILED, a SHA256 row, no PHASH row and does not throw", async (_n, bytes) => {
    const f = fakeDeps({ [KEY]: obj(bytes) });
    const out = await run(f);
    expect(out).toMatchObject({ result: "WRITTEN", processingStatus: "FAILED" });
    const rows = [...f.table.values()];
    expect(rows.map((r) => r.type)).toEqual(["SHA256"]);
    expect(rows[0]!.processingStatus).toBe("FAILED");
  });
  it.each([
    ["invalid key", s3Event({ key: "just-a-file.png" }), "BAD_KEY"],
    ["malformed escape in key", s3Event({ key: "a/b/EVD-1%E0%A4%A" }), "BAD_KEY"],
    ["wrong bucket", s3Event({ bucket: "other" }), "WRONG_BUCKET"],
    ["oversized object", s3Event({ size: 11 * 1024 * 1024 }), "TOO_LARGE"],
    ["event without bucket and key", { detail: {} }, "BAD_EVENT"],
  ])("%s: no S3 read, no row", async (_n, ev, reason) => {
    const f = fakeDeps({ [KEY]: obj(png) });
    expect(await run(f, ev)).toEqual({ result: "SKIPPED", reason });
    expect(f.calls.getObject).toBe(0);
    expect(f.table.size).toBe(0);
  });
});

describe("processObject: failures and retries", () => {
  it("rethrows an S3 read error and writes nothing", async () => {
    const f = fakeDeps({ [KEY]: obj(png) });
    f.fail.get = true;
    await expect(run(f)).rejects.toThrow("s3 boom");
    expect(f.table.size).toBe(0);
  });
  it("rethrows a write error, and a retry ends with the same rows as a clean run", async () => {
    const retried = fakeDeps({ [KEY]: obj(png) });
    retried.fail.putOnce = true;
    await expect(run(retried)).rejects.toThrow("ddb boom");
    await run(retried);
    const clean = fakeDeps({ [KEY]: obj(png) });
    await run(clean);
    expect([...retried.table.entries()]).toEqual([...clean.table.entries()]);
  });
  it("processing the same event twice leaves one set of rows", async () => {
    const f = fakeDeps({ [KEY]: obj(png) });
    await run(f);
    await run(f);
    expect(f.table.size).toBe(2);
  });
  it("reads the object once", async () => {
    const f = fakeDeps({ [KEY]: obj(png) });
    await run(f);
    expect(f.calls.getObject).toBe(1);
    expect(f.calls.putRows).toBe(1);
  });
});

describe("processObject: logs", () => {
  it("logs evidenceId and request ID on the completion line, with kind, type, status and duration", async () => {
    const f = fakeDeps({ [KEY]: obj(png) });
    await run(f);
    const done = f.logs.find((l) => l.message === "evidence processed")!;
    expect(done.fields).toMatchObject({
      requestId: "req-1", evidenceId: "EVD-T13-1", kind: "DEVICE_PHOTO", contentType: "image/png", processingStatus: "READY",
    });
    expect(typeof done.fields!.durationMs).toBe("number");
  });
  it("never logs file bytes or the full key of an invalid object", async () => {
    const f = fakeDeps({});
    await run(f, s3Event({ key: "secret-name-of-alex/passport.png" }));
    const text = JSON.stringify(f.logs);
    expect(text).not.toContain("secret-name-of-alex");
    expect(text).not.toContain("passport");
    const ok = fakeDeps({ [KEY]: obj(png) });
    await run(ok);
    expect(JSON.stringify(ok.logs)).not.toContain(png.toString("base64").slice(0, 20));
  });
});
