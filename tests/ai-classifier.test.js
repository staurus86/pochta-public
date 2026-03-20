import assert from "node:assert/strict";
import { isAiEnabled, getAiConfig } from "../src/services/ai-classifier.js";

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

runTest("AI is disabled by default (no env vars)", () => {
  assert.equal(isAiEnabled(), false);
});

runTest("getAiConfig returns disabled config without env", () => {
  const config = getAiConfig();
  assert.equal(config.enabled, false);
  assert.equal(typeof config.model, "string");
  assert.equal(typeof config.confidenceThreshold, "number");
});
