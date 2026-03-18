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
      "/api/integration/projects/{projectId}/messages": {
        get: {
          tags: ["Integration"],
          summary: "List parsed messages",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            queryParameter("page", "integer", "Page number for offset pagination"),
            queryParameter("limit", "integer", "Items per page or cursor page size"),
            queryParameter("status", "string", "Comma-separated pipeline statuses"),
            queryParameter("since", "string", "ISO datetime filter for updated_at", { format: "date-time" }),
            queryParameter("exported", "string", "Filter by export acknowledgement state"),
            queryParameter("cursor", "string", "Opaque cursor for keyset pagination")
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
      "/api/integration/projects/{projectId}/messages/{messageKey}": {
        get: {
          tags: ["Integration"],
          summary: "Get a single parsed message",
          parameters: [
            pathParameter("projectId", "Project identifier"),
            pathParameter("messageKey", "Normalized message key")
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
            pipeline_status: { type: "string" },
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
                inn: { type: ["string", "null"] }
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
                has_nameplate_photos: { type: "boolean" },
                has_article_photos: { type: "boolean" }
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
            meta: {
              type: "object",
              properties: {
                statuses: {
                  type: "array",
                  items: { type: "string" }
                },
                exported: { type: ["boolean", "null"] },
                since: { type: ["string", "null"], format: "date-time" },
                cursor: { type: ["string", "null"] },
                next_cursor: { type: ["string", "null"] },
                next_since: { type: ["string", "null"], format: "date-time" }
              }
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
