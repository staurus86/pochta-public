import assert from "node:assert/strict";
import { resolveIdempotencyKey } from "../src/services/idempotency.js";

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

runTest("prefers idempotency header over payload", () => {
  assert.equal(
    resolveIdempotencyKey({ "idempotency-key": "header-key" }, { idempotencyKey: "body-key" }),
    "header-key"
  );
});

runTest("returns null when idempotency key is missing", () => {
  assert.equal(resolveIdempotencyKey({}, {}), null);
});
