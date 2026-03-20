import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { ProjectsStore } from "../src/storage/projects-store.js";

function runTest(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS ${name}`))
    .catch((error) => {
      console.error(`FAIL ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

runTest("acknowledges message export and requeues webhook delivery", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "pochta-store-"));

  try {
    const store = new ProjectsStore({ dataDir });
    await store.ensureLoaded();

    const project = await store.createProject({
      name: "Integration Test Project",
      mailbox: "integration@example.com"
    });

    await store.replaceRecentMessages(project.id, [
      {
        messageKey: "msg-1",
        createdAt: "2026-03-18T10:00:00.000Z",
        pipelineStatus: "ready_for_crm",
        analysis: {
          classification: { label: "Клиент", confidence: 0.9 },
          sender: { email: "buyer@example.com" },
          lead: { articles: [], lineItems: [] },
          crm: {}
        }
      }
    ]);

    const acknowledged = await store.acknowledgeMessageExport(project.id, "msg-1", {
      consumer: "crm-sync",
      externalId: "REQ-77",
      note: "Imported",
      idempotencyKey: "ack-1"
    });

    assert.equal(acknowledged.integrationExport.consumer, "crm-sync");
    assert.equal(acknowledged.integrationExport.externalId, "REQ-77");
    assert.equal(acknowledged.integrationExports["crm-sync"].externalId, "REQ-77");
    assert.equal(acknowledged.auditLog.at(-1).action, "integration_ack");

    const firstAckAt = acknowledged.integrationExport.acknowledgedAt;
    const firstAuditCount = acknowledged.auditLog.length;
    const repeatedAck = await store.acknowledgeMessageExport(project.id, "msg-1", {
      consumer: "crm-sync",
      externalId: "REQ-77",
      note: "Imported",
      idempotencyKey: "ack-1"
    });

    assert.equal(repeatedAck.integrationExport.acknowledgedAt, firstAckAt);
    assert.equal(repeatedAck.auditLog.length, firstAuditCount);

    await store.enqueueWebhookDeliveries(project.id, [{
      id: "delivery-1",
      key: "msg-1:ready_for_crm",
      event: "message.updated",
      messageKey: "msg-1",
      pipelineStatus: "ready_for_crm",
      status: "failed",
      attempts: 5,
      createdAt: "2026-03-18T10:00:00.000Z",
      updatedAt: "2026-03-18T10:01:00.000Z",
      nextAttemptAt: null,
      lastAttemptAt: "2026-03-18T10:01:00.000Z",
      deliveredAt: null,
      lastError: "Webhook responded with status 500",
      responseStatus: 500,
      payload: { event: "message.updated" }
    }]);

    const requeued = await store.requeueWebhookDelivery(project.id, "delivery-1", {
      reason: "Retry after client fix",
      idempotencyKey: "requeue-1"
    });

    assert.equal(requeued.status, "pending");
    assert.equal(requeued.responseStatus, null);
    assert.equal(requeued.lastError, null);
    assert.equal(requeued.lastManualAction.action, "requeue");

    const firstRequeueAt = requeued.updatedAt;
    const repeatedRequeue = await store.requeueWebhookDelivery(project.id, "delivery-1", {
      reason: "Retry after client fix",
      idempotencyKey: "requeue-1"
    });

    assert.equal(repeatedRequeue.updatedAt, firstRequeueAt);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

runTest("applies manual feedback to message brands and classification", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "pochta-store-fb-"));

  try {
    const store = new ProjectsStore({ dataDir });
    await store.ensureLoaded();

    const project = await store.createProject({
      name: "Feedback Test",
      mailbox: "feedback@example.com"
    });

    await store.replaceRecentMessages(project.id, [
      {
        messageKey: "fb-1",
        pipelineStatus: "ready_for_crm",
        analysis: {
          classification: { label: "Клиент", confidence: 0.7 },
          detectedBrands: ["ABB"],
          sender: { email: "test@corp.ru", companyName: "" }
        }
      }
    ]);

    // Add brand
    const r1 = await store.applyMessageFeedback(project.id, "fb-1", {
      addBrands: ["Siemens"],
      companyName: "ООО Ромашка"
    });

    assert.ok(r1.changes.includes("+brand:Siemens"));
    assert.ok(r1.changes.some((c) => c.startsWith("company:")));
    assert.deepEqual(r1.analysis.detectedBrands, ["ABB", "Siemens"]);
    assert.equal(r1.analysis.sender.companyName, "ООО Ромашка");

    // Remove brand
    const r2 = await store.applyMessageFeedback(project.id, "fb-1", {
      removeBrands: ["ABB"]
    });

    assert.ok(r2.changes.includes("-brand:ABB"));
    assert.deepEqual(r2.analysis.detectedBrands, ["Siemens"]);

    // Verify audit log
    const p = await store.getProject(project.id);
    const msg = p.recentMessages[0];
    assert.equal(msg.auditLog.length, 2);
    assert.equal(msg.auditLog[0].action, "manual_feedback");
    assert.equal(msg.feedbackApplied.length, 2);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

runTest("bulk acknowledges multiple messages at once", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "pochta-store-bulk-"));

  try {
    const store = new ProjectsStore({ dataDir });
    await store.ensureLoaded();

    const project = await store.createProject({
      name: "Bulk ACK Test",
      mailbox: "bulk@example.com"
    });

    await store.replaceRecentMessages(project.id, [
      { messageKey: "bulk-1", pipelineStatus: "ready_for_crm", analysis: { classification: { label: "Клиент" } } },
      { messageKey: "bulk-2", pipelineStatus: "ready_for_crm", analysis: { classification: { label: "Клиент" } } }
    ]);

    const results = await store.bulkAcknowledgeExport(project.id, [
      { messageKey: "bulk-1", externalId: "EXT-1" },
      { messageKey: "bulk-2", externalId: "EXT-2" },
      { messageKey: "bulk-missing" }
    ], { consumer: "crm" });

    assert.equal(results.length, 3);
    assert.equal(results[0].messageKey, "bulk-1");
    assert.equal(results[0].acknowledged, true);
    assert.equal(results[1].messageKey, "bulk-2");
    assert.equal(results[1].acknowledged, true);
    assert.equal(results[2].messageKey, "bulk-missing");
    assert.equal(results[2].acknowledged, false);
    assert.equal(results[2].error, "not_found");

    // Verify export state persisted
    const p = await store.getProject(project.id);
    const m1 = p.recentMessages.find((m) => m.messageKey === "bulk-1");
    assert.equal(m1.integrationExport.externalId, "EXT-1");
    assert.equal(m1.integrationExport.consumer, "crm");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
