import assert from "node:assert/strict";
import { buildTenderRunArgs, resolveTenderCredentialsSource } from "../src/services/tender-runner.js";

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

runTest("builds tender runner args with explicit max emails", () => {
  assert.deepEqual(
    buildTenderRunArgs("tender_parser.py", { days: 3, maxEmails: 25 }),
    ["tender_parser.py", "3", "--max-emails", "25"]
  );
});

runTest("builds tender runner reset args without day limit", () => {
  assert.deepEqual(
    buildTenderRunArgs("tender_parser.py", { reset: true, days: 99, maxEmails: 25 }),
    ["tender_parser.py", "--reset"]
  );
});

runTest("prefers inline json credentials source when configured", () => {
  assert.equal(resolveTenderCredentialsSource({
    PROJECT2_GOOGLE_CREDENTIALS_JSON: "{\"client_email\":\"bot@example.com\"}"
  }), "inline-json");
});

runTest("falls back to inline base64 credentials source", () => {
  assert.equal(resolveTenderCredentialsSource({
    PROJECT2_GOOGLE_CREDENTIALS_B64: "eyJjbGllbnRfZW1haWwiOiJib3RAZXhhbXBsZS5jb20ifQ=="
  }), "inline-b64");
});

runTest("uses file credentials source by default", () => {
  assert.equal(resolveTenderCredentialsSource({}), "file");
});
