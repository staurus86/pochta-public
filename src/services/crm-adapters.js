/**
 * CRM-specific payload adapters.
 * Transform normalized Pochta messages into CRM-native formats.
 * Supported: amoCRM, Bitrix24, generic (pass-through).
 */

/**
 * Transform a normalized integration message to CRM-specific payload.
 * @param {string} crmType - "amocrm", "bitrix24", "1c", "generic"
 * @param {object} message - Normalized integration message
 * @param {object} config - CRM-specific config (pipelineId, responsibleId, etc.)
 */
export function buildCrmPayload(crmType, message, config = {}) {
  switch (crmType) {
    case "amocrm":
      return buildAmoCrmPayload(message, config);
    case "bitrix24":
      return buildBitrix24Payload(message, config);
    case "1c":
      return build1CPayload(message, config);
    default:
      return buildGenericPayload(message, config);
  }
}

/**
 * Build request options (method, headers, url) for CRM API call.
 */
export function buildCrmRequest(crmType, baseUrl, apiKey, payload) {
  switch (crmType) {
    case "amocrm":
      return {
        url: `${baseUrl}/api/v4/leads/complex`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify([payload])
      };
    case "bitrix24":
      return {
        url: `${baseUrl}/rest/${apiKey}/crm.lead.add.json`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      };
    case "1c":
      return {
        url: `${baseUrl}/hs/pochta/incoming`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${apiKey}`
        },
        body: JSON.stringify(payload)
      };
    default:
      return {
        url: baseUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": apiKey
        },
        body: JSON.stringify(payload)
      };
  }
}

// ── amoCRM Lead (API v4) ──
function buildAmoCrmPayload(msg, config) {
  const sender = msg.sender || {};
  const lead = msg.lead || {};
  const brands = (msg.detected_brands || []).join(", ");

  return {
    name: `[Pochta] ${msg.subject || "Входящая заявка"}`.slice(0, 255),
    pipeline_id: config.pipelineId || null,
    status_id: config.statusId || null,
    responsible_user_id: config.responsibleUserId || null,
    _embedded: {
      contacts: [{
        first_name: sender.full_name || "",
        custom_fields_values: [
          sender.email ? { field_code: "EMAIL", values: [{ value: sender.email, enum_code: "WORK" }] } : null,
          sender.city_phone ? { field_code: "PHONE", values: [{ value: sender.city_phone, enum_code: "WORK" }] } : null,
          sender.mobile_phone ? { field_code: "PHONE", values: [{ value: sender.mobile_phone, enum_code: "MOB" }] } : null,
          sender.position ? { field_code: "POSITION", values: [{ value: sender.position }] } : null
        ].filter(Boolean)
      }],
      companies: sender.company_name ? [{
        name: sender.company_name
      }] : []
    },
    custom_fields_values: [
      { field_id: config.fieldBrands || 0, values: [{ value: brands }] },
      { field_id: config.fieldArticles || 0, values: [{ value: (lead.articles || []).join(", ") }] },
      { field_id: config.fieldMailbox || 0, values: [{ value: msg.mailbox || "" }] },
      { field_id: config.fieldMessageKey || 0, values: [{ value: msg.message_key || "" }] }
    ].filter((f) => f.field_id),
    _metadata: {
      pochta_message_key: msg.message_key,
      pochta_project_id: msg.project_id
    }
  };
}

// ── Bitrix24 CRM Lead ──
function buildBitrix24Payload(msg, config) {
  const sender = msg.sender || {};
  const lead = msg.lead || {};

  return {
    fields: {
      TITLE: `[Pochta] ${msg.subject || "Входящая заявка"}`.slice(0, 255),
      NAME: sender.full_name || "",
      COMPANY_TITLE: sender.company_name || "",
      STATUS_ID: config.statusId || "NEW",
      SOURCE_ID: config.sourceId || "EMAIL",
      ASSIGNED_BY_ID: config.responsibleId || "",
      OPENED: "Y",
      EMAIL: sender.email ? [{ VALUE: sender.email, VALUE_TYPE: "WORK" }] : [],
      PHONE: [
        sender.city_phone ? { VALUE: sender.city_phone, VALUE_TYPE: "WORK" } : null,
        sender.mobile_phone ? { VALUE: sender.mobile_phone, VALUE_TYPE: "MOBILE" } : null
      ].filter(Boolean),
      COMMENTS: [
        `Бренды: ${(msg.detected_brands || []).join(", ")}`,
        `Артикулы: ${(lead.articles || []).join(", ")}`,
        `Ящик: ${msg.mailbox || ""}`,
        `Тип: ${lead.request_type || ""}`,
        `Позиций: ${lead.total_positions || 0}`,
        "",
        msg.body_preview || ""
      ].join("\n").slice(0, 5000),
      UF_CRM_POCHTA_KEY: msg.message_key || "",
      UF_CRM_POCHTA_PROJECT: msg.project_id || ""
    },
    params: { REGISTER_SONET_EVENT: "Y" }
  };
}

// ── 1С HTTP Service ──
function build1CPayload(msg, config) {
  const sender = msg.sender || {};
  const lead = msg.lead || {};

  return {
    type: "incoming_request",
    source: "pochta-platform",
    messageKey: msg.message_key,
    projectId: msg.project_id,
    date: msg.created_at,
    subject: msg.subject || "",
    sender: {
      email: sender.email || "",
      name: sender.full_name || "",
      company: sender.company_name || "",
      inn: sender.inn || "",
      phone: sender.city_phone || sender.mobile_phone || ""
    },
    request: {
      type: lead.request_type || "",
      brands: msg.detected_brands || [],
      articles: lead.articles || [],
      totalPositions: lead.total_positions || 0,
      lineItems: (lead.line_items || []).map((li) => ({
        article: li.article,
        quantity: li.quantity,
        unit: li.unit,
        description: li.description_ru || ""
      }))
    },
    crm: {
      isExistingCompany: msg.crm?.is_existing_company || false,
      curatorMop: msg.crm?.curator_mop || "",
      curatorMoz: msg.crm?.curator_moz || ""
    },
    attachments: (msg.attachments || []).map((a) => ({
      filename: a.filename || a,
      url: a.download_url || null
    }))
  };
}

// ── Generic (pass-through) ──
function buildGenericPayload(msg) {
  return {
    event: "message.ready_for_crm",
    occurred_at: new Date().toISOString(),
    message: msg
  };
}

/**
 * Parse CRM response to extract external ID for acknowledgement.
 */
export function parseCrmResponse(crmType, responseData) {
  try {
    switch (crmType) {
      case "amocrm": {
        const lead = responseData?.[0] || responseData;
        return { externalId: String(lead?.id || lead?.leads?.[0]?.id || ""), success: true };
      }
      case "bitrix24": {
        return { externalId: String(responseData?.result || ""), success: !responseData?.error };
      }
      case "1c": {
        return { externalId: String(responseData?.documentId || responseData?.id || ""), success: responseData?.success !== false };
      }
      default:
        return { externalId: String(responseData?.id || responseData?.externalId || ""), success: true };
    }
  } catch {
    return { externalId: "", success: false };
  }
}
