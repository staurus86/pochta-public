export function isIntegrationAuthorized(headers, apiKey) {
  if (!apiKey) {
    return false;
  }

  const headerKey = String(headers["x-api-key"] || "").trim();
  const authorization = String(headers.authorization || "").trim();
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const bearerKey = bearerMatch?.[1]?.trim() || "";

  return headerKey === apiKey || bearerKey === apiKey;
}

export function normalizeIntegrationMessage(project, message) {
  const analysis = message.analysis || {};
  const classification = analysis.classification || {};
  const sender = analysis.sender || {};
  const lead = analysis.lead || {};
  const crm = analysis.crm || {};
  const messageKey = message.messageKey || message.id;
  const updatedAt = resolveMessageUpdatedAt(message);

  return {
    project_id: project.id,
    project_name: project.name,
    message_key: messageKey,
    created_at: message.createdAt || null,
    updated_at: updatedAt,
    mailbox: message.mailbox || project.mailbox || null,
    brand: message.brand || null,
    subject: message.subject || "",
    from: message.from || "",
    body_preview: message.bodyPreview || "",
    pipeline_status: message.pipelineStatus || "unknown",
    export: {
      acknowledged: Boolean(message.integrationExport?.acknowledgedAt),
      acknowledged_at: message.integrationExport?.acknowledgedAt || null,
      consumer: message.integrationExport?.consumer || null,
      external_id: message.integrationExport?.externalId || null,
      note: message.integrationExport?.note || null
    },
    error: message.error || null,
    attachments: (message.attachmentFiles || message.attachments || []).map((item) => {
      if (typeof item === "string") {
        return {
          filename: item,
          download_url: `/api/attachments/${encodeURIComponent(messageKey)}/${encodeURIComponent(item)}`
        };
      }

      const filename = item.filename || item.name || "";
      const safeName = item.safeName || filename;
      return {
        filename,
        content_type: item.contentType || null,
        size: item.size || null,
        safe_name: item.safeName || null,
        download_url: safeName
          ? `/api/attachments/${encodeURIComponent(messageKey)}/${encodeURIComponent(safeName)}`
          : null
      };
    }),
    classification: {
      label: classification.label || null,
      confidence: classification.confidence ?? null,
      detected_brands: analysis.detectedBrands || []
    },
    sender: {
      email: sender.email || null,
      full_name: sender.fullName || null,
      position: sender.position || null,
      company_name: sender.companyName || null,
      website: sender.website || null,
      city_phone: sender.cityPhone || null,
      mobile_phone: sender.mobilePhone || null,
      inn: sender.inn || null
    },
    lead: {
      request_type: lead.requestType || null,
      free_text: lead.freeText || "",
      total_positions: lead.totalPositions || 0,
      articles: lead.articles || [],
      line_items: (lead.lineItems || []).map((item) => ({
        article: item.article || null,
        quantity: item.quantity ?? null,
        unit: item.unit || null,
        description_ru: item.descriptionRu || null
      })),
      detected_brands: lead.detectedBrands || analysis.detectedBrands || [],
      has_nameplate_photos: Boolean(lead.hasNameplatePhotos),
      has_article_photos: Boolean(lead.hasArticlePhotos)
    },
    crm: {
      is_existing_company: Boolean(crm.isExistingCompany),
      needs_clarification: Boolean(crm.needsClarification),
      curator_mop: crm.curatorMop || null,
      curator_moz: crm.curatorMoz || null,
      suggested_reply: crm.suggestedReply || analysis.suggestedReply || null,
      company: crm.company
        ? {
            id: crm.company.id || null,
            legal_name: crm.company.legalName || null,
            inn: crm.company.inn || null,
            domain: crm.company.domain || null
          }
        : null
    }
  };
}

