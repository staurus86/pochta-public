import assert from "node:assert/strict";
import {
  findIntegrationMessage,
  listIntegrationMessages,
  normalizeIntegrationMessage,
  parseIntegrationCursor
} from "../src/services/integration-api.js";
import { canClientAccessProject, isIntegrationAuthorized, loadIntegrationClients, resolveIntegrationClient } from "../src/services/integration-clients.js";

const project = {
  id: "project-3-mailbox-file",
  name: "Project 3 Mailbox File Parser",
  type: "mailbox-file-parser",
  mailbox: "multi-mailbox@project3.local",
  recentMessages: [
    {
      messageKey: "msg-1",
      createdAt: "2026-03-18T10:00:00.000Z",
      updatedAt: "2026-03-18T10:05:00.000Z",
      mailbox: "sales@example.com",
      brand: "ABB",
      subject: "Запрос по ABB",
      from: "Иван Петров <ivan@example.com>",
      bodyPreview: "Прошу КП",
      pipelineStatus: "ready_for_crm",
      attachments: ["spec.pdf"],
      auditLog: [{ action: "status_change", at: "2026-03-18T10:06:00.000Z" }],
      integrationExport: {
        acknowledgedAt: "2026-03-18T10:07:00.000Z",
        consumer: "crm-sync",
        externalId: "REQ-42",
        note: "Imported"
      },
      integrationExports: {
        "crm-sync": {
          acknowledgedAt: "2026-03-18T10:07:00.000Z",
          consumer: "crm-sync",
          externalId: "REQ-42",
          note: "Imported"
        },
        "erp-sync": {
          acknowledgedAt: "2026-03-18T10:08:00.000Z",
          consumer: "erp-sync",
          externalId: "ERP-99",
          note: "Exported"
        }
      },
      analysis: {
        detectedBrands: ["ABB"],
        classification: { label: "Клиент", confidence: 0.91 },
        sender: {
          email: "ivan@example.com",
          fullName: "Иван Петров",
          position: "Менеджер",
          companyName: "ООО Ромашка",
          website: "https://romashka.ru",
          cityPhone: "+7 (495) 123-45-67",
          mobilePhone: null,
          inn: "7701234567"
        },
        lead: {
          requestType: "Монобрендовая",
          freeText: "Прошу КП",
          totalPositions: 1,
          articles: ["S201-C16"],
          lineItems: [{ article: "S201-C16", quantity: 5, unit: "шт", descriptionRu: "ABB S201-C16" }],
          detectedBrands: ["ABB"],
          hasNameplatePhotos: false,
          hasArticlePhotos: false
        },
        crm: {
          isExistingCompany: true,
          needsClarification: false,
          curatorMop: "Ольга",
          curatorMoz: "Андрей",
          company: {
            id: "client-1",
            legalName: "ООО Ромашка",
            inn: "7701234567",
            domain: "romashka.ru"
          }
        },
        suggestedReply: "Спасибо за заявку"
      }
    },
    {
      messageKey: "msg-2",
      createdAt: "2026-03-17T10:00:00.000Z",
      updatedAt: "2026-03-17T10:16:00.000Z",
      subject: "Спам",
      from: "spam@example.com",
      pipelineStatus: "ignored_spam",
      auditLog: [{ action: "status_change", at: "2026-03-17T10:15:00.000Z" }],
      analysis: {
        classification: { label: "СПАМ", confidence: 0.99 },
        sender: {},
        lead: {},
        crm: {}
      }
    },
    {
      messageKey: "msg-3",
      createdAt: "2026-03-18T10:01:00.000Z",
      updatedAt: "2026-03-18T10:06:00.000Z",
      subject: "Нужен счет",
      from: "buyer@example.com",
      pipelineStatus: "needs_clarification",
      auditLog: [{ action: "status_change", at: "2026-03-18T10:06:00.000Z" }],
      analysis: {
        classification: { label: "Клиент", confidence: 0.8 },
        sender: {
          email: "buyer@example.com"
        },
        lead: {
          articles: ["A-100"]
        },
        crm: {}
      }
    }
  ]
};

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

runTest("authorizes integration requests by x-api-key and bearer token", () => {
  assert.equal(isIntegrationAuthorized({ "x-api-key": "secret" }, "secret"), true);
  assert.equal(isIntegrationAuthorized({ authorization: "Bearer secret" }, "secret"), true);
  assert.equal(isIntegrationAuthorized({ authorization: "Bearer wrong" }, "secret"), false);
});

