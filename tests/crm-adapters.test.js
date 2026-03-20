import assert from "node:assert/strict";
import { buildCrmPayload, buildCrmRequest, parseCrmResponse } from "../src/services/crm-adapters.js";
import { getCrmConfig } from "../src/services/crm-sync.js";

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

const sampleMessage = {
  message_key: "msg-123",
  project_id: "project-3",
  subject: "Запрос КП на ABB ACS580",
  mailbox: "sales@example.com",
  body_preview: "Прошу КП на привод ABB ACS580-01-12A7",
  detected_brands: ["ABB"],
  sender: {
    email: "buyer@corp.ru",
    full_name: "Иван Петров",
    company_name: "ООО Ромашка",
    city_phone: "+7 (495) 123-45-67",
    mobile_phone: "+7 (999) 888-77-66",
    position: "Менеджер",
    inn: "7701234567"
  },
  lead: {
    request_type: "Монобрендовая",
    articles: ["ACS580-01-12A7"],
    total_positions: 1,
    line_items: [{ article: "ACS580-01-12A7", quantity: 2, unit: "шт", description_ru: "Привод ABB" }]
  },
  crm: {
    is_existing_company: true,
    curator_mop: "Ольга",
    curator_moz: "Андрей"
  }
};

runTest("builds amoCRM lead payload", () => {
  const payload = buildCrmPayload("amocrm", sampleMessage, { pipelineId: 12345 });
  assert.ok(payload.name.includes("ABB ACS580"));
  assert.equal(payload.pipeline_id, 12345);
  assert.equal(payload._embedded.contacts[0].first_name, "Иван Петров");
  assert.equal(payload._embedded.companies[0].name, "ООО Ромашка");
  assert.equal(payload._metadata.pochta_message_key, "msg-123");
});

runTest("builds Bitrix24 lead payload", () => {
  const payload = buildCrmPayload("bitrix24", sampleMessage, { statusId: "NEW" });
  assert.ok(payload.fields.TITLE.includes("ABB ACS580"));
  assert.equal(payload.fields.STATUS_ID, "NEW");
  assert.equal(payload.fields.NAME, "Иван Петров");
  assert.ok(payload.fields.COMMENTS.includes("ABB"));
  assert.equal(payload.fields.UF_CRM_POCHTA_KEY, "msg-123");
});

runTest("builds 1C payload", () => {
  const payload = buildCrmPayload("1c", sampleMessage);
  assert.equal(payload.type, "incoming_request");
  assert.equal(payload.sender.inn, "7701234567");
  assert.equal(payload.request.brands[0], "ABB");
  assert.equal(payload.request.lineItems[0].article, "ACS580-01-12A7");
});

runTest("builds generic payload", () => {
  const payload = buildCrmPayload("generic", sampleMessage);
  assert.equal(payload.event, "message.ready_for_crm");
  assert.equal(payload.message.message_key, "msg-123");
});

runTest("builds CRM request with correct auth headers", () => {
  const req = buildCrmRequest("amocrm", "https://crm.example.com", "token123", {});
  assert.ok(req.url.includes("/api/v4/leads/complex"));
  assert.equal(req.headers.Authorization, "Bearer token123");

  const req2 = buildCrmRequest("bitrix24", "https://b24.example.com", "webhook_key", {});
  assert.ok(req2.url.includes("/rest/webhook_key/crm.lead.add.json"));

  const req3 = buildCrmRequest("1c", "https://1c.example.com", "dXNlcjpwYXNz", {});
  assert.ok(req3.url.includes("/hs/pochta/incoming"));
  assert.equal(req3.headers.Authorization, "Basic dXNlcjpwYXNz");
});

runTest("parses CRM responses to extract external IDs", () => {
  assert.deepEqual(parseCrmResponse("amocrm", { id: 42 }), { externalId: "42", success: true });
  assert.deepEqual(parseCrmResponse("bitrix24", { result: 99 }), { externalId: "99", success: true });
  assert.deepEqual(parseCrmResponse("1c", { documentId: "DOC-001" }), { externalId: "DOC-001", success: true });
  assert.deepEqual(parseCrmResponse("generic", { id: "ext-1" }), { externalId: "ext-1", success: true });
});

runTest("getCrmConfig returns disabled when no env set", () => {
  const config = getCrmConfig({});
  assert.equal(config.enabled, false);
});

runTest("getCrmConfig uses project-level config when available", () => {
  const project = { crmConfig: { enabled: true, type: "amocrm", baseUrl: "https://crm.test", apiKey: "key" } };
  const config = getCrmConfig(project);
  assert.equal(config.enabled, true);
  assert.equal(config.type, "amocrm");
});
