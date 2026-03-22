export const LEGACY_INTEGRATION_API_VERSION = "1.6.0";

const CHANGELOG = [
  {
    version: "1.6.0",
    released_at: "2026-03-22",
    changes: [
      "Added incremental integration event feed for message, thread, and delivery changes.",
      "Added export endpoints for filtered event feeds in JSON, JSONL, and CSV formats."
    ]
  },
  {
    version: "1.5.0",
    released_at: "2026-03-22",
    changes: [
      "Added thread-level integration endpoints for grouped email conversations.",
      "Added export endpoints for filtered parsed messages in JSON, JSONL, and CSV formats."
    ]
  },
  {
    version: "1.4.0",
    released_at: "2026-03-22",
    changes: [
      "Expanded normalized message payloads with message_meta, attachment analysis, extraction metadata, and audit blocks.",
      "Added quality-oriented message filters and aggregate endpoints for message stats, field coverage, and problem queues."
    ]
  },
  {
    version: "1.3.0",
    released_at: "2026-03-18",
    changes: [
      "Added sender.kpp and sender.ogrn to normalized integration message payloads.",
      "Improved brand, requisites, phone, and article extraction in the legacy email parser."
    ]
  },
  {
    version: "1.2.0",
    released_at: "2026-03-18",
    changes: [
      "Added webhook delivery diagnostics endpoint.",
      "Published machine-readable changelog and version policy."
    ]
  },
  {
    version: "1.1.0",
    released_at: "2026-03-18",
    changes: [
      "Added Idempotency-Key support for ack and requeue actions."
    ]
  },
  {
    version: "1.0.0",
    released_at: "2026-03-18",
    changes: [
      "Published versioned OpenAPI contract for the legacy integration API."
    ]
  }
];

export function getLegacyIntegrationApiVersion() {
  return LEGACY_INTEGRATION_API_VERSION;
}

export function getLegacyIntegrationChangelog() {
  return CHANGELOG.map((entry) => ({
    ...entry,
    changes: [...entry.changes]
  }));
}

export function buildLegacyIntegrationChangelogDocument(basePath = "") {
  const prefix = normalizeBasePath(basePath);

  return {
    name: "Pochta Legacy Integration API",
    current_version: LEGACY_INTEGRATION_API_VERSION,
    openapi_url: `${prefix}/api/integration/openapi.v1.json`,
    changelog_url: `${prefix}/api/integration/changelog`,
    policy: {
      stability: "versioned-v1",
      additive_changes: "New optional fields, filters, and endpoints may be added within v1 without breaking existing clients.",
      breaking_changes: "Breaking changes require a new versioned contract and a new versioned OpenAPI document.",
      deprecation_notice_days: 90,
      retry_safety: {
        ack: "Supported via Idempotency-Key header or idempotencyKey request field.",
        requeue: "Supported via Idempotency-Key header or idempotencyKey request field."
      }
    },
    changelog: getLegacyIntegrationChangelog()
  };
}

function normalizeBasePath(basePath) {
  const value = String(basePath || "").trim().replace(/\/+$/, "");
  return value;
}
