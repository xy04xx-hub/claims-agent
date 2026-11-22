import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = dirname(fileURLToPath(import.meta.url));
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() && f !== "node_modules" ? walk(p) : [p];
});
const files = walk(root);
const schemas = files.filter((f) => f.endsWith(".schema.json"));
const load = (f) => JSON.parse(readFileSync(f, "utf8"));

test("every schema has exactly one example and it validates", () => {
  assert.ok(schemas.length > 0);
  for (const s of schemas) {
    const ex = s.replace(".schema.json", ".example.json");
    assert.ok(files.includes(ex), `missing example for ${s}`);
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(load(s));
    assert.ok(validate(load(ex)), `${ex}: ${ajv.errorsText(validate.errors)}`);
  }
});

test("every example has a schema", () => {
  for (const ex of files.filter((f) => f.endsWith(".example.json"))) {
    assert.ok(files.includes(ex.replace(".example.json", ".schema.json")), `orphan ${ex}`);
  }
});

test("error contract 1.1", () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(load(join(root, "api", "error.response.schema.json")));
  const field = { path: "/description", message: "must be at most 1000 characters" };
  const codes = ["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "THROTTLED", "NOT_IMPLEMENTED", "INTERNAL_ERROR"];
  for (const error of codes) {
    assert.ok(validate({ error, message: "m" }), `${error} without fields`);
    assert.ok(validate({ error, message: "m", requestId: "r", fields: [field] }), `${error} with fields`);
  }
  const base = { error: "BAD_REQUEST", message: "m" };
  assert.ok(!validate({ ...base, fields: Array.from({ length: 21 }, () => field) }), "21 fields");
  assert.ok(!validate({ ...base, fields: [{ ...field, extra: 1 }] }), "unknown field key");
  assert.ok(!validate({ ...base, fields: [{ message: "m" }] }), "missing path");
  assert.ok(!validate({ ...base, fields: [{ path: "/a" }] }), "missing message");
  assert.ok(!validate({ ...base, fields: [{ path: "/a", message: "x".repeat(201) }] }), "201 char message");
  assert.ok(!validate({ ...base, extra: 1 }), "unknown top-level key");
});
