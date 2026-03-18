export function loadIntegrationClients(env = process.env) {
  const clients = parseIntegrationClientsJson(env.LEGACY_INTEGRATION_CLIENTS_JSON);
  if (clients.length > 0) {
    return clients;
  }

  const legacyApiKey = String(env.LEGACY_INTEGRATION_API_KEY || env.INTEGRATION_API_KEY || "").trim();
  if (!legacyApiKey) {
    return [];
  }

  return [{
    id: "legacy-default",
    name: "Legacy Default",
    apiKey: legacyApiKey,
    enabled: true,
    projectIds: [],
    webhookUrl: String(env.LEGACY_WEBHOOK_URL || "").trim() || null,
    webhookSecret: String(env.LEGACY_WEBHOOK_SECRET || "").trim() || "",
    webhookStatuses: normalizeClientStatuses(env.LEGACY_WEBHOOK_STATUSES || "ready_for_crm,needs_clarification")
  }];
}

export function resolveIntegrationClient(headers, clients) {
  const apiKey = extractApiKey(headers);
  if (!apiKey) {
    return null;
  }

  return clients.find((client) => client.enabled && client.apiKey === apiKey) || null;
}

export function isIntegrationAuthorized(headers, apiKeyOrClients) {
  if (Array.isArray(apiKeyOrClients)) {
    return Boolean(resolveIntegrationClient(headers, apiKeyOrClients));
  }

  const apiKey = String(apiKeyOrClients || "").trim();
  if (!apiKey) {
    return false;
  }

  return extractApiKey(headers) === apiKey;
}

export function canClientAccessProject(client, projectId) {
  const projectIds = Array.isArray(client?.projectIds) ? client.projectIds : [];
  if (projectIds.length === 0) {
    return true;
  }

  return projectIds.includes(projectId);
}

export function getWebhookClients(clients, projectId, message) {
  return clients.filter((client) => {
    if (!client.enabled || !client.webhookUrl) {
      return false;
    }

    if (!canClientAccessProject(client, projectId)) {
      return false;
    }

    return client.webhookStatuses.includes(String(message?.pipelineStatus || "").trim());
  });
}

function parseIntegrationClientsJson(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeClient)
      .filter((client) => client && client.enabled && client.apiKey);
  } catch {
    return [];
  }
}

function normalizeClient(input, index) {
  const apiKey = String(input?.apiKey || "").trim();
  if (!apiKey) {
    return null;
  }

  const id = String(input?.id || `client-${index + 1}`).trim();
  return {
    id,
    name: String(input?.name || id).trim(),
    apiKey,
    enabled: input?.enabled !== false,
    projectIds: normalizeStringArray(input?.projectIds),
    webhookUrl: String(input?.webhookUrl || "").trim() || null,
    webhookSecret: String(input?.webhookSecret || "").trim() || "",
    webhookStatuses: normalizeClientStatuses(input?.webhookStatuses || "ready_for_crm,needs_clarification")
  };
}

function extractApiKey(headers = {}) {
  const headerKey = String(headers["x-api-key"] || "").trim();
  const authorization = String(headers.authorization || "").trim();
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const bearerKey = bearerMatch?.[1]?.trim() || "";
  return headerKey || bearerKey || "";
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeClientStatuses(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
