export { isIntegrationAuthorized } from "./integration-clients.js";

export function normalizeIntegrationMessage(project, message, options = {}) {
  const analysis = message.analysis || {};
  const classification = analysis.classification || {};
  const sender = analysis.sender || {};
  const lead = analysis.lead || {};
  const crm = analysis.crm || {};
  const messageKey = message.messageKey || message.id;
  const updatedAt = resolveMessageUpdatedAt(message);
  const exportState = resolveExportState(message, options.consumerId);

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
    thread_id: message.threadId || null,
    export: {
      acknowledged: Boolean(exportState?.acknowledgedAt),
      acknowledged_at: exportState?.acknowledgedAt || null,
      consumer: exportState?.consumer || null,
      external_id: exportState?.externalId || null,
      note: exportState?.note || null
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
      inn: sender.inn || null,
      kpp: sender.kpp || null,
      ogrn: sender.ogrn || null
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
        description_ru: item.descriptionRu || null,
        source: item.source || null
      })),
      detected_brands: lead.detectedBrands || analysis.detectedBrands || [],
      detected_product_types: lead.detectedProductTypes || [],
      product_names: (lead.productNames || []).map((p) => ({
        article: p.article,
        name: p.name,
        category: p.category
      })),
      nomenclature_matches: (lead.nomenclatureMatches || []).map((item) => ({
        article: item.article || null,
        brand: item.brand || null,
        product_name: item.productName || null,
        description: item.description || null,
        source_rows: item.sourceRows || 0,
        avg_price: item.avgPrice ?? null,
        match_type: item.matchType || null
      })),
      sources: lead.sources || null,
      recognition_summary: lead.recognitionSummary || null,
      recognition_diagnostics: lead.recognitionDiagnostics || null,
      urgency: lead.urgency || "normal",
      has_nameplate_photos: Boolean(lead.hasNameplatePhotos),
      has_article_photos: Boolean(lead.hasArticlePhotos)
    },
    crm: {
      is_existing_company: Boolean(crm.isExistingCompany),
      needs_clarification: Boolean(crm.needsClarification),
      curator_mop: crm.curatorMop || null,
      curator_moz: crm.curatorMoz || null,
      match_method: crm.matchMethod || null,
      match_confidence: crm.matchConfidence ?? null,
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

export function listIntegrationMessages(project, query = {}, options = {}) {
  const page = normalizePositiveInt(query.page, 1);
  const limit = Math.min(normalizePositiveInt(query.limit, 50), 200);
  const statuses = parseStatuses(query.status);
  const since = parseSince(query.since);
  const exported = parseBooleanFilter(query.exported);
  const cursor = parseCursor(query.cursor);
  const brandFilter = parseBrandFilter(query.brand);
  const labelFilter = parseLabelFilter(query.label);
  const searchQuery = parseSearchQuery(query.q);
  const hasAttachments = parseBooleanFilter(query.has_attachments);
  const attachmentExtFilter = parseAttachmentExtFilter(query.attachment_ext);
  const minAttachments = normalizePositiveInt(query.min_attachments, 0);
  const productTypeFilter = parseProductTypeFilter(query.product_type);

  const allMessages = (project.recentMessages || [])
    .filter((item) => statuses.length === 0 || statuses.includes(item.pipelineStatus))
    .filter((item) => exported === null || Boolean(resolveExportState(item, options.consumerId)?.acknowledgedAt) === exported)
    .filter((item) => {
      if (!since) {
        return true;
      }

      const updatedAt = resolveMessageUpdatedAt(item);
      return updatedAt ? Date.parse(updatedAt) >= since.getTime() : false;
    })
    .filter((item) => {
      if (!brandFilter) return true;
      const brands = (item.detectedBrands || item.analysis?.detectedBrands || [])
        .map((b) => String(b).toLowerCase());
      return brands.some((b) => b.includes(brandFilter));
    })
    .filter((item) => {
      if (!labelFilter) return true;
      const label = String(item.classification || item.analysis?.classification || "").toLowerCase();
      return label === labelFilter;
    })
    .filter((item) => {
      if (!searchQuery) return true;
      const haystack = [
        item.subject || "",
        item.bodyPreview || "",
        item.fromEmail || "",
        item.companyName || item.analysis?.companyName || "",
        ...(item.detectedBrands || item.analysis?.detectedBrands || [])
      ].join(" ").toLowerCase();
      return searchQuery.every((term) => haystack.includes(term));
    })
    .filter((item) => {
      if (hasAttachments === null) return true;
      const attachCount = (item.attachmentFiles || item.attachments || []).length;
      return hasAttachments ? attachCount > 0 : attachCount === 0;
    })
    .filter((item) => {
      if (!attachmentExtFilter) return true;
      const files = (item.attachmentFiles || item.attachments || []);
      const fileNames = files.map((f) => typeof f === "string" ? f : (f.filename || f.name || ""));
      return fileNames.some((name) => {
        const ext = name.split(".").pop()?.toLowerCase();
        return ext && attachmentExtFilter.includes(ext);
      });
    })
    .filter((item) => {
      if (!minAttachments) return true;
      return (item.attachmentFiles || item.attachments || []).length >= minAttachments;
    })
    .filter((item) => {
      if (!productTypeFilter) return true;
      const types = item.analysis?.lead?.detectedProductTypes || [];
      return productTypeFilter.some((t) => types.includes(t));
    })
    .sort(compareMessagesDesc);

  const total = allMessages.length;
  const filteredMessages = cursor
    ? allMessages.filter((item) => compareMessageToCursor(item, cursor) > 0)
    : allMessages;
  const offset = cursor ? 0 : (page - 1) * limit;
  const pageItems = filteredMessages.slice(offset, offset + limit);
  const data = pageItems.map((item) => normalizeIntegrationMessage(project, item, options));
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
      brand: brandFilter,
      label: labelFilter,
      q: searchQuery ? searchQuery.join(" ") : null,
      has_attachments: hasAttachments,
      attachment_ext: attachmentExtFilter,
      min_attachments: minAttachments || null,
      product_type: productTypeFilter,
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

export function findIntegrationMessage(project, messageKey, options = {}) {
  const message = (project.recentMessages || []).find((item) => (item.messageKey || item.id) === messageKey);
  return message ? normalizeIntegrationMessage(project, message, options) : null;
}

export function listIntegrationDeliveries(project, query = {}, options = {}) {
  const statuses = parseStatuses(query.status);
  const limit = Math.min(normalizePositiveInt(query.limit, 100), 500);

  const data = (project.webhookDeliveries || [])
    .filter((item) => !options.clientId || item.clientId === options.clientId)
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

export function summarizeIntegrationDeliveries(project, query = {}, options = {}) {
  const statuses = parseStatuses(query.status);
  const recentFailuresLimit = Math.min(normalizePositiveInt(query.failuresLimit || query.failure_limit, 5), 20);

  const deliveries = (project.webhookDeliveries || [])
    .filter((item) => !options.clientId || item.clientId === options.clientId)
    .filter((item) => statuses.length === 0 || statuses.includes(item.status));

  const byStatus = deliveries.reduce((acc, item) => {
    const status = String(item.status || "unknown");
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const responseStatuses = deliveries.reduce((acc, item) => {
    if (item.responseStatus == null) {
      return acc;
    }

    const key = String(item.responseStatus);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const failureReasons = deliveries
    .filter((item) => item.status === "failed" || item.lastError)
    .reduce((acc, item) => {
      const key = String(item.lastError || "Unknown error").trim();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

  const recentFailures = deliveries
    .filter((item) => item.status === "failed" || item.lastError)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, recentFailuresLimit)
    .map(normalizeIntegrationDelivery);

  const pendingDeliveries = deliveries.filter((item) => item.status === "pending");
  const deliveredCount = byStatus.delivered || 0;

  return {
    data: {
      total_deliveries: deliveries.length,
      by_status: byStatus,
      pending_backlog: pendingDeliveries.length,
      failed_backlog: byStatus.failed || 0,
      delivered_count: deliveredCount,
      success_rate: deliveries.length > 0
        ? Number((deliveredCount / deliveries.length).toFixed(4))
        : null,
      response_statuses: responseStatuses,
      failure_reasons: failureReasons,
      last_attempt_at: latestIso(deliveries.map((item) => item.lastAttemptAt)),
      last_delivered_at: latestIso(deliveries.map((item) => item.deliveredAt)),
      next_attempt_at: earliestIso(pendingDeliveries.map((item) => item.nextAttemptAt)),
      oldest_pending_created_at: earliestIso(pendingDeliveries.map((item) => item.createdAt)),
      recent_failures: recentFailures
    },
    meta: {
      statuses,
      recent_failures_limit: recentFailuresLimit
    }
  };
}

export function findIntegrationDelivery(project, deliveryId, options = {}) {
  const delivery = (project.webhookDeliveries || []).find((item) => item.id === deliveryId && (!options.clientId || item.clientId === options.clientId));
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

function parseBrandFilter(value) {
  const text = String(value || "").trim().toLowerCase();
  return text || null;
}

function parseLabelFilter(value) {
  const text = String(value || "").trim().toLowerCase();
  const valid = ["client", "spam", "vendor", "unknown"];
  return valid.includes(text) ? text : null;
}

function parseSearchQuery(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  return text.split(/\s+/).filter(Boolean);
}

function parseAttachmentExtFilter(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  return text.split(",").map((e) => e.trim().replace(/^\./, "")).filter(Boolean);
}

function parseProductTypeFilter(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  return text.split(",").map((t) => t.trim()).filter(Boolean);
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
    client_id: item.clientId || null,
    client_name: item.clientName || null,
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

function resolveExportState(message, consumerId) {
  if (consumerId) {
    return message?.integrationExports?.[consumerId] || null;
  }

  if (message?.integrationExport) {
    return message.integrationExport;
  }

  const exportsMap = message?.integrationExports || {};
  const firstKey = Object.keys(exportsMap)[0];
  return firstKey ? exportsMap[firstKey] : null;
}

function latestIso(values) {
  return values.filter(Boolean).sort((a, b) => String(b).localeCompare(String(a)))[0] || null;
}

function earliestIso(values) {
  return values.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))[0] || null;
}
