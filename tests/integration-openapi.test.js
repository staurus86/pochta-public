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
  assert.equal(spec.info.version, "1.5.0");
  assert.equal(spec.servers[0].url, "https://pochta-production.up.railway.app");
  assert.ok(spec.paths["/api/integration/changelog"]);
  assert.ok(spec.paths["/api/integration/projects/{projectId}/messages"]);
  assert.ok(spec.paths["/api/integration/projects/{projectId}/messages/stats"]);
  assert.ok(spec.paths["/api/integration/projects/{projectId}/messages/coverage"]);
  assert.ok(spec.paths["/api/integration/projects/{projectId}/messages/problems"]);
  assert.ok(spec.paths["/api/integration/projects/{projectId}/messages/export"]);
  assert.ok(spec.paths["/api/integration/projects/{projectId}/threads"]);
  assert.ok(spec.paths["/api/integration/projects/{projectId}/threads/{threadId}"]);
  assert.ok(spec.paths["/api/integration/projects/{projectId}/messages/{messageKey}/ack"]);
  assert.ok(spec.paths["/api/integration/projects/{projectId}/deliveries/stats"]);
  assert.ok(spec.components.schemas.IntegrationMessage);
  assert.ok(spec.components.schemas.IntegrationDelivery);
  assert.ok(spec.components.schemas.IntegrationChangelogDocument);
  assert.ok(spec.components.schemas.IntegrationDeliveryDiagnosticsResponse);
  assert.ok(spec.components.securitySchemes.ApiKeyAuth);
  assert.ok(spec.components.securitySchemes.BearerAuth);
  assert.equal(spec.paths["/api/integration/projects/{projectId}/messages/{messageKey}/ack"].post.parameters.at(-1).name, "Idempotency-Key");
  assert.ok(spec.components.schemas.IntegrationMessage.properties.sender.properties.kpp);
  assert.ok(spec.components.schemas.IntegrationMessage.properties.sender.properties.ogrn);
  assert.ok(spec.components.schemas.IntegrationMessage.properties.message_meta);
  assert.ok(spec.components.schemas.IntegrationMessage.properties.audit);
  assert.ok(spec.components.schemas.IntegrationMessageStatsResponse);
  assert.ok(spec.components.schemas.IntegrationCoverageResponse);
  assert.ok(spec.components.schemas.IntegrationProblemQueueResponse);
  assert.ok(spec.components.schemas.IntegrationThread);
  assert.ok(spec.components.schemas.IntegrationThreadListResponse);
  const params = spec.paths["/api/integration/projects/{projectId}/messages"].get.parameters.map((item) => item.name);
  assert.ok(params.includes("confirmed"));
  assert.ok(params.includes("priority"));
  assert.ok(params.includes("include"));
  const singleParams = spec.paths["/api/integration/projects/{projectId}/messages/{messageKey}"].get.parameters.map((item) => item.name);
  assert.ok(singleParams.includes("include"));
  const threadParams = spec.paths["/api/integration/projects/{projectId}/threads"].get.parameters.map((item) => item.name);
  assert.ok(threadParams.includes("include_messages"));
});
