import assert from "node:assert/strict";
import { normalizeBackgroundRole, shouldRunScheduler, shouldRunWebhooks } from "../src/services/background-role.js";

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

runTest("normalizes unknown background roles to all", () => {
  assert.equal(normalizeBackgroundRole(""), "all");
  assert.equal(normalizeBackgroundRole("weird"), "all");
  assert.equal(normalizeBackgroundRole("API"), "api");
});

runTest("enables scheduler only for scheduler-capable roles", () => {
  assert.equal(shouldRunScheduler("all"), true);
  assert.equal(shouldRunScheduler("background"), true);
  assert.equal(shouldRunScheduler("scheduler"), true);
  assert.equal(shouldRunScheduler("api"), false);
  assert.equal(shouldRunScheduler("webhooks"), false);
});

runTest("enables webhooks only for webhook-capable roles", () => {
  assert.equal(shouldRunWebhooks("all"), true);
  assert.equal(shouldRunWebhooks("background"), true);
  assert.equal(shouldRunWebhooks("webhooks"), true);
  assert.equal(shouldRunWebhooks("api"), false);
  assert.equal(shouldRunWebhooks("scheduler"), false);
});