runTest("resolves integration clients and project scopes", () => {
  const clients = loadIntegrationClients({
    LEGACY_INTEGRATION_CLIENTS_JSON: JSON.stringify([{
      id: "crm-sync",
      name: "CRM Sync",
      apiKey: "crm-key",
      projectIds: ["project-3-mailbox-file"]
    }])
  });

  const client = resolveIntegrationClient({ "x-api-key": "crm-key" }, clients);
  assert.equal(client.id, "crm-sync");
  assert.equal(canClientAccessProject(client, "project-3-mailbox-file"), true);
  assert.equal(canClientAccessProject(client, "project-2-tender-parser"), false);
});

runTest("normalizes integration message shape", () => {
  const normalized = normalizeIntegrationMessage(project, project.recentMessages[0], { consumerId: "crm-sync" });

  assert.equal(normalized.project_id, "project-3-mailbox-file");
  assert.equal(normalized.message_key, "msg-1");
  assert.equal(normalized.updated_at, "2026-03-18T10:06:00.000Z");
  assert.equal(normalized.classification.label, "Клиент");
  assert.deepEqual(normalized.lead.articles, ["S201-C16"]);
  assert.equal(normalized.crm.company.legal_name, "ООО Ромашка");
  assert.equal(normalized.attachments[0].download_url, "/api/attachments/msg-1/spec.pdf");
  assert.equal(normalized.export.acknowledged, true);
  assert.equal(normalized.export.external_id, "REQ-42");
});

runTest("lists integration messages with pagination and status filter", () => {
  const result = listIntegrationMessages(project, { page: "1", limit: "1", status: "ready_for_crm" });

  assert.equal(result.data.length, 1);
  assert.equal(result.pagination.total, 1);
  assert.equal(result.data[0].message_key, "msg-1");
  assert.equal(result.meta.next_since, "2026-03-18T10:06:00.000Z");
});

runTest("filters integration messages by since and multiple statuses", () => {
  const result = listIntegrationMessages(project, {
    since: "2026-03-18T00:00:00.000Z",
    status: "ready_for_crm,needs_clarification"
  });

  assert.equal(result.data.length, 2);
  assert.deepEqual(result.data.map((item) => item.message_key), ["msg-3", "msg-1"]);
  assert.deepEqual(result.meta.statuses, ["ready_for_crm", "needs_clarification"]);
});

runTest("filters integration messages by export acknowledgement", () => {
  const result = listIntegrationMessages(project, {
    exported: "true"
  }, {
    consumerId: "crm-sync"
  });

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].message_key, "msg-1");
  assert.equal(result.meta.exported, true);
});

runTest("supports cursor-based integration pagination with stable ordering", () => {
  const firstPage = listIntegrationMessages(project, {
    limit: "1",
    status: "ready_for_crm,needs_clarification,ignored_spam"
  });

  assert.equal(firstPage.data.length, 1);
  assert.equal(firstPage.data[0].message_key, "msg-3");
  assert.ok(firstPage.meta.next_cursor);

  const cursor = parseIntegrationCursor(firstPage.meta.next_cursor);
  assert.deepEqual(cursor, {
    updatedAt: "2026-03-18T10:06:00.000Z",
    messageKey: "msg-3"
  });

  const secondPage = listIntegrationMessages(project, {
    limit: "1",
    status: "ready_for_crm,needs_clarification,ignored_spam",
    cursor: firstPage.meta.next_cursor
  });

  assert.equal(secondPage.pagination.page, null);
  assert.equal(secondPage.data.length, 1);
  assert.equal(secondPage.data[0].message_key, "msg-1");
  assert.ok(secondPage.meta.next_cursor);
});

runTest("returns null for invalid integration cursors", () => {
  assert.equal(parseIntegrationCursor("not-a-cursor"), null);
});

runTest("finds a single normalized integration message", () => {
  const message = findIntegrationMessage(project, "msg-1", { consumerId: "erp-sync" });

  assert.equal(message.message_key, "msg-1");
  assert.equal(message.sender.email, "ivan@example.com");
  assert.equal(message.export.external_id, "ERP-99");
});
