import assert from "node:assert/strict";
import {
  buildWebhookHeaders,
  computeNextAttemptAt,
  createWebhookDelivery,
  normalizeStatuses,
  shouldEnqueueWebhook
} from "../src/services/webhook-dispatcher.js";

const project = {
  id: "project-3-mailbox-file",
  name: "Project 3 Mailbox File Parser",
  mailbox: "multi-mailbox@project3.local"
};

const message = {
  messageKey: "msg-1",
  createdAt: "2026-03-18T10:00:00.000Z",
  subject: "Запрос по ABB",
  from: "Иван Петров <ivan@example.com>",
  pipelineStatus: "ready_for_crm",
  analysis: {
    classification: { label: "Клиент", confidence: 0.91 },
    sender: { email: "ivan@example.com" },
    lead: { articles: ["S201-C16"], lineItems: [] },
    crm: {}
  }
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

runTest("normalizes webhook statuses", () => {
  assert.deepEqual(normalizeStatuses("ready_for_crm,needs_clarification"), ["ready_for_crm", "needs_clarification"]);
});

runTest("checks whether message should be enqueued for webhook", () => {
  assert.equal(shouldEnqueueWebhook(message, ["ready_for_crm"]), true);
  assert.equal(shouldEnqueueWebhook(message, ["needs_clarification"]), false);
});

runTest("creates webhook delivery payload and key", () => {
  const delivery = createWebhookDelivery(project, message, {
    id: "crm-sync",
    name: "CRM Sync"
  });

  assert.equal(delivery.key, "crm-sync:msg-1:ready_for_crm");
  assert.equal(delivery.clientId, "crm-sync");
  assert.equal(delivery.payload.message_key, "msg-1");
  assert.equal(delivery.payload.data.classification.label, "Клиент");
});

runTest("builds signed webhook headers", () => {
  const delivery = createWebhookDelivery(project, message, {
    id: "crm-sync",
    name: "CRM Sync"
  });
  const headers = buildWebhookHeaders(JSON.stringify(delivery.payload), "secret", delivery);

  assert.equal(headers["X-Pochta-Event"], "message.updated");
  assert.equal(headers["X-Pochta-Delivery-Id"], delivery.id);
  assert.equal(headers["X-Pochta-Client-Id"], "crm-sync");
  assert.match(headers["X-Pochta-Signature"], /^sha256=/);
});

runTest("computes retry backoff", () => {
  const next = computeNextAttemptAt(2, new Date("2026-03-18T10:00:00.000Z"));
  assert.equal(next.toISOString(), "2026-03-18T10:05:00.000Z");
});
