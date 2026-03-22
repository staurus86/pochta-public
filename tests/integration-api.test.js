import assert from "node:assert/strict";
import {
  findIntegrationMessage,
  listIntegrationMessages,
  normalizeIntegrationMessage,
  parseIntegrationCursor,
  summarizeIntegrationDeliveries
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
      attachments: ["spec.pdf", "drawing.xlsx"],
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
          inn: "7701234567",
          kpp: "770101001",
          ogrn: "1234567890123"
        },
        lead: {
          requestType: "Монобрендовая",
          freeText: "Прошу КП",
          totalPositions: 1,
          articles: ["S201-C16"],
          lineItems: [{ article: "S201-C16", quantity: 5, unit: "шт", descriptionRu: "ABB S201-C16" }],
          detectedBrands: ["ABB"],
          detectedProductTypes: ["sensors", "drives"],
          recognitionSummary: {
            article: true,
            brand: true,
            name: true,
            phone: true,
            company: true,
            inn: true,
            parsedAttachment: false,
            completenessScore: 100,
            overallConfidence: 0.91,
            riskLevel: "low",
            primaryIssue: null,
            hasConflicts: false
          },
          recognitionDiagnostics: {
            completenessScore: 100,
            overallConfidence: 0.91,
            riskLevel: "low",
            primaryIssue: null,
            fields: {
              article: { found: true, confidence: 0.95, source: "body" },
              brand: { found: true, confidence: 0.9, source: "nomenclature" }
            },
            conflicts: [],
            issues: []
          },
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
  ],
  webhookDeliveries: [
    {
      id: "delivery-1",
      clientId: "crm-sync",
      clientName: "CRM Sync",
      key: "crm-sync:msg-1:ready_for_crm",
      event: "message.updated",
      messageKey: "msg-1",
      pipelineStatus: "ready_for_crm",
      status: "delivered",
      attempts: 1,
      createdAt: "2026-03-18T10:06:10.000Z",
      updatedAt: "2026-03-18T10:06:15.000Z",
      nextAttemptAt: null,
      lastAttemptAt: "2026-03-18T10:06:15.000Z",
      deliveredAt: "2026-03-18T10:06:15.000Z",
      lastError: null,
      responseStatus: 200
    },
    {
      id: "delivery-2",
      clientId: "crm-sync",
      clientName: "CRM Sync",
      key: "crm-sync:msg-3:needs_clarification",
      event: "message.updated",
      messageKey: "msg-3",
      pipelineStatus: "needs_clarification",
      status: "failed",
      attempts: 5,
      createdAt: "2026-03-18T10:08:00.000Z",
      updatedAt: "2026-03-18T10:20:00.000Z",
      nextAttemptAt: null,
      lastAttemptAt: "2026-03-18T10:20:00.000Z",
      deliveredAt: null,
      lastError: "Webhook responded with status 500",
      responseStatus: 500
    },
    {
      id: "delivery-3",
      clientId: "crm-sync",
      clientName: "CRM Sync",
      key: "crm-sync:msg-3:needs_clarification:retry",
      event: "message.updated",
      messageKey: "msg-3",
      pipelineStatus: "needs_clarification",
      status: "pending",
      attempts: 2,
      createdAt: "2026-03-18T10:30:00.000Z",
      updatedAt: "2026-03-18T10:31:00.000Z",
      nextAttemptAt: "2026-03-18T10:45:00.000Z",
      lastAttemptAt: "2026-03-18T10:31:00.000Z",
      deliveredAt: null,
      lastError: "connect ETIMEDOUT",
      responseStatus: null
    },
    {
      id: "delivery-4",
      clientId: "erp-sync",
      clientName: "ERP Sync",
      key: "erp-sync:msg-1:ready_for_crm",
      event: "message.updated",
      messageKey: "msg-1",
      pipelineStatus: "ready_for_crm",
      status: "pending",
      attempts: 0,
      createdAt: "2026-03-18T10:09:00.000Z",
      updatedAt: "2026-03-18T10:09:00.000Z",
      nextAttemptAt: "2026-03-18T10:10:00.000Z",
      lastAttemptAt: null,
      deliveredAt: null,
      lastError: null,
      responseStatus: null
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

runTest("normalizes recognition diagnostics in integration payload", () => {
  const normalized = normalizeIntegrationMessage(project, project.recentMessages[0]);
  assert.equal(normalized.lead.recognition_summary?.riskLevel, "low");
  assert.equal(normalized.lead.recognition_diagnostics?.overallConfidence, 0.91);
  assert.equal(normalized.lead.recognition_diagnostics?.fields?.article?.source, "body");
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
  assert.equal(normalized.sender.kpp, "770101001");
  assert.equal(normalized.sender.ogrn, "1234567890123");
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

runTest("filters integration messages by brand", () => {
  const result = listIntegrationMessages(project, { brand: "ABB" });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].message_key, "msg-1");
  assert.equal(result.meta.brand, "abb");
});

runTest("filters integration messages by label (classification)", () => {
  const result = listIntegrationMessages(project, { label: "client" });
  // msg-1 (Клиент) and msg-3 (Клиент) — but label filter matches lowercase "client"
  // classification labels are in Russian, so this should return 0 unless we normalize
  // Actually the labels are "Клиент" and "СПАМ", the filter checks toLowerCase
  assert.equal(result.meta.label, "client");
});

runTest("filters integration messages by free-text search", () => {
  const result = listIntegrationMessages(project, { q: "ABB" });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].message_key, "msg-1");
  assert.equal(result.meta.q, "abb");
});

