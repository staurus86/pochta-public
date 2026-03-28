export { isIntegrationAuthorized } from "./integration-clients.js";

const INTEGRATION_QUERY_PRESETS = {
  problem_queue: {
    description: "Messages that likely need manual review.",
    query: {
      confirmed: "false"
    }
  },
  max_parsed: {
    description: "Messages with the highest extraction completeness.",
    query: {
      article_present: "true",
      company_present: "true",
      inn_present: "true",
      phone_present: "true",
      risk: "low"
    }
  },
  sla_overdue: {
    description: "Messages that crossed their computed SLA threshold.",
    query: {
      sla_overdue: "true"
    }
  },
  needs_review: {
    description: "Messages with weak detection, conflicts, or missing core fields.",
    query: {
      confirmed: "false"
    }
  },
  high_priority_open: {
    description: "Unconfirmed high or critical priority messages.",
    query: {
      confirmed: "false",
      priority: "high,critical"
    }
  }
};

export function normalizeIntegrationMessage(project, message, options = {}) {
  const analysis = message.analysis || {};
  const classification = analysis.classification || {};
  const sender = analysis.sender || {};
  const lead = analysis.lead || {};
  const crm = analysis.crm || {};
  const messageKey = message.messageKey || message.id;
  const updatedAt = resolveMessageUpdatedAt(message);
  const exportState = resolveExportState(message, options.consumerId);
  const include = normalizeIncludeSet(options.include);
  const ageHours = resolveMessageAgeHours(message);
  const recognitionPriority = resolveRecognitionPriority(lead);
  const recognitionRisk = resolveRecognitionRisk(lead);
  const hasConflicts = Boolean(lead.recognitionSummary?.hasConflicts || (lead.recognitionDiagnostics?.conflicts || []).length > 0);
  const confirmedAt = message.recognitionConfirmed?.at || null;

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
    body_full: include.has("body") ? resolveMessageBody(message, analysis) : null,
    pipeline_status: message.pipelineStatus || "unknown",
    thread_id: message.threadId || null,
    message_meta: {
      recognition_confirmed: Boolean(confirmedAt),
      recognition_confirmed_at: confirmedAt,
      age_hours: ageHours,
      priority: recognitionPriority,
      risk_level: recognitionRisk,
      has_conflicts: hasConflicts,
      sla_overdue: isMessageSlaOverdue({ recognitionPriority, ageHours }),
      moderated: Boolean(message.moderationVerdict),
      moderation_verdict: message.moderationVerdict || null,
      moderated_at: message.moderatedAt || null,
      moderated_by: message.moderatedBy || null
    },
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
      recognition_decision: lead.recognitionDecision || null,
      sources: lead.sources || null,
      recognition_summary: lead.recognitionSummary || null,
      recognition_diagnostics: lead.recognitionDiagnostics || null,
      urgency: lead.urgency || "normal",
      has_nameplate_photos: Boolean(lead.hasNameplatePhotos),
      has_article_photos: Boolean(lead.hasArticlePhotos)
    },
    attachment_analysis: include.has("attachments_analysis")
      ? normalizeAttachmentAnalysis(analysis.attachmentAnalysis)
      : null,
    extraction_meta: include.has("extraction_meta")
      ? analysis.extractionMeta || null
      : null,
    audit: include.has("audit")
      ? normalizeAuditLog(message.auditLog || [])
      : null,
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

export function listIntegrationPresets(options = {}) {
  const clientPresets = normalizeClientPresetMap(options.clientPresets);
  return {
    data: [
      ...Object.entries(INTEGRATION_QUERY_PRESETS).map(([id, preset]) => ({
        id,
        scope: "global",
        name: id,
        description: preset.description,
        query: { ...preset.query }
      })),
      ...Object.values(clientPresets).map((preset) => ({
        id: preset.id,
        scope: preset.projectId ? "project" : "client",
        name: preset.name || preset.id,
        description: preset.description || "",
        project_id: preset.projectId || null,
        query: { ...(preset.query || {}) }
      }))
    ]
  };
}

