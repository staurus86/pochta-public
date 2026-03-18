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
      note: "Imported"
    });

    assert.equal(acknowledged.integrationExport.consumer, "crm-sync");
    assert.equal(acknowledged.integrationExport.externalId, "REQ-77");
    assert.equal(acknowledged.integrationExports["crm-sync"].externalId, "REQ-77");
    assert.equal(acknowledged.auditLog.at(-1).action, "integration_ack");

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
      reason: "Retry after client fix"
    });

    assert.equal(requeued.status, "pending");
    assert.equal(requeued.responseStatus, null);
    assert.equal(requeued.lastError, null);
    assert.equal(requeued.lastManualAction.action, "requeue");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
