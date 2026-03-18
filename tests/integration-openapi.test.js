import assert from "node:assert/strict";
import { buildLegacyIntegrationOpenApi } from "../src/services/integration-openapi.js";

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

runTest("builds versioned legacy integration openapi contract", () => {
  const spec = buildLegacyIntegrationOpenApi({
    baseUrl: "https://pochta-production.up.railway.app"
  });

  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.version, "1.1.0");
  assert.equal(spec.servers[0].url, "https://pochta-production.up.railway.app");
  assert.ok(spec.paths["/api/integration/projects/{projectId}/messages"]);
  assert.ok(spec.paths["/api/integration/projects/{projectId}/messages/{messageKey}/ack"]);
  assert.ok(spec.components.schemas.IntegrationMessage);
  assert.ok(spec.components.schemas.IntegrationDelivery);
  assert.ok(spec.components.securitySchemes.ApiKeyAuth);
  assert.ok(spec.components.securitySchemes.BearerAuth);
  assert.equal(spec.paths["/api/integration/projects/{projectId}/messages/{messageKey}/ack"].post.parameters.at(-1).name, "Idempotency-Key");
});