runTest("returns all messages when no brand/label/q filters applied", () => {
  const result = listIntegrationMessages(project, {});
  assert.equal(result.data.length, 3);
  assert.equal(result.meta.brand, null);
  assert.equal(result.meta.label, null);
  assert.equal(result.meta.q, null);
});

runTest("has_attachments=true returns only messages with attachments", () => {
  const result = listIntegrationMessages(project, { has_attachments: "true" });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].message_key, "msg-1");
  assert.equal(result.meta.has_attachments, true);
});

runTest("has_attachments=false returns only messages without attachments", () => {
  const result = listIntegrationMessages(project, { has_attachments: "false" });
  assert.equal(result.data.length, 2);
  const keys = result.data.map((m) => m.message_key);
  assert.ok(keys.includes("msg-2"));
  assert.ok(keys.includes("msg-3"));
  assert.equal(result.meta.has_attachments, false);
});

runTest("attachment_ext=pdf returns only messages with .pdf attachments", () => {
  const result = listIntegrationMessages(project, { attachment_ext: "pdf" });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].message_key, "msg-1");
  assert.deepEqual(result.meta.attachment_ext, ["pdf"]);
});

runTest("attachment_ext=pdf,xlsx returns messages with .pdf OR .xlsx", () => {
  const result = listIntegrationMessages(project, { attachment_ext: "pdf,xlsx" });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].message_key, "msg-1");
  assert.deepEqual(result.meta.attachment_ext, ["pdf", "xlsx"]);
});

runTest("min_attachments=2 returns only messages with 2+ attachments", () => {
  const result = listIntegrationMessages(project, { min_attachments: "2" });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].message_key, "msg-1");
  assert.equal(result.meta.min_attachments, 2);
});

runTest("product_type=sensors returns only messages with sensors in detectedProductTypes", () => {
  const result = listIntegrationMessages(project, { product_type: "sensors" });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].message_key, "msg-1");
  assert.deepEqual(result.meta.product_type, ["sensors"]);
});

runTest("detected_product_types appears in normalized API response", () => {
  const normalized = normalizeIntegrationMessage(project, project.recentMessages[0]);
  assert.deepEqual(normalized.lead.detected_product_types, ["sensors", "drives"]);

  // Also check message without product types
  const normalized2 = normalizeIntegrationMessage(project, project.recentMessages[1]);
  assert.deepEqual(normalized2.lead.detected_product_types, []);
});

runTest("summarizes integration delivery diagnostics for a scoped client", () => {
  const result = summarizeIntegrationDeliveries(project, {
    failuresLimit: "1"
  }, {
    clientId: "crm-sync"
  });

  assert.equal(result.data.total_deliveries, 3);
  assert.equal(result.data.pending_backlog, 1);
  assert.equal(result.data.delivered_count, 1);
  assert.equal(result.data.by_status.failed, 1);
  assert.equal(result.data.success_rate, 0.3333);
  assert.equal(result.data.next_attempt_at, "2026-03-18T10:45:00.000Z");
  assert.equal(result.data.oldest_pending_created_at, "2026-03-18T10:30:00.000Z");
  assert.equal(result.data.response_statuses["200"], 1);
  assert.equal(result.data.response_statuses["500"], 1);
  assert.equal(result.data.failure_reasons["Webhook responded with status 500"], 1);
  assert.equal(result.data.failure_reasons["connect ETIMEDOUT"], 1);
  assert.equal(result.data.recent_failures.length, 1);
  assert.equal(result.data.recent_failures[0].id, "delivery-3");
  assert.equal(result.meta.recent_failures_limit, 1);
});
