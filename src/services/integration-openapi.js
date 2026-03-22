import { buildLegacyIntegrationChangelogDocument, getLegacyIntegrationApiVersion } from "./integration-contract.js";

export function buildLegacyIntegrationOpenApi(options = {}) {
  const baseUrl = String(options.baseUrl || "https://pochta-production.up.railway.app").trim();

  return {
    openapi: "3.1.0",
    info: {
      title: "Pochta Legacy Integration API",
      version: getLegacyIntegrationApiVersion(),
      description: "Versioned contract for polling parsed email results, acknowledging exports, and managing webhook deliveries."
    },
    servers: [
      { url: baseUrl }
    ],
    security: [
      { ApiKeyAuth: [] },
      { BearerAuth: [] }
    ],
    tags: [
      { name: "Integration", description: "External integration endpoints for parsed email results." }
    ],
    paths: {
      "/api/integration/health": {
        get: {
          tags: ["Integration"],
          summary: "Integration API health",
          responses: {
            200: {
              description: "Integration API is available",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationHealthResponse" }
                }
              }
            },
            401: unauthorizedResponse(),
            503: errorResponse("Integration API is not configured.")
          }
        }
      },
      "/api/integration/changelog": {
        get: {
          tags: ["Integration"],
          summary: "Get integration API version policy and changelog",
          responses: {
            200: {
              description: "Version policy and recent changelog entries",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationChangelogDocument" }
                }
              }
            }
          }
        }
      },
      "/api/integration/projects": {
        get: {
          tags: ["Integration"],
          summary: "List accessible projects",
          responses: {
            200: {
              description: "Projects visible to the current integration client",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationProjectsResponse" }
                }
              }
            },
            401: unauthorizedResponse()
          }
        }
      },
      "/api/integration/presets": {
        get: {
          tags: ["Integration"],
          summary: "List server-side integration query presets",
          responses: {
            200: {
              description: "Available query presets for integration endpoints",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationPresetListResponse" }
                }
              }
            },
            401: unauthorizedResponse()
          }
        }
      },
      "/api/integration/projects/{projectId}/messages": {
        get: {
          tags: ["Integration"],
          summary: "List parsed messages",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            queryParameter("preset", "string", "Server-side query preset such as problem_queue, max_parsed, sla_overdue, needs_review, high_priority_open"),
            queryParameter("page", "integer", "Page number for offset pagination"),
            queryParameter("limit", "integer", "Items per page or cursor page size"),
            queryParameter("status", "string", "Comma-separated pipeline statuses"),
            queryParameter("since", "string", "ISO datetime filter for updated_at", { format: "date-time" }),
            queryParameter("exported", "string", "Filter by export acknowledgement state"),
            queryParameter("brand", "string", "Filter by detected brand name (case-insensitive partial match)"),
            queryParameter("label", "string", "Filter by classification label: client, spam, vendor, unknown"),
            queryParameter("q", "string", "Full-text search across subject, body, sender, company, brands"),
            queryParameter("cursor", "string", "Opaque cursor for keyset pagination"),
            queryParameter("has_attachments", "boolean", "Filter by attachment presence"),
            queryParameter("attachment_ext", "string", "Comma-separated file extensions to filter by"),
            queryParameter("min_attachments", "integer", "Minimum number of attachments"),
            queryParameter("product_type", "string", "Comma-separated product type categories"),
            queryParameter("confirmed", "boolean", "Filter by manual recognition confirmation"),
            queryParameter("priority", "string", "Comma-separated priorities: critical, high, medium, low"),
            queryParameter("risk", "string", "Comma-separated recognition risk levels: high, medium, low"),
            queryParameter("has_conflicts", "boolean", "Filter by recognition conflicts"),
            queryParameter("company_present", "boolean", "Filter by detected company presence"),
            queryParameter("inn_present", "boolean", "Filter by detected INN presence"),
            queryParameter("phone_present", "boolean", "Filter by detected phone presence"),
            queryParameter("article_present", "boolean", "Filter by detected article presence"),
            queryParameter("sla_overdue", "boolean", "Filter by computed SLA overdue state"),
            queryParameter("include", "string", "Optional additive payload blocks: body,audit,attachments_analysis,extraction_meta,all")
          ],
          responses: {
            200: {
              description: "Normalized message list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationMessageListResponse" }
                }
              }
            },
            400: errorResponse("Query parameter validation error."),
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/messages/stats": {
        get: {
          tags: ["Integration"],
          summary: "Get aggregate message quality and pipeline stats",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            queryParameter("preset", "string", "Server-side query preset"),
            queryParameter("status", "string", "Comma-separated pipeline statuses"),
            queryParameter("since", "string", "ISO datetime filter for updated_at", { format: "date-time" }),
            queryParameter("exported", "string", "Filter by export acknowledgement state"),
            queryParameter("brand", "string", "Filter by detected brand name"),
            queryParameter("label", "string", "Filter by classification label"),
            queryParameter("q", "string", "Full-text search across message fields"),
            queryParameter("has_attachments", "boolean", "Filter by attachment presence"),
            queryParameter("attachment_ext", "string", "Comma-separated file extensions to filter by"),
            queryParameter("min_attachments", "integer", "Minimum number of attachments"),
            queryParameter("product_type", "string", "Comma-separated product type categories"),
            queryParameter("confirmed", "boolean", "Filter by manual recognition confirmation"),
            queryParameter("priority", "string", "Comma-separated priorities: critical, high, medium, low"),
            queryParameter("risk", "string", "Comma-separated recognition risk levels: high, medium, low"),
            queryParameter("has_conflicts", "boolean", "Filter by recognition conflicts"),
            queryParameter("company_present", "boolean", "Filter by detected company presence"),
            queryParameter("inn_present", "boolean", "Filter by detected INN presence"),
            queryParameter("phone_present", "boolean", "Filter by detected phone presence"),
            queryParameter("article_present", "boolean", "Filter by detected article presence"),
            queryParameter("sla_overdue", "boolean", "Filter by computed SLA overdue state")
          ],
          responses: {
            200: {
              description: "Aggregate message stats for external dashboards",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationMessageStatsResponse" }
                }
              }
            },
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/messages/coverage": {
        get: {
          tags: ["Integration"],
          summary: "Get field coverage metrics across messages",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            queryParameter("preset", "string", "Server-side query preset"),
            queryParameter("status", "string", "Comma-separated pipeline statuses"),
            queryParameter("since", "string", "ISO datetime filter for updated_at", { format: "date-time" }),
            queryParameter("exported", "string", "Filter by export acknowledgement state"),
            queryParameter("brand", "string", "Filter by detected brand name"),
            queryParameter("label", "string", "Filter by classification label"),
            queryParameter("q", "string", "Full-text search across message fields"),
            queryParameter("has_attachments", "boolean", "Filter by attachment presence"),
            queryParameter("attachment_ext", "string", "Comma-separated file extensions to filter by"),
            queryParameter("min_attachments", "integer", "Minimum number of attachments"),
            queryParameter("product_type", "string", "Comma-separated product type categories"),
            queryParameter("confirmed", "boolean", "Filter by manual recognition confirmation"),
            queryParameter("priority", "string", "Comma-separated priorities: critical, high, medium, low"),
            queryParameter("risk", "string", "Comma-separated recognition risk levels: high, medium, low"),
            queryParameter("has_conflicts", "boolean", "Filter by recognition conflicts"),
            queryParameter("company_present", "boolean", "Filter by detected company presence"),
            queryParameter("inn_present", "boolean", "Filter by detected INN presence"),
            queryParameter("phone_present", "boolean", "Filter by detected phone presence"),
            queryParameter("article_present", "boolean", "Filter by detected article presence"),
            queryParameter("sla_overdue", "boolean", "Filter by computed SLA overdue state")
          ],
          responses: {
            200: {
              description: "Field coverage metrics",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationCoverageResponse" }
                }
              }
            },
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/messages/problems": {
        get: {
          tags: ["Integration"],
          summary: "Get problem queue summary and top problematic messages",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            queryParameter("preset", "string", "Server-side query preset"),
            queryParameter("limit", "integer", "Maximum number of problem messages to include"),
            queryParameter("status", "string", "Comma-separated pipeline statuses"),
            queryParameter("since", "string", "ISO datetime filter for updated_at", { format: "date-time" }),
            queryParameter("exported", "string", "Filter by export acknowledgement state"),
            queryParameter("brand", "string", "Filter by detected brand name"),
            queryParameter("label", "string", "Filter by classification label"),
            queryParameter("q", "string", "Full-text search across message fields"),
            queryParameter("has_attachments", "boolean", "Filter by attachment presence"),
            queryParameter("attachment_ext", "string", "Comma-separated file extensions to filter by"),
            queryParameter("min_attachments", "integer", "Minimum number of attachments"),
            queryParameter("product_type", "string", "Comma-separated product type categories"),
            queryParameter("confirmed", "boolean", "Filter by manual recognition confirmation"),
            queryParameter("priority", "string", "Comma-separated priorities: critical, high, medium, low"),
            queryParameter("risk", "string", "Comma-separated recognition risk levels: high, medium, low"),
            queryParameter("has_conflicts", "boolean", "Filter by recognition conflicts"),
            queryParameter("company_present", "boolean", "Filter by detected company presence"),
            queryParameter("inn_present", "boolean", "Filter by detected INN presence"),
            queryParameter("phone_present", "boolean", "Filter by detected phone presence"),
            queryParameter("article_present", "boolean", "Filter by detected article presence"),
            queryParameter("sla_overdue", "boolean", "Filter by computed SLA overdue state")
          ],
          responses: {
            200: {
              description: "Problem queue for external QA and CRM flows",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationProblemQueueResponse" }
                }
              }
            },
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/messages/export": {
        get: {
          tags: ["Integration"],
          summary: "Export filtered messages in JSON, JSONL, or CSV",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            queryParameter("preset", "string", "Server-side query preset"),
            queryParameter("format", "string", "Export format: json, jsonl, csv"),
            queryParameter("status", "string", "Comma-separated pipeline statuses"),
            queryParameter("since", "string", "ISO datetime filter for updated_at", { format: "date-time" }),
            queryParameter("exported", "string", "Filter by export acknowledgement state"),
            queryParameter("brand", "string", "Filter by detected brand name"),
            queryParameter("label", "string", "Filter by classification label"),
            queryParameter("q", "string", "Full-text search across message fields"),
            queryParameter("has_attachments", "boolean", "Filter by attachment presence"),
            queryParameter("attachment_ext", "string", "Comma-separated file extensions to filter by"),
            queryParameter("min_attachments", "integer", "Minimum number of attachments"),
            queryParameter("product_type", "string", "Comma-separated product type categories"),
            queryParameter("confirmed", "boolean", "Filter by manual recognition confirmation"),
            queryParameter("priority", "string", "Comma-separated priorities: critical, high, medium, low"),
            queryParameter("risk", "string", "Comma-separated recognition risk levels: high, medium, low"),
            queryParameter("has_conflicts", "boolean", "Filter by recognition conflicts"),
            queryParameter("company_present", "boolean", "Filter by detected company presence"),
            queryParameter("inn_present", "boolean", "Filter by detected INN presence"),
            queryParameter("phone_present", "boolean", "Filter by detected phone presence"),
            queryParameter("article_present", "boolean", "Filter by detected article presence"),
            queryParameter("sla_overdue", "boolean", "Filter by computed SLA overdue state"),
            queryParameter("include", "string", "Optional additive payload blocks: body,audit,attachments_analysis,extraction_meta,all")
          ],
          responses: {
            200: {
              description: "Filtered export file"
            },
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/threads": {
        get: {
          tags: ["Integration"],
          summary: "List grouped email threads",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            queryParameter("preset", "string", "Server-side query preset"),
            queryParameter("status", "string", "Comma-separated pipeline statuses"),
            queryParameter("since", "string", "ISO datetime filter for updated_at", { format: "date-time" }),
            queryParameter("exported", "string", "Filter by export acknowledgement state"),
            queryParameter("brand", "string", "Filter by detected brand name"),
            queryParameter("label", "string", "Filter by classification label"),
            queryParameter("q", "string", "Full-text search across message fields"),
            queryParameter("has_attachments", "boolean", "Filter by attachment presence"),
            queryParameter("attachment_ext", "string", "Comma-separated file extensions to filter by"),
            queryParameter("min_attachments", "integer", "Minimum number of attachments"),
            queryParameter("product_type", "string", "Comma-separated product type categories"),
            queryParameter("confirmed", "boolean", "Filter by manual recognition confirmation"),
            queryParameter("priority", "string", "Comma-separated priorities: critical, high, medium, low"),
            queryParameter("risk", "string", "Comma-separated recognition risk levels: high, medium, low"),
            queryParameter("has_conflicts", "boolean", "Filter by recognition conflicts"),
            queryParameter("company_present", "boolean", "Filter by detected company presence"),
            queryParameter("inn_present", "boolean", "Filter by detected INN presence"),
            queryParameter("phone_present", "boolean", "Filter by detected phone presence"),
            queryParameter("article_present", "boolean", "Filter by detected article presence"),
            queryParameter("sla_overdue", "boolean", "Filter by computed SLA overdue state"),
            queryParameter("include", "string", "Optional additive payload blocks for nested messages"),
            queryParameter("include_messages", "boolean", "Include normalized messages in each thread record")
          ],
          responses: {
            200: {
              description: "Grouped message threads",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationThreadListResponse" }
                }
              }
            },
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/threads/{threadId}": {
        get: {
          tags: ["Integration"],
          summary: "Get a single grouped email thread",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            pathParameter("threadId", "Thread identifier"),
            queryParameter("preset", "string", "Server-side query preset"),
            queryParameter("include", "string", "Optional additive payload blocks for nested messages")
          ],
          responses: {
            200: {
              description: "Single grouped thread",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationThreadResponse" }
                }
              }
            },
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Thread or project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/events": {
        get: {
          tags: ["Integration"],
          summary: "List incremental integration events for messages, threads, and deliveries",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            queryParameter("preset", "string", "Server-side query preset"),
            queryParameter("limit", "integer", "Maximum number of events to return"),
            queryParameter("since", "string", "ISO datetime filter for event time", { format: "date-time" }),
            queryParameter("cursor", "string", "Opaque cursor for incremental event polling"),
            queryParameter("type", "string", "Comma-separated event types"),
            queryParameter("scope", "string", "Comma-separated event scopes: message, thread, delivery"),
            queryParameter("status", "string", "Comma-separated pipeline statuses"),
            queryParameter("exported", "string", "Filter by export acknowledgement state"),
            queryParameter("brand", "string", "Filter by detected brand name"),
            queryParameter("label", "string", "Filter by classification label"),
            queryParameter("q", "string", "Full-text search across message fields"),
            queryParameter("has_attachments", "boolean", "Filter by attachment presence"),
            queryParameter("attachment_ext", "string", "Comma-separated file extensions to filter by"),
            queryParameter("min_attachments", "integer", "Minimum number of attachments"),
            queryParameter("product_type", "string", "Comma-separated product type categories"),
            queryParameter("confirmed", "boolean", "Filter by manual recognition confirmation"),
            queryParameter("priority", "string", "Comma-separated priorities: critical, high, medium, low"),
            queryParameter("risk", "string", "Comma-separated recognition risk levels: high, medium, low"),
            queryParameter("has_conflicts", "boolean", "Filter by recognition conflicts"),
            queryParameter("company_present", "boolean", "Filter by detected company presence"),
            queryParameter("inn_present", "boolean", "Filter by detected INN presence"),
            queryParameter("phone_present", "boolean", "Filter by detected phone presence"),
            queryParameter("article_present", "boolean", "Filter by detected article presence"),
            queryParameter("sla_overdue", "boolean", "Filter by computed SLA overdue state")
          ],
          responses: {
            200: {
              description: "Incremental integration event feed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationEventListResponse" }
                }
              }
            },
            400: errorResponse("Query parameter validation error."),
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/events/export": {
        get: {
          tags: ["Integration"],
          summary: "Export incremental event feed in JSON, JSONL, or CSV",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            queryParameter("preset", "string", "Server-side query preset"),
            queryParameter("format", "string", "Export format: json, jsonl, csv"),
            queryParameter("limit", "integer", "Maximum number of events to return"),
            queryParameter("since", "string", "ISO datetime filter for event time", { format: "date-time" }),
            queryParameter("cursor", "string", "Opaque cursor for incremental event polling"),
            queryParameter("type", "string", "Comma-separated event types"),
            queryParameter("scope", "string", "Comma-separated event scopes"),
            queryParameter("status", "string", "Comma-separated pipeline statuses"),
            queryParameter("exported", "string", "Filter by export acknowledgement state")
          ],
          responses: {
            200: {
              description: "Filtered event export file"
            },
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/messages/{messageKey}": {
        get: {
          tags: ["Integration"],
          summary: "Get a single parsed message",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            pathParameter("messageKey", "Normalized message key"),
            queryParameter("include", "string", "Optional additive payload blocks: body,audit,attachments_analysis,extraction_meta,all")
          ],
          responses: {
            200: {
              description: "Single normalized message",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationMessageResponse" }
                }
              }
            },
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Message or project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/messages/ack": {
        post: {
          tags: ["Integration"],
          summary: "Bulk acknowledge export of multiple messages",
          parameters: [
            pathParameter("projectId", "Project identifier")
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["messages"],
                  properties: {
                    messages: {
                      type: "array",
                      maxItems: 200,
                      items: {
                        type: "object",
                        required: ["messageKey"],
                        properties: {
                          messageKey: { type: "string" },
                          externalId: { type: ["string", "null"] },
                          note: { type: ["string", "null"] },
                          idempotencyKey: { type: ["string", "null"] }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "Batch acknowledge results with summary",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            messageKey: { type: "string" },
                            acknowledged: { type: "boolean" },
                            skipped: { type: "boolean" },
                            error: { type: ["string", "null"] }
                          }
                        }
                      },
                      summary: {
                        type: "object",
                        properties: {
                          acknowledged: { type: "integer" },
                          skipped: { type: "integer" },
                          failed: { type: "integer" },
                          total: { type: "integer" }
                        }
                      }
                    }
                  }
                }
              }
            },
            400: errorResponse("Validation error."),
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/messages/{messageKey}/ack": {
        post: {
          tags: ["Integration"],
          summary: "Acknowledge export of a parsed message",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            pathParameter("messageKey", "Normalized message key"),
            headerParameter("Idempotency-Key", "Optional idempotency key for safe client retries")
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/IntegrationAckRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Updated normalized message for the current client",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationMessageResponse" }
                }
              }
            },
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Message or project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/deliveries": {
        get: {
          tags: ["Integration"],
          summary: "List webhook deliveries for the current client",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            queryParameter("status", "string", "Comma-separated delivery statuses"),
            queryParameter("limit", "integer", "Maximum number of deliveries to return")
          ],
          responses: {
            200: {
              description: "Webhook deliveries",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationDeliveryListResponse" }
                }
              }
            },
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/deliveries/stats": {
        get: {
          tags: ["Integration"],
          summary: "Get webhook delivery diagnostics for the current client",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            queryParameter("status", "string", "Optional comma-separated delivery statuses to scope diagnostics"),
            queryParameter("failure_limit", "integer", "Maximum number of recent failures to include")
          ],
          responses: {
            200: {
              description: "Webhook delivery backlog and failure diagnostics",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationDeliveryDiagnosticsResponse" }
                }
              }
            },
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to access this project."),
            404: errorResponse("Project not found.")
          }
        }
      },
      "/api/integration/projects/{projectId}/deliveries/{deliveryId}/requeue": {
        post: {
          tags: ["Integration"],
          summary: "Requeue a failed or pending webhook delivery",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            pathParameter("deliveryId", "Webhook delivery identifier"),
            headerParameter("Idempotency-Key", "Optional idempotency key for safe client retries")
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/IntegrationRequeueRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Requeued delivery",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntegrationDeliveryResponse" }
                }
              }
            },
            401: unauthorizedResponse(),
            403: errorResponse("Client is not allowed to manage this delivery."),
            404: errorResponse("Delivery or project not found.")
          }
        }
      }
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key"
        },
        BearerAuth: {
          type: "http",
          scheme: "bearer"
        }
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string" },
            details: { type: ["string", "null"] }
          }
        },
        IntegrationHealthResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", const: true },
            authConfigured: { type: "boolean" },
            client: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                project_ids: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            },
            contract: {
              type: "object",
              properties: {
                version: { type: "string" },
                changelog_url: { type: "string" },
                openapi_url: { type: "string" }
              }
            },
            background: {
              type: "object",
              properties: {
                role: { type: "string" },
                schedulerEnabled: { type: "boolean" },
                webhooksEnabled: { type: "boolean" }
              }
            }
          }
        },
        IntegrationProject: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            type: { type: "string" },
            mailbox: { type: ["string", "null"] },
            recent_messages_count: { type: "integer" }
          }
        },
        IntegrationProjectsResponse: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/IntegrationProject" }
            }
          }
        },
        IntegrationVersionPolicy: {
          type: "object",
          properties: {
            stability: { type: "string" },
            additive_changes: { type: "string" },
            breaking_changes: { type: "string" },
            deprecation_notice_days: { type: "integer" },
            retry_safety: {
              type: "object",
              properties: {
                ack: { type: "string" },
                requeue: { type: "string" }
              }
            }
          }
        },
        IntegrationChangelogEntry: {
          type: "object",
          properties: {
            version: { type: "string" },
            released_at: { type: "string", format: "date" },
            changes: {
              type: "array",
              items: { type: "string" }
            }
          }
        },
        IntegrationChangelogDocument: {
          type: "object",
          properties: {
            name: { type: "string" },
            current_version: { type: "string" },
            openapi_url: { type: "string" },
            changelog_url: { type: "string" },
            policy: { $ref: "#/components/schemas/IntegrationVersionPolicy" },
            changelog: {
              type: "array",
              items: { $ref: "#/components/schemas/IntegrationChangelogEntry" }
            }
          },
          example: buildLegacyIntegrationChangelogDocument()
        },
        IntegrationAttachment: {
          type: "object",
          properties: {
            filename: { type: "string" },
            content_type: { type: ["string", "null"] },
            size: { type: ["integer", "null"] },
            safe_name: { type: ["string", "null"] },
            download_url: { type: ["string", "null"] }
          }
        },
        IntegrationLineItem: {
          type: "object",
          properties: {
            article: { type: ["string", "null"] },
            quantity: { type: ["number", "integer", "null"] },
            unit: { type: ["string", "null"] },
            description_ru: { type: ["string", "null"] }
          }
        },
        IntegrationMessage: {
          type: "object",
          properties: {
            project_id: { type: "string" },
            project_name: { type: "string" },
            message_key: { type: "string" },
            created_at: { type: ["string", "null"], format: "date-time" },
            updated_at: { type: ["string", "null"], format: "date-time" },
            mailbox: { type: ["string", "null"] },
            brand: { type: ["string", "null"] },
            subject: { type: "string" },
            from: { type: "string" },
            body_preview: { type: "string" },
            body_full: { type: ["string", "null"] },
            pipeline_status: { type: "string" },
            thread_id: { type: ["string", "null"] },
            message_meta: {
              type: "object",
              properties: {
                recognition_confirmed: { type: "boolean" },
                recognition_confirmed_at: { type: ["string", "null"], format: "date-time" },
                age_hours: { type: ["number", "null"] },
                priority: { type: ["string", "null"] },
                risk_level: { type: ["string", "null"] },
                has_conflicts: { type: "boolean" },
                sla_overdue: { type: "boolean" },
                moderated: { type: "boolean" },
                moderation_verdict: { type: ["string", "null"] },
                moderated_at: { type: ["string", "null"], format: "date-time" },
                moderated_by: { type: ["string", "null"] }
              }
            },
            export: {
              type: "object",
              properties: {
                acknowledged: { type: "boolean" },
                acknowledged_at: { type: ["string", "null"], format: "date-time" },
                consumer: { type: ["string", "null"] },
                external_id: { type: ["string", "null"] },
                note: { type: ["string", "null"] }
              }
            },
            error: { type: ["string", "null"] },
            attachments: {
              type: "array",
              items: { $ref: "#/components/schemas/IntegrationAttachment" }
            },
            classification: {
              type: "object",
              properties: {
                label: { type: ["string", "null"] },
                confidence: { type: ["number", "null"] },
                detected_brands: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            },
            sender: {
              type: "object",
              properties: {
                email: { type: ["string", "null"] },
                full_name: { type: ["string", "null"] },
                position: { type: ["string", "null"] },
                company_name: { type: ["string", "null"] },
                website: { type: ["string", "null"] },
                city_phone: { type: ["string", "null"] },
                mobile_phone: { type: ["string", "null"] },
                inn: { type: ["string", "null"] },
                kpp: { type: ["string", "null"] },
                ogrn: { type: ["string", "null"] }
              }
            },
            lead: {
              type: "object",
              properties: {
                request_type: { type: ["string", "null"] },
                free_text: { type: "string" },
                total_positions: { type: "integer" },
                articles: {
                  type: "array",
                  items: { type: "string" }
                },
                line_items: {
                  type: "array",
                  items: { $ref: "#/components/schemas/IntegrationLineItem" }
                },
                detected_brands: {
                  type: "array",
                  items: { type: "string" }
                },
                detected_product_types: {
                  type: "array",
                  items: { type: "string" }
                },
                product_names: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      article: { type: ["string", "null"] },
                      name: { type: ["string", "null"] },
                      category: { type: ["string", "null"] }
                    }
                  }
                },
                nomenclature_matches: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      article: { type: ["string", "null"] },
                      brand: { type: ["string", "null"] },
                      product_name: { type: ["string", "null"] },
                      description: { type: ["string", "null"] },
                      source_rows: { type: "integer" },
                      avg_price: { type: ["number", "null"] },
                      match_type: { type: ["string", "null"] }
                    }
                  }
                },
                recognition_decision: { type: ["object", "null"] },
                sources: { type: ["object", "null"] },
                recognition_summary: { type: ["object", "null"] },
                recognition_diagnostics: { type: ["object", "null"] },
                has_nameplate_photos: { type: "boolean" },
                has_article_photos: { type: "boolean" }
              }
            },
            attachment_analysis: { type: ["object", "null"] },
            extraction_meta: { type: ["object", "null"] },
            audit: {
              type: ["array", "null"],
              items: {
                type: "object",
                properties: {
                  at: { type: ["string", "null"], format: "date-time" },
                  action: { type: ["string", "null"] },
                  from: { type: ["string", "null"] },
                  to: { type: ["string", "null"] },
                  changes: { type: "array", items: { type: "string" } },
                  fields: { type: ["object", "null"] },
                  consumer: { type: ["string", "null"] },
                  external_id: { type: ["string", "null"] },
                  note: { type: ["string", "null"] }
                }
              }
            },
            crm: {
              type: "object",
              properties: {
                is_existing_company: { type: "boolean" },
                needs_clarification: { type: "boolean" },
                curator_mop: { type: ["string", "null"] },
                curator_moz: { type: ["string", "null"] },
                suggested_reply: { type: ["string", "null"] },
                company: {
                  type: ["object", "null"],
                  properties: {
                    id: { type: ["string", "null"] },
                    legal_name: { type: ["string", "null"] },
                    inn: { type: ["string", "null"] },
                    domain: { type: ["string", "null"] }
                  }
                }
              }
            }
          }
        },
        IntegrationMessageResponse: {
          type: "object",
          properties: {
            data: { $ref: "#/components/schemas/IntegrationMessage" }
          }
        },
        IntegrationPresetListResponse: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  description: { type: "string" },
                  query: {
                    type: "object",
                    additionalProperties: { type: "string" }
                  }
                }
              }
            }
          }
        },
        IntegrationMessageQueryMeta: {
          type: "object",
          properties: {
            preset: { type: ["string", "null"] },
            statuses: {
              type: "array",
              items: { type: "string" }
            },
            exported: { type: ["boolean", "null"] },
            brand: { type: ["string", "null"] },
            label: { type: ["string", "null"] },
            q: { type: ["string", "null"] },
            has_attachments: { type: ["boolean", "null"] },
            attachment_ext: {
              type: ["array", "null"],
              items: { type: "string" }
            },
            min_attachments: { type: ["integer", "null"] },
            product_type: {
              type: ["array", "null"],
              items: { type: "string" }
            },
            confirmed: { type: ["boolean", "null"] },
            priority: {
              type: ["array", "null"],
              items: { type: "string" }
            },
            risk: {
              type: ["array", "null"],
              items: { type: "string" }
            },
            has_conflicts: { type: ["boolean", "null"] },
            company_present: { type: ["boolean", "null"] },
            inn_present: { type: ["boolean", "null"] },
            phone_present: { type: ["boolean", "null"] },
            article_present: { type: ["boolean", "null"] },
            sla_overdue: { type: ["boolean", "null"] },
            include: {
              type: "array",
              items: { type: "string" }
            },
            since: { type: ["string", "null"], format: "date-time" },
            cursor: { type: ["string", "null"] },
            next_cursor: { type: ["string", "null"] },
            next_since: { type: ["string", "null"], format: "date-time" }
          }
        },
        IntegrationMessageListResponse: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/IntegrationMessage" }
            },
            pagination: {
              type: "object",
              properties: {
                page: { type: ["integer", "null"] },
                limit: { type: "integer" },
                total: { type: "integer" },
                total_pages: { type: ["integer", "null"] }
              }
            },
            meta: { $ref: "#/components/schemas/IntegrationMessageQueryMeta" }
          }
        },
        IntegrationMessageStatsResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                total_messages: { type: "integer" },
                by_status: { type: "object", additionalProperties: { type: "integer" } },
                by_classification: { type: "object", additionalProperties: { type: "integer" } },
                priorities: { type: "object", additionalProperties: { type: "integer" } },
                risks: { type: "object", additionalProperties: { type: "integer" } },
                confirmed_count: { type: "integer" },
                unconfirmed_count: { type: "integer" },
                conflicts_count: { type: "integer" },
                exported_count: { type: "integer" },
                with_attachments_count: { type: "integer" },
                parsed_attachments_count: { type: "integer" },
                sla_overdue_count: { type: "integer" },
                avg_confidence: { type: ["number", "null"] },
                avg_completeness_score: { type: ["number", "null"] },
                last_message_at: { type: ["string", "null"], format: "date-time" }
              }
            },
            meta: { $ref: "#/components/schemas/IntegrationMessageQueryMeta" }
          }
        },
        IntegrationCoverageResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                total_messages: { type: "integer" },
                fields: {
                  type: "object",
                  additionalProperties: {
                    type: "object",
                    properties: {
                      present: { type: "integer" },
                      missing: { type: "integer" },
                      coverage_rate: { type: ["number", "null"] }
                    }
                  }
                }
              }
            },
            meta: { $ref: "#/components/schemas/IntegrationMessageQueryMeta" }
          }
        },
        IntegrationProblemQueueResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                total_problem_messages: { type: "integer" },
                by_issue: { type: "object", additionalProperties: { type: "integer" } },
                top_messages: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      message_key: { type: "string" },
                      subject: { type: "string" },
                      from: { type: "string" },
                      pipeline_status: { type: "string" },
                      updated_at: { type: ["string", "null"], format: "date-time" },
                      priority: { type: ["string", "null"] },
                      risk_level: { type: ["string", "null"] },
                      age_hours: { type: ["number", "null"] },
                      recognition_confirmed: { type: "boolean" },
                      issue_keys: {
                        type: "array",
                        items: { type: "string" }
                      },
                      primary_issue: { type: ["string", "null"] },
                      sla_overdue: { type: "boolean" }
                    }
                  }
                }
              }
            },
            meta: {
              allOf: [
                { $ref: "#/components/schemas/IntegrationMessageQueryMeta" },
                {
                  type: "object",
                  properties: {
                    limit: { type: "integer" }
                  }
                }
              ]
            }
          }
        },
        IntegrationThread: {
          type: "object",
          properties: {
            thread_id: { type: "string" },
            message_count: { type: "integer" },
            first_message_at: { type: ["string", "null"], format: "date-time" },
            last_message_at: { type: ["string", "null"], format: "date-time" },
            participants: {
              type: "array",
              items: { type: "string" }
            },
            subjects: {
              type: "array",
              items: { type: "string" }
            },
            pipeline_statuses: {
              type: "array",
              items: { type: "string" }
            },
            priorities: {
              type: "array",
              items: { type: "string" }
            },
            risk_levels: {
              type: "array",
              items: { type: "string" }
            },
            has_conflicts: { type: "boolean" },
            sla_overdue: { type: "boolean" },
            message_keys: {
              type: "array",
              items: { type: "string" }
            },
            messages: {
              type: ["array", "null"],
              items: { $ref: "#/components/schemas/IntegrationMessage" }
            }
          }
        },
        IntegrationThreadListResponse: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/IntegrationThread" }
            },
            meta: {
              allOf: [
                { $ref: "#/components/schemas/IntegrationMessageQueryMeta" },
                {
                  type: "object",
                  properties: {
                    include_messages: { type: "boolean" }
                  }
                }
              ]
            }
          }
        },
        IntegrationThreadResponse: {
          type: "object",
          properties: {
            data: { $ref: "#/components/schemas/IntegrationThread" }
          }
        },
        IntegrationEvent: {
          type: "object",
          properties: {
            id: { type: "string" },
            at: { type: "string", format: "date-time" },
            scope: { type: "string" },
            type: { type: "string" },
            project_id: { type: "string" },
            message_key: { type: ["string", "null"] },
            thread_id: { type: ["string", "null"] },
            delivery_id: { type: ["string", "null"] },
            pipeline_status: { type: ["string", "null"] },
            delivery_status: { type: ["string", "null"] },
            action: { type: ["string", "null"] },
            consumer: { type: ["string", "null"] },
            external_id: { type: ["string", "null"] },
            summary: { type: ["string", "null"] }
          }
        },
        IntegrationEventListResponse: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/IntegrationEvent" }
            },
            pagination: {
              type: "object",
              properties: {
                limit: { type: "integer" },
                total: { type: "integer" }
              }
            },
            meta: {
              allOf: [
                { $ref: "#/components/schemas/IntegrationMessageQueryMeta" },
                {
                  type: "object",
                  properties: {
                    type: {
                      type: ["array", "null"],
                      items: { type: "string" }
                    },
                    scope: {
                      type: ["array", "null"],
                      items: { type: "string" }
                    },
                    cursor: { type: ["string", "null"] },
                    next_cursor: { type: ["string", "null"] }
                  }
                }
              ]
            }
          }
        },
        IntegrationAckRequest: {
          type: "object",
          properties: {
            idempotencyKey: { type: ["string", "null"] },
            externalId: { type: ["string", "null"] },
            note: { type: ["string", "null"] }
          }
        },
        IntegrationDelivery: {
          type: "object",
          properties: {
            id: { type: "string" },
            client_id: { type: ["string", "null"] },
            client_name: { type: ["string", "null"] },
            key: { type: "string" },
            event: { type: "string" },
            message_key: { type: "string" },
            pipeline_status: { type: "string" },
            status: { type: "string" },
            attempts: { type: "integer" },
            created_at: { type: ["string", "null"], format: "date-time" },
            updated_at: { type: ["string", "null"], format: "date-time" },
            next_attempt_at: { type: ["string", "null"], format: "date-time" },
            last_attempt_at: { type: ["string", "null"], format: "date-time" },
            delivered_at: { type: ["string", "null"], format: "date-time" },
            last_error: { type: ["string", "null"] },
            response_status: { type: ["integer", "null"] },
            last_manual_action: {
              type: ["object", "null"],
              properties: {
                action: { type: ["string", "null"] },
                reason: { type: ["string", "null"] },
                at: { type: ["string", "null"], format: "date-time" }
              }
            }
          }
        },
        IntegrationDeliveryResponse: {
          type: "object",
          properties: {
            data: { $ref: "#/components/schemas/IntegrationDelivery" }
          }
        },
        IntegrationDeliveryListResponse: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/IntegrationDelivery" }
            },
            meta: {
              type: "object",
              properties: {
                statuses: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            }
          }
        },
        IntegrationDeliveryDiagnostics: {
          type: "object",
          properties: {
            total_deliveries: { type: "integer" },
            by_status: {
              type: "object",
              additionalProperties: { type: "integer" }
            },
            pending_backlog: { type: "integer" },
            failed_backlog: { type: "integer" },
            delivered_count: { type: "integer" },
            success_rate: { type: ["number", "null"] },
            total_attempts: { type: "integer" },
            max_attempts: { type: "integer" },
            last_attempt_at: { type: ["string", "null"], format: "date-time" },
            last_delivered_at: { type: ["string", "null"], format: "date-time" },
            next_attempt_at: { type: ["string", "null"], format: "date-time" },
            oldest_pending_created_at: { type: ["string", "null"], format: "date-time" },
            response_statuses: {
              type: "object",
              additionalProperties: { type: "integer" }
            },
            failure_reasons: {
              type: "object",
              additionalProperties: { type: "integer" }
            },
            recent_failures: {
              type: "array",
              items: { $ref: "#/components/schemas/IntegrationDelivery" }
            }
          }
        },
        IntegrationDeliveryDiagnosticsResponse: {
          type: "object",
          properties: {
            data: { $ref: "#/components/schemas/IntegrationDeliveryDiagnostics" },
            meta: {
              type: "object",
              properties: {
                statuses: {
                  type: "array",
                  items: { type: "string" }
                },
                recent_failures_limit: { type: "integer" }
              }
            }
          }
        },
        IntegrationRequeueRequest: {
          type: "object",
          properties: {
            idempotencyKey: { type: ["string", "null"] },
            reason: { type: ["string", "null"] }
          }
        }
      }
    }
  };
}

function pathParameter(name, description) {
  return {
    name,
    in: "path",
    required: true,
    description,
    schema: { type: "string" }
  };
}

function queryParameter(name, type, description, extra = {}) {
  return {
    name,
    in: "query",
    required: false,
    description,
    schema: { type, ...extra }
  };
}

function headerParameter(name, description) {
  return {
    name,
    in: "header",
    required: false,
    description,
    schema: { type: "string" }
  };
}

function unauthorizedResponse() {
  return errorResponse("Unauthorized. Provide x-api-key or Bearer token.", 401);
}

function errorResponse(message, statusCode = 400) {
  return {
    description: `HTTP ${statusCode}`,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
        example: {
          error: message
        }
      }
    }
  };
}
