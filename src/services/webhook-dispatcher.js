import { createHmac, randomUUID } from "node:crypto";
import { normalizeIntegrationMessage } from "./integration-api.js";
import { getWebhookClients } from "./integration-clients.js";

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 5;

export class LegacyWebhookDispatcher {
  constructor({
    store,
    integrationClients = [],
    logger = console,
    intervalMs = DEFAULT_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS
  }) {
    this.store = store;
    this.integrationClients = integrationClients;
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.maxAttempts = maxAttempts;
    this.timer = null;
    this.isTicking = false;
  }

  isEnabled() {
    return this.integrationClients.some((client) => client.enabled && client.webhookUrl && client.webhookStatuses.length > 0);
  }

  start() {
    if (!this.isEnabled() || this.timer) {
      return;
    }

    this.tick().catch((error) => {
      this.logger.error("Webhook dispatcher bootstrap failed:", error);
    });

    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        this.logger.error("Webhook dispatcher tick failed:", error);
      });
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async enqueueProjectMessages(projectId, messages = []) {
    if (!this.isEnabled()) {
      return { added: 0, total: 0 };
    }

    const project = await this.store.getProject(projectId);
    if (!project) {
      return { added: 0, total: 0 };
    }

    const deliveries = messages.flatMap((message) => getWebhookClients(this.integrationClients, project.id, message)
      .map((client) => createWebhookDelivery(project, message, client)));

    if (deliveries.length === 0) {
      return { added: 0, total: 0 };
    }

    return this.store.enqueueWebhookDeliveries(projectId, deliveries);
  }

  async tick(now = new Date()) {
    if (!this.isEnabled() || this.isTicking) {
      return;
    }

    this.isTicking = true;
    try {
      const dueDeliveries = await this.store.getDueWebhookDeliveries(now.toISOString(), 20);
      for (const item of dueDeliveries) {
        await this.deliver(item.projectId, item.delivery, now);
      }
    } finally {
      this.isTicking = false;
    }
  }

  async deliver(projectId, delivery, now = new Date()) {
    const attemptedAt = now.toISOString();
    const attemptNumber = Number(delivery.attempts || 0) + 1;
    const client = this.integrationClients.find((item) => item.id === delivery.clientId);

    try {
      if (!client || !client.enabled || !client.webhookUrl) {
        throw new Error(`Webhook client '${delivery.clientId || "unknown"}' is not available`);
      }

      const payload = JSON.stringify(delivery.payload);
      const response = await fetch(client.webhookUrl, {
        method: "POST",
        headers: buildWebhookHeaders(payload, client.webhookSecret, delivery),
        body: payload,
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (!response.ok) {
        throw new Error(`Webhook responded with status ${response.status}`);
      }

      await this.store.updateWebhookDelivery(projectId, delivery.id, {
        status: "delivered",
        attempts: attemptNumber,
        lastAttemptAt: attemptedAt,
        deliveredAt: attemptedAt,
        updatedAt: attemptedAt,
        lastError: null,
        responseStatus: response.status,
        nextAttemptAt: null
      });
    } catch (error) {
      const finalFailure = attemptNumber >= this.maxAttempts;
      await this.store.updateWebhookDelivery(projectId, delivery.id, {
        status: finalFailure ? "failed" : "pending",
        attempts: attemptNumber,
        lastAttemptAt: attemptedAt,
        updatedAt: attemptedAt,
        lastError: error.message,
        nextAttemptAt: finalFailure ? null : computeNextAttemptAt(attemptNumber, now).toISOString()
      });
    }
  }
}

export function shouldEnqueueWebhook(message, statuses) {
  return normalizeStatuses(statuses).includes(String(message?.pipelineStatus || "").trim());
}

export function createWebhookDelivery(project, message, client) {
  const createdAt = new Date().toISOString();
  const payload = {
    event: "message.updated",
    occurred_at: createdAt,
    delivery_id: randomUUID(),
    client_id: client.id,
    project_id: project.id,
    message_key: message.messageKey || message.id,
    pipeline_status: message.pipelineStatus || "unknown",
    data: normalizeIntegrationMessage(project, message, { consumerId: client.id })
  };

  return {
    id: payload.delivery_id,
    clientId: client.id,
    clientName: client.name || client.id,
    key: `${client.id}:${payload.message_key}:${payload.pipeline_status}`,
    event: payload.event,
    messageKey: payload.message_key,
    pipelineStatus: payload.pipeline_status,
    status: "pending",
    attempts: 0,
    createdAt,
    updatedAt: createdAt,
    nextAttemptAt: createdAt,
    lastAttemptAt: null,
    deliveredAt: null,
    lastError: null,
    responseStatus: null,
    payload
  };
}

export function computeNextAttemptAt(attemptNumber, now = new Date()) {
  const backoffMs = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
  const delay = backoffMs[Math.max(0, Math.min(attemptNumber - 1, backoffMs.length - 1))];
  return new Date(now.getTime() + delay);
}

export function buildWebhookHeaders(payload, secret, delivery) {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "pochta-legacy-webhook/1.0",
    "X-Pochta-Event": delivery.event,
    "X-Pochta-Delivery-Id": delivery.id,
    "X-Pochta-Client-Id": delivery.clientId || ""
  };

  if (secret) {
    headers["X-Pochta-Signature"] = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  }

  return headers;
}

export function normalizeStatuses(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