export function listIntegrationMessages(project, query = {}, options = {}) {
  const page = normalizePositiveInt(query.page, 1);
  const limit = Math.min(normalizePositiveInt(query.limit, 50), 200);
  const context = buildIntegrationMessageQueryContext(query, options);
  const allMessages = filterIntegrationMessages(project, context, options);

  const total = allMessages.length;
  const filteredMessages = context.cursor
    ? allMessages.filter((item) => compareMessageToCursor(item, context.cursor) > 0)
    : allMessages;
  const offset = context.cursor ? 0 : (page - 1) * limit;
  const pageItems = filteredMessages.slice(offset, offset + limit);
  const data = pageItems.map((item) => normalizeIntegrationMessage(project, item, {
    ...options,
    include: context.include
  }));
  const hasMore = filteredMessages.length > offset + pageItems.length;
  const lastItem = pageItems[pageItems.length - 1] || null;

  return {
    data,
    pagination: {
      page: context.cursor ? null : page,
      limit,
      total,
      total_pages: context.cursor ? null : Math.max(1, Math.ceil(total / limit))
    },
    meta: {
      ...buildIntegrationMessageMeta(context),
      cursor: context.cursor ? encodeCursor(context.cursor) : null,
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

export function listIntegrationThreads(project, query = {}, options = {}) {
  const context = buildIntegrationMessageQueryContext(query, options);
  const includeMessages = parseBooleanFilter(query.include_messages) === true;
  const messages = filterIntegrationMessages(project, context, options);
  const groups = new Map();

  for (const item of messages) {
    const threadId = resolveThreadId(item);
    const group = groups.get(threadId) || {
      thread_id: threadId,
      message_count: 0,
      first_message_at: null,
      last_message_at: null,
      participants: new Set(),
      subjects: new Set(),
      pipeline_statuses: new Set(),
      priorities: new Set(),
      risk_levels: new Set(),
      has_conflicts: false,
      sla_overdue: false,
      message_keys: [],
      messages: []
    };

    const normalized = normalizeIntegrationMessage(project, item, options);
    const updatedAt = normalized.updated_at;
    const createdAt = normalized.created_at;
    group.message_count += 1;
    group.first_message_at = minIso(group.first_message_at, createdAt);
    group.last_message_at = maxIso(group.last_message_at, updatedAt || createdAt);
    if (normalized.from) group.participants.add(normalized.from);
    if (normalized.subject) group.subjects.add(normalized.subject);
    if (normalized.pipeline_status) group.pipeline_statuses.add(normalized.pipeline_status);
    if (normalized.message_meta?.priority) group.priorities.add(normalized.message_meta.priority);
    if (normalized.message_meta?.risk_level) group.risk_levels.add(normalized.message_meta.risk_level);
    group.has_conflicts = group.has_conflicts || Boolean(normalized.message_meta?.has_conflicts);
    group.sla_overdue = group.sla_overdue || Boolean(normalized.message_meta?.sla_overdue);
    group.message_keys.push(normalized.message_key);
    if (includeMessages) {
      group.messages.push(normalized);
    }
    groups.set(threadId, group);
  }

  const data = [...groups.values()]
    .map((group) => ({
      thread_id: group.thread_id,
      message_count: group.message_count,
      first_message_at: group.first_message_at,
      last_message_at: group.last_message_at,
      participants: [...group.participants],
      subjects: [...group.subjects],
      pipeline_statuses: [...group.pipeline_statuses],
      priorities: [...group.priorities],
      risk_levels: [...group.risk_levels],
      has_conflicts: group.has_conflicts,
      sla_overdue: group.sla_overdue,
      message_keys: group.message_keys,
      messages: includeMessages ? group.messages : undefined
    }))
    .sort((a, b) => String(b.last_message_at || "").localeCompare(String(a.last_message_at || "")) || String(b.thread_id).localeCompare(String(a.thread_id)));

  return {
    data,
    meta: {
      ...buildIntegrationMessageMeta(context),
      include_messages: includeMessages
    }
  };
}

export function findIntegrationThread(project, threadId, query = {}, options = {}) {
  const result = listIntegrationThreads(project, {
    ...query,
    include_messages: "true"
  }, options);
  return result.data.find((item) => item.thread_id === threadId) || null;
}

export function listIntegrationEvents(project, query = {}, options = {}) {
  const limit = Math.min(normalizePositiveInt(query.limit, 100), 500);
  const since = parseSince(query.since);
  const cursor = parseEventCursor(query.cursor);
  const typeFilter = parseStringListFilter(query.type);
  const scopeFilter = parseStringListFilter(query.scope);
  const context = buildIntegrationMessageQueryContext(query, options);
  const allowedMessageKeys = new Set(filterIntegrationMessages(project, context, options).map((item) => resolveMessageKey(item)));
  const events = buildIntegrationEvents(project, options)
    .filter((event) => allowedMessageKeys.has(event.message_key))
    .filter((event) => !since || Date.parse(event.at) >= since.getTime())
    .filter((event) => !typeFilter || typeFilter.includes(event.type))
    .filter((event) => !scopeFilter || scopeFilter.includes(event.scope))
    .filter((event) => !cursor || compareEventToCursor(event, cursor) > 0);

  const pageItems = events.slice(0, limit);
  const lastItem = pageItems[pageItems.length - 1] || null;
  const hasMore = events.length > pageItems.length;

  return {
    data: pageItems,
    pagination: {
      limit,
      total: events.length
    },
    meta: {
      ...buildIntegrationMessageMeta(context),
      type: typeFilter,
      scope: scopeFilter,
      cursor: cursor ? encodeEventCursor(cursor) : null,
      next_cursor: hasMore && lastItem ? encodeEventCursor({ at: lastItem.at, id: lastItem.id }) : null,
      since: since ? since.toISOString() : null
    }
  };
}

export function exportIntegrationEvents(project, query = {}, options = {}) {
  const format = parseExportFormat(query.format);
  const result = listIntegrationEvents(project, query, options);
  if (format === "jsonl") {
    return {
      contentType: "application/x-ndjson; charset=utf-8",
      filename: `integration-events-${project.id}.jsonl`,
      body: `${result.data.map((item) => JSON.stringify(item)).join("\n")}\n`
    };
  }

  if (format === "csv") {
    return {
      contentType: "text/csv; charset=utf-8",
      filename: `integration-events-${project.id}.csv`,
      body: buildIntegrationEventsCsv(result.data)
    };
  }

  return {
    contentType: "application/json; charset=utf-8",
    filename: `integration-events-${project.id}.json`,
    body: JSON.stringify(result, null, 2)
  };
}

export function exportIntegrationMessages(project, query = {}, options = {}) {
  const context = buildIntegrationMessageQueryContext(query, options);
  const format = parseExportFormat(query.format);
  const messages = filterIntegrationMessages(project, context, options);
  const data = messages.map((item) => normalizeIntegrationMessage(project, item, {
    ...options,
    include: context.include
  }));

  if (format === "jsonl") {
    return {
      contentType: "application/x-ndjson; charset=utf-8",
      filename: `integration-messages-${project.id}.jsonl`,
      body: `${data.map((item) => JSON.stringify(item)).join("\n")}\n`
    };
  }

  if (format === "csv") {
    return {
      contentType: "text/csv; charset=utf-8",
      filename: `integration-messages-${project.id}.csv`,
      body: buildIntegrationMessagesCsv(data)
    };
  }

  return {
    contentType: "application/json; charset=utf-8",
    filename: `integration-messages-${project.id}.json`,
    body: JSON.stringify({
      data,
      meta: buildIntegrationMessageMeta(context)
    }, null, 2)
  };
}

export function summarizeIntegrationMessages(project, query = {}, options = {}) {
  const context = buildIntegrationMessageQueryContext(query, options);
  const messages = filterIntegrationMessages(project, context, options);
  const priorities = {};
  const risks = {};
  const byStatus = {};
  const byClassification = {};
  let confirmedCount = 0;
  let conflictsCount = 0;
  let attachmentCount = 0;
  let parsedAttachmentsCount = 0;
  let exportedCount = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  let completenessSum = 0;
  let completenessCount = 0;

  for (const item of messages) {
    const analysis = item.analysis || {};
    const lead = analysis.lead || {};
    const classification = String(analysis.classification?.label || "unknown").trim().toLowerCase() || "unknown";
    const priority = resolveRecognitionPriority(lead) || "unknown";
    const risk = resolveRecognitionRisk(lead) || "unknown";
    const overallConfidence = Number(lead.recognitionDiagnostics?.overallConfidence ?? lead.recognitionSummary?.overallConfidence);
    const completenessScore = Number(lead.recognitionDiagnostics?.completenessScore ?? lead.recognitionSummary?.completenessScore);

    byStatus[String(item.pipelineStatus || "unknown")] = (byStatus[String(item.pipelineStatus || "unknown")] || 0) + 1;
    byClassification[classification] = (byClassification[classification] || 0) + 1;
    priorities[priority] = (priorities[priority] || 0) + 1;
    risks[risk] = (risks[risk] || 0) + 1;
    if (item.recognitionConfirmed?.at) confirmedCount += 1;
    if (resolveHasConflicts(lead)) conflictsCount += 1;
    if ((item.attachmentFiles || item.attachments || []).length > 0) attachmentCount += 1;
    if (hasParsedAttachmentSignal(item)) parsedAttachmentsCount += 1;
    if (resolveExportState(item, options.consumerId)?.acknowledgedAt) exportedCount += 1;
    if (Number.isFinite(overallConfidence)) {
      confidenceSum += overallConfidence;
      confidenceCount += 1;
    }
    if (Number.isFinite(completenessScore)) {
      completenessSum += completenessScore;
      completenessCount += 1;
    }
  }

  return {
    data: {
      total_messages: messages.length,
      by_status: byStatus,
      by_classification: byClassification,
      priorities,
      risks,
      confirmed_count: confirmedCount,
      unconfirmed_count: Math.max(0, messages.length - confirmedCount),
      conflicts_count: conflictsCount,
      exported_count: exportedCount,
      with_attachments_count: attachmentCount,
      parsed_attachments_count: parsedAttachmentsCount,
      sla_overdue_count: messages.filter((item) => isMessageSlaOverdue({
        recognitionPriority: resolveRecognitionPriority(item.analysis?.lead || {}),
        ageHours: resolveMessageAgeHours(item)
      })).length,
      avg_confidence: confidenceCount ? Number((confidenceSum / confidenceCount).toFixed(4)) : null,
      avg_completeness_score: completenessCount ? Number((completenessSum / completenessCount).toFixed(2)) : null,
      last_message_at: latestIso(messages.map((item) => resolveMessageUpdatedAt(item)))
    },
    meta: buildIntegrationMessageMeta(context)
  };
}

export function summarizeIntegrationCoverage(project, query = {}, options = {}) {
  const context = buildIntegrationMessageQueryContext(query, options);
  const messages = filterIntegrationMessages(project, context, options);
  const total = messages.length;
  const fieldChecks = {
    article: (item) => hasDetectedArticle(item),
    brand: (item) => hasDetectedBrand(item),
    name: (item) => hasDetectedName(item),
    phone: (item) => hasDetectedPhone(item),
    company: (item) => hasDetectedCompany(item),
    inn: (item) => hasDetectedInn(item),
    parsed_attachment: (item) => hasParsedAttachmentSignal(item)
  };

  const fields = Object.fromEntries(Object.entries(fieldChecks).map(([key, check]) => {
    const present = messages.filter(check).length;
    return [key, {
      present,
      missing: Math.max(0, total - present),
      coverage_rate: total > 0 ? Number((present / total).toFixed(4)) : null
    }];
  }));

  return {
    data: {
      total_messages: total,
      fields
    },
    meta: buildIntegrationMessageMeta(context)
  };
}

export function summarizeIntegrationProblems(project, query = {}, options = {}) {
  const context = buildIntegrationMessageQueryContext(query, options);
  const messages = filterIntegrationMessages(project, context, options);
  const limit = Math.min(normalizePositiveInt(query.limit, 20), 100);
  const byIssue = {};
  const topMessages = [];
  let totalProblemMessages = 0;

  for (const item of messages) {
    const issues = detectMessageIssues(item);
    if (issues.length === 0) {
      continue;
    }
    totalProblemMessages += 1;

    for (const issue of issues) {
      byIssue[issue] = (byIssue[issue] || 0) + 1;
    }

    if (topMessages.length < limit) {
      const lead = item.analysis?.lead || {};
      topMessages.push({
        message_key: resolveMessageKey(item),
        subject: item.subject || "",
        from: item.from || "",
        pipeline_status: item.pipelineStatus || "unknown",
        updated_at: resolveMessageUpdatedAt(item),
        priority: resolveRecognitionPriority(lead),
        risk_level: resolveRecognitionRisk(lead),
        age_hours: resolveMessageAgeHours(item),
        recognition_confirmed: Boolean(item.recognitionConfirmed?.at),
        issue_keys: issues,
        primary_issue: lead.recognitionSummary?.primaryIssue || lead.recognitionDiagnostics?.primaryIssue || issues[0],
        sla_overdue: isMessageSlaOverdue({
          recognitionPriority: resolveRecognitionPriority(lead),
          ageHours: resolveMessageAgeHours(item)
        })
      });
    }
  }

  return {
    data: {
      total_problem_messages: totalProblemMessages,
      by_issue: byIssue,
      top_messages: topMessages
    },
    meta: {
      ...buildIntegrationMessageMeta(context),
      limit
    }
  };
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

function parseArticleFilter(value) {
  const text = String(value || "").trim().toUpperCase();
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

function parseExportFormat(value) {
  const text = String(value || "json").trim().toLowerCase();
  return ["json", "jsonl", "csv"].includes(text) ? text : "json";
}

function normalizeClientPresetMap(items = []) {
  return Object.fromEntries((items || [])
    .map((item) => {
      const id = String(item.presetKey || item.id || "").trim().toLowerCase();
      if (!id) {
        return null;
      }

      return [id, {
        id,
        projectId: item.projectId || item.project_id || null,
        name: item.name || item.presetKey || item.id || "",
        description: item.description || "",
        query: item.query || {}
      }];
    })
    .filter(Boolean));
}

function parseStringListFilter(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

function buildIntegrationMessageQueryContext(query = {}, options = {}) {
  const resolved = applyIntegrationQueryPreset(query, options);
  return {
    preset: resolved.preset,
    statuses: parseStatuses(resolved.query.status),
    since: parseSince(resolved.query.since),
    exported: parseBooleanFilter(resolved.query.exported),
    cursor: parseCursor(resolved.query.cursor),
    brandFilter: parseBrandFilter(resolved.query.brand),
    labelFilter: parseLabelFilter(resolved.query.label),
    articleFilter: parseArticleFilter(resolved.query.article),
    searchQuery: parseSearchQuery(resolved.query.q),
    hasAttachments: parseBooleanFilter(resolved.query.has_attachments),
    attachmentExtFilter: parseAttachmentExtFilter(resolved.query.attachment_ext),
    minAttachments: normalizePositiveInt(resolved.query.min_attachments, 0),
    productTypeFilter: parseProductTypeFilter(resolved.query.product_type),
    confirmedFilter: parseBooleanFilter(resolved.query.confirmed),
    priorityFilter: parsePriorityFilter(resolved.query.priority),
    riskFilter: parseRiskFilter(resolved.query.risk),
    hasConflicts: parseBooleanFilter(resolved.query.has_conflicts),
    companyPresent: parseBooleanFilter(resolved.query.company_present),
    innPresent: parseBooleanFilter(resolved.query.inn_present),
    phonePresent: parseBooleanFilter(resolved.query.phone_present),
    articlePresent: parseBooleanFilter(resolved.query.article_present),
    slaOverdue: parseBooleanFilter(resolved.query.sla_overdue),
    include: normalizeIncludeSet(resolved.query.include)
  };
}

function applyIntegrationQueryPreset(query = {}, options = {}) {
  const preset = String(query.preset || "").trim().toLowerCase();
  const clientPresets = normalizeClientPresetMap(options.clientPresets);
  const definition = clientPresets[preset] || INTEGRATION_QUERY_PRESETS[preset];
  if (!definition) {
    return { preset: null, query: { ...query } };
  }
  return {
    preset,
    query: {
      ...definition.query,
      ...query
    }
  };
}

function filterIntegrationMessages(project, context, options = {}) {
  return (project.recentMessages || [])
    .filter((item) => context.statuses.length === 0 || context.statuses.includes(item.pipelineStatus))
    .filter((item) => context.exported === null || Boolean(resolveExportState(item, options.consumerId)?.acknowledgedAt) === context.exported)
    .filter((item) => {
      if (!context.since) return true;
      const updatedAt = resolveMessageUpdatedAt(item);
      return updatedAt ? Date.parse(updatedAt) >= context.since.getTime() : false;
    })
    .filter((item) => {
      if (!context.brandFilter) return true;
      const brands = (item.detectedBrands || item.analysis?.detectedBrands || []).map((b) => String(b).toLowerCase());
      return brands.some((b) => b.includes(context.brandFilter));
    })
    .filter((item) => {
      if (!context.articleFilter) return true;
      const articles = (item.analysis?.lead?.articles || []).map((a) => String(a).toUpperCase());
      return articles.some((a) => a.includes(context.articleFilter));
    })
    .filter((item) => {
      if (!context.labelFilter) return true;
      const label = String(item.classification || item.analysis?.classification || "").toLowerCase();
      return label === context.labelFilter;
    })
    .filter((item) => {
      if (!context.searchQuery) return true;
      const haystack = [
        item.subject || "",
        item.bodyPreview || "",
        item.fromEmail || item.from || "",
        item.companyName || item.analysis?.companyName || item.analysis?.sender?.companyName || "",
        ...(item.detectedBrands || item.analysis?.detectedBrands || [])
      ].join(" ").toLowerCase();
      return context.searchQuery.every((term) => haystack.includes(term));
    })
    .filter((item) => {
      if (context.hasAttachments === null) return true;
      const attachCount = (item.attachmentFiles || item.attachments || []).length;
      return context.hasAttachments ? attachCount > 0 : attachCount === 0;
    })
    .filter((item) => {
      if (!context.attachmentExtFilter) return true;
      const files = (item.attachmentFiles || item.attachments || []);
      const fileNames = files.map((f) => typeof f === "string" ? f : (f.filename || f.name || ""));
      return fileNames.some((name) => {
        const ext = name.split(".").pop()?.toLowerCase();
        return ext && context.attachmentExtFilter.includes(ext);
      });
    })
    .filter((item) => !context.minAttachments || (item.attachmentFiles || item.attachments || []).length >= context.minAttachments)
    .filter((item) => {
      if (!context.productTypeFilter) return true;
      const types = item.analysis?.lead?.detectedProductTypes || [];
      return context.productTypeFilter.some((t) => types.includes(t));
    })
    .filter((item) => context.confirmedFilter === null || Boolean(item.recognitionConfirmed?.at) === context.confirmedFilter)
    .filter((item) => {
      if (!context.priorityFilter) return true;
      const priority = resolveRecognitionPriority(item.analysis?.lead || {});
      return priority ? context.priorityFilter.includes(priority) : false;
    })
    .filter((item) => {
      if (!context.riskFilter) return true;
      const risk = resolveRecognitionRisk(item.analysis?.lead || {});
      return risk ? context.riskFilter.includes(risk) : false;
    })
    .filter((item) => context.hasConflicts === null || resolveHasConflicts(item.analysis?.lead || {}) === context.hasConflicts)
    .filter((item) => context.companyPresent === null || hasDetectedCompany(item) === context.companyPresent)
    .filter((item) => context.innPresent === null || hasDetectedInn(item) === context.innPresent)
    .filter((item) => context.phonePresent === null || hasDetectedPhone(item) === context.phonePresent)
    .filter((item) => context.articlePresent === null || hasDetectedArticle(item) === context.articlePresent)
    .filter((item) => context.slaOverdue === null || isMessageSlaOverdue({
      recognitionPriority: resolveRecognitionPriority(item.analysis?.lead || {}),
      ageHours: resolveMessageAgeHours(item)
    }) === context.slaOverdue)
    .filter((item) => matchPresetSpecialRules(item, context.preset))
    .sort(compareMessagesDesc);
}

function matchPresetSpecialRules(item, preset) {
  if (!preset) return true;
  if (preset === "problem_queue") {
    return detectMessageIssues(item).length > 0;
  }
  if (preset === "needs_review") {
    const lead = item.analysis?.lead || {};
    const risk = resolveRecognitionRisk(lead);
    return detectMessageIssues(item).length > 0 || risk === "high" || risk === "medium" || resolveHasConflicts(lead);
  }
  if (preset === "max_parsed") {
    return hasDetectedArticle(item)
      && hasDetectedBrand(item)
      && hasDetectedName(item)
      && hasDetectedPhone(item)
      && hasDetectedCompany(item)
      && hasDetectedInn(item)
      && !resolveHasConflicts(item.analysis?.lead || {});
  }
  if (preset === "high_priority_open") {
    return !Boolean(item.recognitionConfirmed?.at)
      && ["high", "critical"].includes(resolveRecognitionPriority(item.analysis?.lead || {}) || "");
  }
  if (preset === "sla_overdue") {
    return isMessageSlaOverdue({
      recognitionPriority: resolveRecognitionPriority(item.analysis?.lead || {}),
      ageHours: resolveMessageAgeHours(item)
    });
  }
  return true;
}

function buildIntegrationMessageMeta(context) {
  return {
    preset: context.preset,
    statuses: context.statuses,
    exported: context.exported,
    brand: context.brandFilter,
    article: context.articleFilter,
    label: context.labelFilter,
    q: context.searchQuery ? context.searchQuery.join(" ") : null,
    has_attachments: context.hasAttachments,
    attachment_ext: context.attachmentExtFilter,
    min_attachments: context.minAttachments || null,
    product_type: context.productTypeFilter,
    confirmed: context.confirmedFilter,
    priority: context.priorityFilter,
    risk: context.riskFilter,
    has_conflicts: context.hasConflicts,
    company_present: context.companyPresent,
    inn_present: context.innPresent,
    phone_present: context.phonePresent,
    article_present: context.articlePresent,
    sla_overdue: context.slaOverdue,
    include: [...context.include],
    since: context.since ? context.since.toISOString() : null
  };
}

function buildIntegrationMessagesCsv(data) {
  const headers = [
    "project_id",
    "message_key",
    "thread_id",
    "created_at",
    "updated_at",
    "pipeline_status",
    "brand",
    "subject",
    "from",
    "classification_label",
    "classification_confidence",
    "company_name",
    "inn",
    "phone",
    "articles",
    "product_names",
    "priority",
    "risk_level",
    "sla_overdue",
    "has_conflicts",
    "recognition_confirmed",
    "exported",
    "crm_company_id",
    "crm_company_name"
  ];

  const rows = data.map((item) => ([
    item.project_id,
    item.message_key,
    item.thread_id,
    item.created_at,
    item.updated_at,
    item.pipeline_status,
    item.brand,
    item.subject,
    item.from,
    item.classification?.label,
    item.classification?.confidence,
    item.sender?.company_name,
    item.sender?.inn,
    item.sender?.mobile_phone || item.sender?.city_phone,
    (item.lead?.articles || []).join("|"),
    (item.lead?.product_names || []).map((p) => p.name).filter(Boolean).join("|"),
    item.message_meta?.priority,
    item.message_meta?.risk_level,
    item.message_meta?.sla_overdue,
    item.message_meta?.has_conflicts,
    item.message_meta?.recognition_confirmed,
    item.export?.acknowledged,
    item.crm?.company?.id,
    item.crm?.company?.legal_name
  ]));

  return [
    headers.join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(","))
  ].join("\n");
}

function buildIntegrationEventsCsv(data) {
  const headers = [
    "id",
    "at",
    "scope",
    "type",
    "project_id",
    "message_key",
    "thread_id",
    "delivery_id",
    "status",
    "action",
    "consumer",
    "external_id",
    "summary"
  ];
  const rows = data.map((item) => ([
    item.id,
    item.at,
    item.scope,
    item.type,
    item.project_id,
    item.message_key,
    item.thread_id,
    item.delivery_id,
    item.pipeline_status || item.delivery_status || null,
    item.action || null,
    item.consumer || null,
    item.external_id || null,
    item.summary || null
  ]));
  return [
    headers.join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(","))
  ].join("\n");
}

function parsePriorityFilter(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  const valid = new Set(["critical", "high", "medium", "low"]);
  const values = text.split(",").map((item) => item.trim()).filter((item) => valid.has(item));
  return values.length ? values : null;
}

function parseRiskFilter(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  const valid = new Set(["high", "medium", "low"]);
  const values = text.split(",").map((item) => item.trim()).filter((item) => valid.has(item));
  return values.length ? values : null;
}

function normalizeIncludeSet(value) {
  const raw = Array.isArray(value) ? value.join(",") : String(value || "");
  const items = raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const normalized = new Set();
  for (const item of items) {
    if (item === "all") {
      normalized.add("body");
      normalized.add("audit");
      normalized.add("attachments_analysis");
      normalized.add("extraction_meta");
      continue;
    }
    normalized.add(item);
  }
  return normalized;
}

function resolveRecognitionPriority(lead = {}) {
  const value = String(lead.recognitionDecision?.priority || "").trim().toLowerCase();
  return value || null;
}

function resolveRecognitionRisk(lead = {}) {
  const value = String(lead.recognitionSummary?.riskLevel || lead.recognitionDiagnostics?.riskLevel || "").trim().toLowerCase();
  return value || null;
}

function parseEventCursor(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const raw = Buffer.from(text, "base64url").toString("utf-8");
    const parsed = JSON.parse(raw);
    const at = String(parsed.at || "").trim();
    const id = String(parsed.id || "").trim();
    if (!at || !id || Number.isNaN(Date.parse(at))) return null;
    return { at, id };
  } catch {
    return null;
  }
}

function encodeEventCursor(value) {
  return Buffer.from(JSON.stringify({
    at: value.at,
    id: value.id
  }), "utf-8").toString("base64url");
}

function resolveHasConflicts(lead = {}) {
  return Boolean(lead.recognitionSummary?.hasConflicts || (lead.recognitionDiagnostics?.conflicts || []).length > 0);
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

function buildIntegrationEvents(project, options = {}) {
  const events = [];

  for (const message of project.recentMessages || []) {
    const messageKey = resolveMessageKey(message);
    const threadId = resolveThreadId(message);
    const pipelineStatus = message.pipelineStatus || "unknown";
    for (const entry of message.auditLog || []) {
      const at = entry.at || resolveMessageUpdatedAt(message);
      if (!at) continue;
      const action = String(entry.action || "audit").trim().toLowerCase() || "audit";
      events.push({
        id: `msg:${messageKey}:${action}:${at}`,
        at,
        scope: "message",
        type: `message.${action}`,
        project_id: project.id,
        message_key: messageKey,
        thread_id: threadId,
        pipeline_status: pipelineStatus,
        action,
        consumer: entry.consumer || null,
        external_id: entry.externalId || null,
        summary: buildAuditEventSummary(entry, message)
      });
      events.push({
        id: `thread:${threadId}:${messageKey}:${action}:${at}`,
        at,
        scope: "thread",
        type: "thread.updated",
        project_id: project.id,
        message_key: messageKey,
        thread_id: threadId,
        pipeline_status: pipelineStatus,
        action,
        summary: `Thread ${threadId} updated by ${action}`
      });
    }
  }

  for (const delivery of project.webhookDeliveries || []) {
    if (options.clientId && delivery.clientId !== options.clientId) {
      continue;
    }
    const at = delivery.updatedAt || delivery.createdAt;
    if (!at) continue;
    events.push({
      id: `delivery:${delivery.id}:${at}`,
      at,
      scope: "delivery",
      type: `delivery.${String(delivery.status || "unknown").toLowerCase()}`,
      project_id: project.id,
      message_key: delivery.messageKey || null,
      thread_id: resolveThreadId((project.recentMessages || []).find((item) => resolveMessageKey(item) === delivery.messageKey) || {}),
      delivery_id: delivery.id,
      delivery_status: delivery.status || null,
      consumer: delivery.clientId || null,
      external_id: null,
      summary: `Delivery ${delivery.id} is ${delivery.status || "unknown"}`
    });
  }

  return events.sort(compareEventsDesc);
}

function buildAuditEventSummary(entry, message) {
  const changes = Array.isArray(entry.changes) ? entry.changes.join("; ") : "";
  if (changes) return changes;
  const action = String(entry.action || "updated");
  return `${action} for ${resolveMessageKey(message)}`;
}

function compareEventsDesc(a, b) {
  const atCompare = String(b.at || "").localeCompare(String(a.at || ""));
  if (atCompare !== 0) return atCompare;
  return String(b.id || "").localeCompare(String(a.id || ""));
}

function compareEventToCursor(event, cursor) {
  const atCompare = String(event.at || "").localeCompare(String(cursor.at || ""));
  if (atCompare !== 0) {
    return -atCompare;
  }
  return String(cursor.id || "").localeCompare(String(event.id || ""));
}

function normalizeAttachmentAnalysis(attachmentAnalysis) {
  if (!attachmentAnalysis) return null;
  return {
    meta: attachmentAnalysis.meta || null,
    files: (attachmentAnalysis.files || []).map((file) => ({
      filename: file.filename || null,
      status: file.status || null,
      reason: file.reason || null,
      category: file.category || null,
      extracted_chars: file.extractedChars ?? null,
      detected_articles: file.detectedArticles || [],
      detected_inn: file.detectedInn || [],
      detected_kpp: file.detectedKpp || [],
      detected_ogrn: file.detectedOgrn || [],
      line_items: (file.lineItems || []).map((item) => ({
        article: item.article || null,
        quantity: item.quantity ?? null,
        unit: item.unit || null,
        description_ru: item.descriptionRu || null
      }))
    }))
  };
}

function normalizeAuditLog(entries = []) {
  return entries.map((entry) => ({
    at: entry.at || null,
    action: entry.action || null,
    from: entry.from || null,
    to: entry.to || null,
    changes: entry.changes || [],
    fields: entry.fields || null,
    consumer: entry.consumer || null,
    external_id: entry.externalId || null,
    note: entry.note || null
  }));
}

function resolveThreadId(message) {
  return String(message.threadId || `message:${resolveMessageKey(message)}`);
}

function hasDetectedArticle(message) {
  return Boolean((message.analysis?.lead?.articles || []).length > 0);
}

function hasDetectedBrand(message) {
  return Boolean((message.analysis?.lead?.detectedBrands || message.analysis?.detectedBrands || []).length > 0);
}

function hasDetectedName(message) {
  const lead = message.analysis?.lead || {};
  return Boolean(
    (lead.productNames || []).length > 0
    || (lead.nomenclatureMatches || []).some((item) => item?.productName)
    || (lead.lineItems || []).some((item) => item?.descriptionRu)
  );
}

function hasDetectedPhone(message) {
  return Boolean(message.analysis?.sender?.mobilePhone || message.analysis?.sender?.cityPhone);
}

function hasDetectedCompany(message) {
  return Boolean(message.analysis?.sender?.companyName);
}

function hasDetectedInn(message) {
  return Boolean(message.analysis?.sender?.inn);
}

function hasParsedAttachmentSignal(message) {
  const lead = message.analysis?.lead || {};
  if (lead.recognitionSummary?.parsedAttachment) {
    return true;
  }
  const files = message.analysis?.attachmentAnalysis?.files || [];
  return files.some((file) => {
    const status = String(file.status || "").toLowerCase();
    return status === "processed" || Number(file.extractedChars) > 0 || (file.lineItems || []).length > 0;
  });
}

function detectMessageIssues(message) {
  const lead = message.analysis?.lead || {};
  const issues = [];
  if (!hasDetectedArticle(message)) issues.push("no_article");
  if (!hasDetectedBrand(message)) issues.push("no_brand");
  if (!hasDetectedName(message)) issues.push("no_name");
  if (!hasDetectedPhone(message)) issues.push("no_phone");
  if (!hasDetectedCompany(message)) issues.push("no_company");
  if (!hasDetectedInn(message)) issues.push("no_inn");
  if ((message.attachmentFiles || message.attachments || []).length > 0 && !hasParsedAttachmentSignal(message)) {
    issues.push("attachments_unparsed");
  }
  const risk = resolveRecognitionRisk(lead);
  const confidence = Number(lead.recognitionDiagnostics?.overallConfidence ?? lead.recognitionSummary?.overallConfidence);
  if (risk === "high" || risk === "medium" || (Number.isFinite(confidence) && confidence < 0.75)) {
    issues.push("weak_detection");
  }
  if (resolveHasConflicts(lead)) issues.push("has_conflicts");
  if (isMessageSlaOverdue({ recognitionPriority: resolveRecognitionPriority(lead), ageHours: resolveMessageAgeHours(message) })) {
    issues.push("sla_overdue");
  }
  return issues;
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

function resolveMessageBody(message, analysis) {
  return message.body || analysis?.rawInput?.body || analysis?.lead?.freeText || message.bodyPreview || "";
}

function resolveMessageAgeHours(message) {
  const createdAt = Date.parse(message?.createdAt || "");
  if (!Number.isFinite(createdAt)) return null;
  return Number(((Date.now() - createdAt) / (1000 * 60 * 60)).toFixed(2));
}

function isMessageSlaOverdue({ recognitionPriority, ageHours }) {
  if (!recognitionPriority || !Number.isFinite(ageHours)) return false;
  if (recognitionPriority === "critical") return ageHours >= 2;
  if (recognitionPriority === "high") return ageHours >= 8;
  if (recognitionPriority === "medium") return ageHours >= 24;
  return ageHours >= 48;
}

function latestIso(values) {
  return values.filter(Boolean).sort((a, b) => String(b).localeCompare(String(a)))[0] || null;
}

function earliestIso(values) {
  return values.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))[0] || null;
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return String(a) >= String(b) ? a : b;
}

function minIso(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return String(a) <= String(b) ? a : b;
}

function escapeCsvValue(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}
