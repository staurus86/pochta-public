import assert from "node:assert/strict";
import {
  buildLegacyIntegrationChangelogDocument,
  getLegacyIntegrationApiVersion
} from "../src/services/integration-contract.js";

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

runTest("builds integration changelog document with version policy", () => {
  const document = buildLegacyIntegrationChangelogDocument("https://pochta-production.up.railway.app");

  assert.equal(document.current_version, getLegacyIntegrationApiVersion());
  assert.equal(document.openapi_url, "https://pochta-production.up.railway.app/api/integration/openapi.v1.json");
  assert.equal(document.changelog_url, "https://pochta-production.up.railway.app/api/integration/changelog");
  assert.equal(document.policy.stability, "versioned-v1");
  assert.equal(document.policy.deprecation_notice_days, 90);
  assert.ok(Array.isArray(document.changelog));
  assert.equal(document.changelog[0].version, getLegacyIntegrationApiVersion());
});
