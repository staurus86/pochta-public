/**
 * CRM Sync Service — pushes ready_for_crm messages to configured CRM,
 * auto-acknowledges on success, tracks sync status.
 *
 * Config via project.crmConfig:
 *   { enabled, type, baseUrl, apiKey, ...typeSpecificFields }
 *
 * Or via env vars:
 *   CRM_ENABLED=true, CRM_TYPE=amocrm, CRM_BASE_URL=..., CRM_API_KEY=...
 */

import { buildCrmPayload, buildCrmRequest, parseCrmResponse } from "./crm-adapters.js";

const CRM_TIMEOUT_MS = Number(process.env.CRM_TIMEOUT_MS || 15000);

/**
 * Get CRM config for a project (project-level overrides env-level).
 */
export function getCrmConfig(project) {
  if (project?.crmConfig?.enabled) {
    return project.crmConfig;
  }

  if (process.env.CRM_ENABLED === "true") {
    return {
      enabled: true,
      type: process.env.CRM_TYPE || "generic",
      baseUrl: process.env.CRM_BASE_URL || "",
      apiKey: process.env.CRM_API_KEY || "",
      pipelineId: process.env.CRM_PIPELINE_ID ? Number(process.env.CRM_PIPELINE_ID) : null,
      statusId: process.env.CRM_STATUS_ID ? Number(process.env.CRM_STATUS_ID) : null,
      responsibleUserId: process.env.CRM_RESPONSIBLE_USER_ID || null,
      responsibleId: process.env.CRM_RESPONSIBLE_ID || null,
      sourceId: process.env.CRM_SOURCE_ID || "EMAIL"
    };
  }

  return { enabled: false };
}

/**
 * Push a single normalized message to CRM.
 * Returns { success, externalId, error, crmType }.
 */
export async function pushToCrm(normalizedMessage, crmConfig) {
  if (!crmConfig?.enabled || !crmConfig.baseUrl) {
    return { success: false, error: "CRM not configured", crmType: null };
  }

  const crmType = crmConfig.type || "generic";

  try {
    const payload = buildCrmPayload(crmType, normalizedMessage, crmConfig);
    const reqOpts = buildCrmRequest(crmType, crmConfig.baseUrl, crmConfig.apiKey, payload);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CRM_TIMEOUT_MS);

    const response = await fetch(reqOpts.url, {
      method: reqOpts.method,
      headers: reqOpts.headers,
      body: reqOpts.body,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        success: false,
        error: `CRM HTTP ${response.status}: ${errText.slice(0, 200)}`,
        crmType,
        httpStatus: response.status
      };
    }

    const responseData = await response.json().catch(() => ({}));
    const parsed = parseCrmResponse(crmType, responseData);

    return {
      success: parsed.success,
      externalId: parsed.externalId,
      crmType,
      httpStatus: response.status
    };
  } catch (error) {
    return {
      success: false,
      error: error.name === "AbortError" ? "CRM timeout" : error.message,
      crmType
    };
  }
}

/**
 * Sync all unsynced ready_for_crm messages for a project.
 * Auto-acknowledges messages on successful push.
 *
 * @param {object} project - Project with recentMessages
 * @param {object} store - ProjectsStore instance
 * @param {function} normalizeMessage - normalizeIntegrationMessage function
 * @param {object} options - { limit, dryRun }
 */
export async function syncProjectToCrm(project, store, normalizeMessage, options = {}) {
  const config = getCrmConfig(project);
  if (!config.enabled) {
    return { synced: 0, failed: 0, skipped: 0, error: "CRM not enabled" };
  }

  const limit = options.limit || 50;
  const dryRun = options.dryRun || process.env.SYNC_DRY_RUN === "true";
  const consumerId = `crm-${config.type}`;

  // Find unsynced ready_for_crm messages
  const candidates = (project.recentMessages || [])
    .filter((m) => m.pipelineStatus === "ready_for_crm")
    .filter((m) => {
      const exports = m.integrationExports || {};
      return !exports[consumerId]?.acknowledgedAt;
    })
    .slice(0, limit);

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const results = [];

  for (const msg of candidates) {
    const messageKey = msg.messageKey || msg.id;
    const normalized = normalizeMessage(project, msg, { consumerId });

    if (dryRun) {
      results.push({ messageKey, status: "dry_run" });
      skipped++;
      continue;
    }

    const pushResult = await pushToCrm(normalized, config);

    if (pushResult.success) {
      // Auto-acknowledge
      await store.acknowledgeMessageExport(project.id, messageKey, {
        consumer: consumerId,
        externalId: pushResult.externalId || null,
        note: `Auto-synced to ${config.type}: ${pushResult.externalId || "ok"}`
      });
      synced++;
      results.push({ messageKey, status: "synced", externalId: pushResult.externalId });
    } else {
      failed++;
      results.push({ messageKey, status: "failed", error: pushResult.error });
    }
  }

  return {
    synced,
    failed,
    skipped,
    total: candidates.length,
    crmType: config.type,
    dryRun,
    results
  };
}