export function listIntegrationMessages(project, query = {}) {
  const page = normalizePositiveInt(query.page, 1);
  const limit = Math.min(normalizePositiveInt(query.limit, 50), 200);
  const statuses = parseStatuses(query.status);
  const since = parseSince(query.since);
  const exported = parseBooleanFilter(query.exported);
  const cursor = parseCursor(query.cursor);

  const allMessages = (project.recentMessages || [])
    .filter((item) => statuses.length === 0 || statuses.includes(item.pipelineStatus))
    .filter((item) => exported === null || Boolean(item.integrationExport?.acknowledgedAt) === exported)
    .filter((item) => {
      if (!since) {
        return true;
      }

      const updatedAt = resolveMessageUpdatedAt(item);
      return updatedAt ? Date.parse(updatedAt) >= since.getTime() : false;
    })
    .sort(compareMessagesDesc);

  const total = allMessages.length;
  const filteredMessages = cursor
    ? allMessages.filter((item) => compareMessageToCursor(item, cursor) > 0)
    : allMessages;
  const offset = cursor ? 0 : (page - 1) * limit;
  const pageItems = filteredMessages.slice(offset, offset + limit);
  const data = pageItems.map((item) => normalizeIntegrationMessage(project, item));
  const hasMore = filteredMessages.length > offset + pageItems.length;
  const lastItem = pageItems[pageItems.length - 1] || null;

  return {
    data,
    pagination: {
      page: cursor ? null : page,
      limit,
      total,
      total_pages: cursor ? null : Math.max(1, Math.ceil(total / limit))
    },
    meta: {
      statuses,
      exported,
      since: since ? since.toISOString() : null,
      cursor: cursor ? encodeCursor(cursor) : null,
      next_cursor: hasMore && lastItem ? encodeCursor({
        updatedAt: resolveMessageUpdatedAt(lastItem),
        messageKey: resolveMessageKey(lastItem)
      }) : null,
      next_since: data.reduce((latest, item) => {
        if (!item.updated_at) {
          return latest;
        }

        return !latest || item.updated_at > latest ? item.updated_at : latest;
      }, null)
    }
  };
}

export function findIntegrationMessage(project, messageKey) {
  const message = (project.recentMessages || []).find((item) => (item.messageKey || item.id) === messageKey);
  return message ? normalizeIntegrationMessage(project, message) : null;
}

export function listIntegrationDeliveries(project, query = {}) {
  const statuses = parseStatuses(query.status);
  const limit = Math.min(normalizePositiveInt(query.limit, 100), 500);

  const data = (project.webhookDeliveries || [])
    .filter((item) => statuses.length === 0 || statuses.includes(item.status))
    .slice(0, limit)
    .map(normalizeIntegrationDelivery);

  return {
    data,
    meta: {
      statuses
    }
  };
}

export function findIntegrationDelivery(project, deliveryId) {
  const delivery = (project.webhookDeliveries || []).find((item) => item.id === deliveryId);
  return delivery ? normalizeIntegrationDelivery(delivery) : null;
}

export function parseIntegrationCursor(value) {
  return parseCursor(value);
}

function normalizePositiveInt(value, fallback) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function parseStatuses(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSince(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp);
}

function parseBooleanFilter(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return null;
  }

  if (["true", "1", "yes"].includes(text)) {
    return true;
  }

  if (["false", "0", "no"].includes(text)) {
    return false;
  }

  return null;
}

function parseCursor(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  try {
    const raw = Buffer.from(text, "base64url").toString("utf-8");
    const parsed = JSON.parse(raw);
    const updatedAt = String(parsed.updatedAt || "").trim();
    const messageKey = String(parsed.messageKey || "").trim();
    if (!updatedAt || !messageKey || Number.isNaN(Date.parse(updatedAt))) {
      return null;
    }

    return { updatedAt, messageKey };
  } catch {
    return null;
  }
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify({
    updatedAt: value.updatedAt,
    messageKey: value.messageKey
  }), "utf-8").toString("base64url");
}

function resolveMessageUpdatedAt(message) {
  const auditEntries = Array.isArray(message.auditLog) ? message.auditLog : [];
  const auditAt = auditEntries
    .map((item) => item?.at)
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)))[0];

  return auditAt || message.updatedAt || message.createdAt || null;
}

function resolveMessageKey(message) {
  return String(message?.messageKey || message?.id || "");
}

function compareMessagesDesc(a, b) {
  const updatedAtCompare = String(resolveMessageUpdatedAt(b) || "").localeCompare(String(resolveMessageUpdatedAt(a) || ""));
  if (updatedAtCompare !== 0) {
    return updatedAtCompare;
  }

  return resolveMessageKey(b).localeCompare(resolveMessageKey(a));
}

function compareMessageToCursor(message, cursor) {
  const updatedAt = String(resolveMessageUpdatedAt(message) || "");
  const updatedAtCompare = updatedAt.localeCompare(cursor.updatedAt);
  if (updatedAtCompare !== 0) {
    return -updatedAtCompare;
  }

  return resolveMessageKey(cursor).localeCompare(resolveMessageKey(message));
}

function normalizeIntegrationDelivery(item) {
  return {
    id: item.id,
    key: item.key,
    event: item.event,
    message_key: item.messageKey,
    pipeline_status: item.pipelineStatus,
    status: item.status,
    attempts: item.attempts,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    next_attempt_at: item.nextAttemptAt,
    last_attempt_at: item.lastAttemptAt,
    delivered_at: item.deliveredAt,
    last_error: item.lastError,
    response_status: item.responseStatus,
    last_manual_action: item.lastManualAction || null
  };
}
