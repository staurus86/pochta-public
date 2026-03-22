import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectsStore } from "./storage/projects-store.js";
import { analyzeEmail, analyzeEmailAsync } from "./services/email-analyzer.js";
import { isAiEnabled, getAiConfig } from "./services/ai-classifier.js";
import { getCrmConfig, syncProjectToCrm } from "./services/crm-sync.js";
import { normalizeBackgroundRole, shouldRunScheduler, shouldRunWebhooks } from "./services/background-role.js";
import { HttpError, parseJsonBody, resolveJsonBodyLimit } from "./services/http-json.js";
import { resolveIdempotencyKey } from "./services/idempotency.js";
import { canClientAccessProject, loadIntegrationClients, resolveIntegrationClient } from "./services/integration-clients.js";
import { buildLegacyIntegrationChangelogDocument, getLegacyIntegrationApiVersion } from "./services/integration-contract.js";
import { buildLegacyIntegrationOpenApi } from "./services/integration-openapi.js";
import { getTenderRuntime, runTenderImporter } from "./services/tender-runner.js";
import { ProjectScheduler } from "./services/project-scheduler.js";
import { getMailboxFileRuntime, reprocessMailboxMessages, runMailboxFileParser } from "./services/project3-runner.js";
import { detectionKb } from "./services/detection-kb.js";
import { ManagerAuth } from "./services/manager-auth.js";
import { findIntegrationDelivery, findIntegrationMessage, listIntegrationDeliveries, listIntegrationMessages, parseIntegrationCursor, summarizeIntegrationDeliveries } from "./services/integration-api.js";
import { LegacyWebhookDispatcher } from "./services/webhook-dispatcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = path.resolve(rootDir, process.env.DATA_DIR || "data");
const managerAuth = new ManagerAuth(path.join(dataDir, "manager-auth.sqlite"));
managerAuth.ensureAdmin();
const host = String(process.env.HOST || "0.0.0.0").trim() || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const jsonBodyLimitBytes = resolveJsonBodyLimit(process.env.LEGACY_MAX_JSON_BODY_BYTES, 64 * 1024);
const backgroundRole = normalizeBackgroundRole(process.env.LEGACY_BACKGROUND_ROLE || "all");
const envClients = loadIntegrationClients(process.env);

function getIntegrationClients() {
  const dbClients = detectionKb.getApiClientsForAuth();
  return [...envClients, ...dbClients];
}

function normalizeClassificationForKb(label) {
  const value = String(label || "").trim().toLowerCase();
  if (value === "клиент" || value === "client") return "client";
  if (value === "спам" || value === "spam") return "spam";
  if (value === "поставщик услуг" || value === "поставщик" || value === "vendor") return "vendor";
  return "client";
}

function getEmailDomain(email) {
  return String(email || "").split("@")[1]?.trim().toLowerCase() || "";
}

// ── Rate limiter (sliding window) ──
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120);
const rateLimitBuckets = new Map();

function checkRateLimit(clientId) {
  const now = Date.now();
  if (!rateLimitBuckets.has(clientId)) {
    rateLimitBuckets.set(clientId, []);
  }
  const timestamps = rateLimitBuckets.get(clientId);
  // Purge old entries
  while (timestamps.length > 0 && timestamps[0] <= now - RATE_LIMIT_WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }
  timestamps.push(now);
  return { allowed: true, remaining: RATE_LIMIT_MAX - timestamps.length, retryAfter: 0 };
}

// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
  for (const [key, ts] of rateLimitBuckets) {
    if (ts.length === 0 || ts[ts.length - 1] < cutoff) rateLimitBuckets.delete(key);
  }
}, 300_000).unref();

const integrationClients = getIntegrationClients();
const store = new ProjectsStore({ dataDir });
const webhookDispatcher = new LegacyWebhookDispatcher({
  store,
  integrationClients,
  logger: console,
  intervalMs: Number(process.env.LEGACY_WEBHOOK_INTERVAL_MS || 15000),
  timeoutMs: Number(process.env.LEGACY_WEBHOOK_TIMEOUT_MS || 10000)
});
const scheduler = new ProjectScheduler({
  store,
  rootDir,
  onRunCompleted: async (project, run) => {
    if (Array.isArray(run.newMessages) && run.newMessages.length > 0) {
      await webhookDispatcher.enqueueProjectMessages(project.id, run.newMessages);
    }
  }
});

// Background job tracking for long-running tasks
const backgroundJobs = new Map();

// ── SSE (Server-Sent Events) for real-time notifications ──
const sseClients = new Set();

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function notifyNewMessages(projectId, count, trigger = "run") {
  broadcastSSE("messages", { projectId, count, trigger, at: new Date().toISOString() });
}

function notifyStatusChange(projectId, messageKey, status) {
  broadcastSSE("status", { projectId, messageKey, status, at: new Date().toISOString() });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/railway-health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname.startsWith("/api/integration/")) {
      await handleIntegrationApi(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (url.pathname === "/manager" || url.pathname === "/manager/") {
      await serveStatic("/manager.html", res);
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = statusCode >= 500 ? "Internal Server Error" : error.message;
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: message, details: error.message }));
  }
});

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
  console.log(`Legacy background role: ${backgroundRole}`);

  if (shouldRunScheduler(backgroundRole)) {
    scheduler.start();
  }

  if (shouldRunWebhooks(backgroundRole)) {
    webhookDispatcher.start();
  }
});

process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down gracefully...");
    scheduler.stop();
    webhookDispatcher.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
});

async function parseRequestJson(req) {
  return parseJsonBody(req, { maxBytes: jsonBodyLimitBytes });
}

function createBackgroundJob(projectId) {
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id: jobId,
    projectId,
    status: "running",
    run: null,
    error: null,
    startedAt: new Date().toISOString()
  };
  backgroundJobs.set(jobId, job);
  return job;
}

async function finalizeProjectRun(job, project, run) {
  await store.appendRun(project.id, run);
  if (Array.isArray(run.recentMessages)) {
    await store.replaceRecentMessages(project.id, run.recentMessages);
  }
  if (Array.isArray(run.newMessages) && run.newMessages.length > 0) {
    await webhookDispatcher.enqueueProjectMessages(project.id, run.newMessages);
  }
  job.status = "done";
  job.run = run;
  // SSE notification
  const msgCount = run.recentMessages?.length || run.newMessages?.length || 0;
  if (msgCount > 0) notifyNewMessages(project.id, msgCount, "run");

  // Auto CRM sync for ready_for_crm messages
  const crmConfig = getCrmConfig(project);
  if (crmConfig.enabled) {
    const { normalizeIntegrationMessage } = await import("./services/integration-api.js");
    syncProjectToCrm(project, store, (proj, msg, opts) =>
      normalizeIntegrationMessage(proj, msg, opts), { limit: 20 }
    ).then((result) => {
      if (result.synced > 0) {
        console.log(`CRM auto-sync: ${result.synced} messages pushed to ${result.crmType}`);
        broadcastSSE("crm-sync", { projectId: project.id, ...result });
      }
    }).catch((err) => console.warn("CRM auto-sync error:", err.message));
  }
}

function extractAuthUser(req) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return null;
    return managerAuth.verifyToken(token);
}

function requireAuth(req, roles = []) {
    const user = extractAuthUser(req);
    if (!user) throw new HttpError(401, "Authentication required");
    if (roles.length > 0 && !roles.includes(user.role)) throw new HttpError(403, "Insufficient permissions");
    return user;
}

async function handleApi(req, res, url) {
  // ── SSE endpoint for real-time notifications ──
  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    // Keep alive every 30s
    const keepAlive = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch { clearInterval(keepAlive); sseClients.delete(res); }
    }, 30000);
    req.on("close", () => clearInterval(keepAlive));
    return;
  }

  // ── Auth endpoints ──
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const payload = await parseRequestJson(req);
    if (!payload.login || !payload.password) {
      return sendJson(res, 400, { error: "Fields 'login' and 'password' are required." });
    }
    const result = managerAuth.authenticate(payload.login, payload.password);
    if (!result) return sendJson(res, 401, { error: "Invalid credentials." });
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = requireAuth(req);
    return sendJson(res, 200, { user });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/users") {
    requireAuth(req, ["admin"]);
    return sendJson(res, 200, { users: managerAuth.listUsers() });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/users") {
    requireAuth(req, ["admin"]);
    const payload = await parseRequestJson(req);
    if (!payload.login || !payload.password || !payload.fullName) {
      return sendJson(res, 400, { error: "Fields 'login', 'password', 'fullName' are required." });
    }
    try {
      const user = managerAuth.createUser(payload);
      return sendJson(res, 201, { user });
    } catch (e) {
      return sendJson(res, 409, { error: "Login already exists." });
    }
  }

  const authUserMatch = url.pathname.match(/^\/api\/auth\/users\/(\d+)$/);
  if (req.method === "PATCH" && authUserMatch) {
    requireAuth(req, ["admin"]);
    const payload = await parseRequestJson(req);
    const user = managerAuth.updateUser(Number(authUserMatch[1]), payload);
    if (!user) return sendJson(res, 404, { error: "User not found." });
    return sendJson(res, 200, { user });
  }

  if (req.method === "DELETE" && authUserMatch) {
    requireAuth(req, ["admin"]);
    const result = managerAuth.deleteUser(Number(authUserMatch[1]));
    return sendJson(res, 200, result);
  }

  // ── Manager moderation endpoints ──
  if (req.method === "GET" && url.pathname === "/api/manager/inbox") {
    const user = requireAuth(req, ["manager", "admin"]);
    const projectId = url.searchParams.get("project_id") || null;
    const projects = await store.listProjects();

    // Get messages from specified project or all projects
    let allMessages = [];
    const targetProjects = projectId
        ? projects.filter((p) => p.id === projectId)
        : projects;

    for (const project of targetProjects) {
      const messages = (project.recentMessages || [])
          .filter((m) => ["ready_for_crm", "review"].includes(m.pipelineStatus))
          .map((m) => ({
            projectId: project.id,
            projectName: project.name,
            messageKey: m.messageKey || m.id,
            subject: m.subject || "",
            from: m.from || m.analysis?.sender?.email || "",
            fromName: m.analysis?.sender?.fullName || "",
            companyName: m.analysis?.sender?.companyName || "",
            pipelineStatus: m.pipelineStatus,
            classification: m.analysis?.classification?.label || "",
            detectedBrands: m.analysis?.detectedBrands || [],
            articles: m.analysis?.lead?.articles || [],
            productNames: m.analysis?.lead?.productNames || [],
            detectedProductTypes: m.analysis?.lead?.detectedProductTypes || [],
            lineItems: m.analysis?.lead?.lineItems || [],
            totalPositions: m.analysis?.lead?.totalPositions || 0,
            urgency: m.analysis?.lead?.urgency || "normal",
            bodyPreview: (m.bodyPreview || m.analysis?.lead?.freeText || "").slice(0, 300),
            attachments: (m.attachmentFiles || m.attachments || []).map((a) => typeof a === "string" ? a : (a.filename || a.name || "")),
            moderationVerdict: m.moderationVerdict || null,
            moderationComment: m.moderationComment || null,
            moderatedBy: m.moderatedBy || null,
            moderatedAt: m.moderatedAt || null,
            createdAt: m.createdAt || null
          }));
      allMessages.push(...messages);
    }

    // Sort by date descending
    allMessages.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    return sendJson(res, 200, { messages: allMessages, total: allMessages.length, user: user.fullName });
  }

  const moderateMatch = url.pathname.match(/^\/api\/manager\/moderate\/([^/]+)$/);
  if (req.method === "POST" && moderateMatch) {
    const user = requireAuth(req, ["manager", "admin"]);
    const payload = await parseRequestJson(req);
    const verdict = payload.verdict;

    if (!["approved", "needs_rework"].includes(verdict)) {
      return sendJson(res, 400, { error: "Field 'verdict' must be 'approved' or 'needs_rework'." });
    }
    if (verdict === "needs_rework" && !payload.comment?.trim()) {
      return sendJson(res, 400, { error: "Field 'comment' is required when verdict is 'needs_rework'." });
    }

    const projectId = payload.projectId || "mailroom-primary";
    const messageKey = decodeURIComponent(moderateMatch[1]);

    const result = await store.applyMessageFeedback(projectId, messageKey, {
      moderationVerdict: verdict,
      moderationComment: payload.comment || "",
      moderatedBy: user.fullName
    });

    if (!result) return sendJson(res, 404, { error: "Message not found." });

    // Determine new status based on verdict
    const newStatus = verdict === "approved" ? "ready_for_crm" : "review";
    notifyStatusChange(projectId, messageKey, newStatus);
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      background: {
        role: backgroundRole,
        schedulerEnabled: shouldRunScheduler(backgroundRole),
        webhooksEnabled: shouldRunWebhooks(backgroundRole)
      },
      ai: getAiConfig(),
      sse: { clients: sseClients.size },
      rateLimit: { max: RATE_LIMIT_MAX, windowSeconds: RATE_LIMIT_WINDOW_MS / 1000 }
    });
  }

  if (req.method === "GET" && url.pathname === "/api/detection-kb") {
    return sendJson(res, 200, {
      stats: detectionKb.getStats(),
      nomenclatureStats: detectionKb.getNomenclatureStats(),
      rules: detectionKb.getRules(),
      brandAliases: detectionKb.getBrandAliases(),
      senderProfiles: detectionKb.getSenderProfiles(),
      autoLearnedSenderProfiles: detectionKb.getSenderProfiles().filter((item) => String(item.notes || "").includes("Auto-learn from feedback")),
      learnedNomenclature: detectionKb.getLearnedNomenclature(150),
      ownBrands: detectionKb.getOwnBrands(),
      corpus: detectionKb.getCorpus(25)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/rules") {
    const payload = await parseRequestJson(req);
    if (!payload.scope || !payload.classifier || !payload.matchType || !payload.pattern) {
      return sendJson(res, 400, { error: "Fields 'scope', 'classifier', 'matchType' and 'pattern' are required." });
    }

    const rule = detectionKb.addRule(payload);
    return sendJson(res, 201, { rule });
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/brand-aliases") {
    const payload = await parseRequestJson(req);
    if (!payload.canonicalBrand || !payload.alias) {
      return sendJson(res, 400, { error: "Fields 'canonicalBrand' and 'alias' are required." });
    }

    const brandAlias = detectionKb.addBrandAlias(payload);
    return sendJson(res, 201, { brandAlias });
  }

  const deleteRuleMatch = url.pathname.match(/^\/api\/detection-kb\/rules\/(\d+)$/);
  if (req.method === "DELETE" && deleteRuleMatch) {
    const result = detectionKb.deactivateRule(deleteRuleMatch[1]);
    return sendJson(res, 200, result);
  }

  const deleteSenderMatch = url.pathname.match(/^\/api\/detection-kb\/sender-profiles\/(\d+)$/);
  if (req.method === "DELETE" && deleteSenderMatch) {
    const result = detectionKb.deactivateSenderProfile(deleteSenderMatch[1]);
    return sendJson(res, 200, result);
  }

  const deleteBrandMatch = url.pathname.match(/^\/api\/detection-kb\/brand-aliases\/(\d+)$/);
  if (req.method === "DELETE" && deleteBrandMatch) {
    const result = detectionKb.deactivateBrandAlias(deleteBrandMatch[1]);
    return sendJson(res, 200, result);
  }

  const deleteNomenclatureMatch = url.pathname.match(/^\/api\/detection-kb\/nomenclature\/(\d+)$/);
  if (req.method === "DELETE" && deleteNomenclatureMatch) {
    const result = detectionKb.deleteNomenclatureEntry(deleteNomenclatureMatch[1]);
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/sender-profiles") {
    const payload = await parseRequestJson(req);
    if (!payload.classification) {
      return sendJson(res, 400, { error: "Field 'classification' is required." });
    }

    const senderProfile = detectionKb.addSenderProfile(payload);
    return sendJson(res, 201, { senderProfile });
  }

  if (req.method === "GET" && url.pathname === "/api/detection-kb/own-brands") {
    return sendJson(res, 200, { ownBrands: detectionKb.getOwnBrands() });
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/own-brands") {
    const payload = await parseRequestJson(req);
    if (!payload.name) {
      return sendJson(res, 400, { error: "Field 'name' is required." });
    }

    const ownBrand = detectionKb.addOwnBrand(payload);
    return sendJson(res, 201, { ownBrand });
  }

  const deleteOwnBrandMatch = url.pathname.match(/^\/api\/detection-kb\/own-brands\/(\d+)$/);
  if (req.method === "DELETE" && deleteOwnBrandMatch) {
    const result = detectionKb.deactivateOwnBrand(deleteOwnBrandMatch[1]);
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/brand-catalog/import") {
    const payload = await parseRequestJson(req);
    if (!Array.isArray(payload.brands)) {
      return sendJson(res, 400, { error: "Field 'brands' must be an array of { canonical, aliases[] }." });
    }

    const result = detectionKb.importBrandCatalog(payload.brands);
    return sendJson(res, 200, result);
  }

  if (req.method === "DELETE" && url.pathname === "/api/detection-kb/brand-catalog") {
    const result = detectionKb.clearBrandAliases();
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && url.pathname === "/api/detection-kb/nomenclature") {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    return sendJson(res, 200, {
      stats: detectionKb.getNomenclatureStats(),
      items: detectionKb.getNomenclature(limit)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/detection-kb/nomenclature/search") {
    const q = url.searchParams.get("q") || "";
    const brand = url.searchParams.get("brand") || null;
    const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);
    if (!q.trim()) {
      return sendJson(res, 400, { error: "Query parameter 'q' is required." });
    }
    return sendJson(res, 200, {
      results: detectionKb.searchNomenclature(q, { brand, limit }),
      stats: detectionKb.getNomenclatureStats()
    });
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/nomenclature/import") {
    const payload = await parseRequestJson(req);
    if (!Array.isArray(payload.items)) {
      return sendJson(res, 400, { error: "Field 'items' must be an array of nomenclature entries." });
    }
    const result = detectionKb.importNomenclatureCatalog(payload.items, {
      sourceFile: payload.sourceFile || ""
    });
    return sendJson(res, 200, result);
  }

  // ── Corpus search (FTS5) ──
  if (req.method === "GET" && url.pathname === "/api/detection-kb/corpus/search") {
    const q = url.searchParams.get("q") || "";
    const projectId = url.searchParams.get("project_id") || null;
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    if (!q.trim()) {
      return sendJson(res, 400, { error: "Query parameter 'q' is required." });
    }
    const results = detectionKb.searchCorpus(q, { projectId, limit });
    return sendJson(res, 200, { results, total: results.length, query: q });
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/corpus/rebuild-index") {
    detectionKb.rebuildFtsIndex();
    return sendJson(res, 200, { ok: true, message: "FTS index rebuilt" });
  }

  // ── API Clients management ──
  if (req.method === "GET" && url.pathname === "/api/detection-kb/api-clients") {
    return sendJson(res, 200, { clients: detectionKb.getApiClients() });
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/api-clients") {
    const payload = await parseRequestJson(req);
    if (!payload.name) {
      return sendJson(res, 400, { error: "Field 'name' is required." });
    }

    const client = detectionKb.createApiClient(payload);
    return sendJson(res, 201, { client });
  }

  const apiClientMatch = url.pathname.match(/^\/api\/detection-kb\/api-clients\/([^/]+)$/);
  if (req.method === "PATCH" && apiClientMatch) {
    const payload = await parseRequestJson(req);
    const client = detectionKb.updateApiClient(apiClientMatch[1], payload);
    if (!client) return sendJson(res, 404, { error: "Client not found." });
    return sendJson(res, 200, { client });
  }

  if (req.method === "DELETE" && apiClientMatch) {
    const result = detectionKb.deleteApiClient(apiClientMatch[1]);
    return sendJson(res, 200, result);
  }

  const regenerateKeyMatch = url.pathname.match(/^\/api\/detection-kb\/api-clients\/([^/]+)\/regenerate$/);
  if (req.method === "POST" && regenerateKeyMatch) {
    const client = detectionKb.regenerateApiKey(regenerateKeyMatch[1]);
    if (!client) return sendJson(res, 404, { error: "Client not found." });
    return sendJson(res, 200, { client });
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    const projects = await store.listProjects();
    return sendJson(res, 200, { projects });
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    const payload = await parseRequestJson(req);
    if (!payload.name || !payload.mailbox) {
      return sendJson(res, 400, { error: "Fields 'name' and 'mailbox' are required." });
    }

    const project = await store.createProject(payload);
    return sendJson(res, 201, { project });
  }

  // Attachment download
  const attachMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)\/(.+)$/);
  if (req.method === "GET" && attachMatch) {
    const messageKey = decodeURIComponent(attachMatch[1]);
    const filename = decodeURIComponent(attachMatch[2]);
    const safeName = filename.replace(/[<>:"/\\|?*]/g, "_");
    const filePath = path.join(dataDir, "attachments", messageKey, safeName);
    try {
      const contents = await readFile(filePath);
      const ext = path.extname(safeName).toLowerCase();
      const mimeTypes = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
        ".bmp": "image/bmp", ".tiff": "image/tiff", ".tif": "image/tiff",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".csv": "text/csv",
        ".txt": "text/plain",
        ".zip": "application/zip",
        ".rar": "application/x-rar-compressed"
      };
      const ct = mimeTypes[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": ct,
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": contents.length
      });
      return res.end(contents);
    } catch {
      return sendJson(res, 404, { error: "Attachment not found." });
    }
  }

  const runtimeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/runtime$/);
  if (req.method === "GET" && runtimeMatch) {
    const project = await store.getProject(runtimeMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    let runtime;
    if (project.type === "tender-importer") {
      runtime = await getTenderRuntime(project, rootDir);
    } else if (project.type === "mailbox-file-parser") {
      runtime = await getMailboxFileRuntime(project, rootDir);
    } else {
      return sendJson(res, 400, { error: "Runtime is available only for runner projects." });
    }

    return sendJson(res, 200, { runtime });
  }

  const jobMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/job\/([^/]+)$/);
  if (req.method === "GET" && jobMatch) {
    const job = backgroundJobs.get(jobMatch[2]);
    if (!job || job.projectId !== jobMatch[1]) {
      return sendJson(res, 404, { error: "Job not found." });
    }

    return sendJson(res, 200, { job: { id: job.id, status: job.status, run: job.run || null, error: job.error || null, startedAt: job.startedAt } });
  }

  const runMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/run$/);
  if (req.method === "POST" && runMatch) {
    const project = await store.getProject(runMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    if (!["tender-importer", "mailbox-file-parser"].includes(project.type)) {
      return sendJson(res, 400, { error: "Run action is available only for runner projects." });
    }

    const payload = await parseRequestJson(req);

    if (["mailbox-file-parser", "tender-importer"].includes(project.type)) {
      const job = createBackgroundJob(project.id);
      const runner = project.type === "mailbox-file-parser"
        ? () => runMailboxFileParser(project, rootDir, payload)
        : () => runTenderImporter(project, rootDir, payload);

      runner()
        .then(async (run) => {
          await finalizeProjectRun(job, project, run);
        })
        .catch((error) => {
          job.status = "error";
          job.error = error.code === "EPERM"
            ? "Process spawning is blocked in the current sandbox. Run locally or on Railway."
            : error.message;
        });

      return sendJson(res, 202, {
        jobId: job.id,
        message: "Запуск начат в фоновом режиме. Проверяйте статус через /api/projects/" + project.id + "/job/" + job.id
      });
    }
  }

  const reprocessMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/reprocess$/);
  if (req.method === "POST" && reprocessMatch) {
    const project = await store.getProject(reprocessMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    if (project.type !== "mailbox-file-parser") {
      return sendJson(res, 400, { error: "Reprocess action is available only for mailbox-file-parser projects." });
    }

    const payload = await parseRequestJson(req);
    const job = createBackgroundJob(project.id);

    reprocessMailboxMessages(project, payload)
      .then(async (run) => {
        await finalizeProjectRun(job, project, run);
      })
      .catch((error) => {
        job.status = "error";
        job.error = error.message;
      });

    return sendJson(res, 202, {
      jobId: job.id,
      message: "Переразбор запущен в фоновом режиме. Проверяйте статус через /api/projects/" + project.id + "/job/" + job.id
    });
  }

  const reanalyzeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/reanalyze$/);
  if (req.method === "POST" && reanalyzeMatch) {
    const project = await store.getProject(reanalyzeMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const payload = await parseRequestJson(req).catch(() => ({}));
    const BATCH_SIZE = Number(payload.batchSize) || 200;
    const messages = project.recentMessages || [];
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const startTime = Date.now();

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      for (const msg of batch) {
        if (!msg.analysis && !msg.body && !msg.bodyPreview) {
          skipped++;
          continue;
        }
        try {
          const body = msg.body || msg.bodyPreview || msg.analysis?.lead?.freeText || "";
          const newAnalysis = analyzeEmail(project, {
            messageKey: msg.messageKey || msg.id,
            fromEmail: msg.from || msg.analysis?.sender?.email || "",
            fromName: msg.analysis?.sender?.fullName || "",
            subject: msg.subject || "",
            body,
            attachments: (msg.attachmentFiles || msg.attachments || []).map((a) => typeof a === "string" ? a : a.filename || a.name || ""),
            attachmentFiles: (msg.attachmentFiles || []).map((a) => typeof a === "string" ? { filename: a } : a)
          });
          newAnalysis.analysisId = msg.analysis?.analysisId || newAnalysis.analysisId;
          msg.analysis = newAnalysis;
          msg.brand = (newAnalysis.detectedBrands || [])[0] || null;
          updated++;
        } catch {
          errors++;
        }
      }

      // Persist after each batch to avoid data loss on timeout
      await store.persist();
    }

    const durationMs = Date.now() - startTime;

    return sendJson(res, 200, {
      message: `Переанализировано ${updated} из ${messages.length} писем.`,
      updated,
      skipped,
      errors,
      total: messages.length,
      batchSize: BATCH_SIZE,
      durationMs
    });
  }

  const messagesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/messages$/);
  if (req.method === "GET" && messagesMatch) {
    const project = await store.getProject(messagesMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    return sendJson(res, 200, { messages: project.recentMessages || [] });
  }

  if (req.method === "DELETE" && messagesMatch) {
    const project = await store.getProject(messagesMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const result = await store.deleteAllMessages(project.id);
    return sendJson(res, 200, result);
  }

  const messagePatchMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/messages\/([^/]+)$/);
  if (req.method === "GET" && messagePatchMatch) {
    const project = await store.getProject(messagePatchMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const messageKey = decodeURIComponent(messagePatchMatch[2]);
    const message = (project.recentMessages || []).find((item) => item.messageKey === messageKey);
    if (!message) {
      return sendJson(res, 404, { error: "Message not found." });
    }

    return sendJson(res, 200, { message });
  }

  if (req.method === "PATCH" && messagePatchMatch) {
    const project = await store.getProject(messagePatchMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const payload = await parseRequestJson(req);
    if (!payload.pipelineStatus) {
      return sendJson(res, 400, { error: "Field 'pipelineStatus' is required." });
    }

    const msgKey = decodeURIComponent(messagePatchMatch[2]);
    const result = await store.updateMessageStatus(project.id, msgKey, payload.pipelineStatus);
    if (!result) {
      return sendJson(res, 404, { error: "Message not found." });
    }

    notifyStatusChange(project.id, msgKey, payload.pipelineStatus);
    return sendJson(res, 200, result);
  }

  // ── Feedback endpoint ──
  const messageFeedbackMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/messages\/([^/]+)\/feedback$/);
  if (req.method === "POST" && messageFeedbackMatch) {
    const project = await store.getProject(messageFeedbackMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }
    const messageKey = decodeURIComponent(messageFeedbackMatch[2]);
    const payload = await parseRequestJson(req);
    const result = await store.applyMessageFeedback(
      project.id,
      messageKey,
      payload
    );
    if (!result) {
      return sendJson(res, 404, { error: "Message not found." });
    }

    const updatedMessage = (project.recentMessages || []).find((item) => (item.messageKey || item.id) === messageKey);
    const analysis = result.analysis || updatedMessage?.analysis || {};
    const senderEmail = analysis.sender?.email || "";
    const senderDomain = getEmailDomain(senderEmail);
    const detectedBrands = Array.from(new Set([...(analysis.detectedBrands || []), ...(payload.addBrands || [])])).filter(Boolean);

    // Auto-learn: if brands were added, update brand_aliases in KB
    if (detectedBrands.length) {
      for (const brand of detectedBrands) {
        try {
          detectionKb.addBrandAlias({ canonicalBrand: brand, alias: brand.toLowerCase() });
        } catch { /* duplicate ok */ }
      }
    }

    if (senderEmail || senderDomain) {
      try {
        detectionKb.upsertSenderProfile({
          senderEmail,
          senderDomain,
          classification: normalizeClassificationForKb(payload.classification || analysis.classification?.label),
          companyHint: payload.companyName || analysis.sender?.companyName || "",
          brandHint: detectedBrands.join(", "),
          notes: `Auto-learn from feedback: ${project.id}/${messageKey}`
        });
      } catch {
        /* best effort */
      }
    }

    const feedbackNames = Array.isArray(payload.productNames) ? payload.productNames : [];
    for (const article of payload.addArticles || []) {
      const nameMatch = feedbackNames.find((item) => String(item.article || "").trim().toUpperCase() === String(article || "").trim().toUpperCase());
      try {
        detectionKb.learnNomenclatureFeedback({
          article,
          productName: nameMatch?.name || "",
          brand: detectedBrands[0] || "",
          sourceFile: `manual_feedback:${project.id}`
        });
      } catch {
        /* duplicate or invalid article: ignore */
      }
    }

    return sendJson(res, 200, result);
  }

  const messageDeleteMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/messages\/([^/]+)$/);
  if (req.method === "DELETE" && messageDeleteMatch) {
    const project = await store.getProject(messageDeleteMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const result = await store.deleteMessage(project.id, decodeURIComponent(messageDeleteMatch[2]));
    return sendJson(res, 200, result);
  }

  const scheduleMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/schedule$/);
  if (req.method === "POST" && scheduleMatch) {
    const project = await store.getProject(scheduleMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const payload = await parseRequestJson(req);
    const schedule = await store.updateSchedule(project.id, payload);
    return sendJson(res, 200, { schedule });
  }

  const analyzeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/analyze$/);
  if (req.method === "POST" && analyzeMatch) {
    const project = await store.getProject(analyzeMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    if (project.type !== "email-parser") {
      return sendJson(res, 400, { error: "Analyze action is available only for email-parser projects." });
    }

    const payload = await parseRequestJson(req);
    if (!payload.fromEmail || !payload.body) {
      return sendJson(res, 400, { error: "Fields 'fromEmail' and 'body' are required." });
    }

    const analysis = await analyzeEmailAsync(project, payload);
    await store.appendAnalysis(project.id, analysis);
    notifyNewMessages(project.id, 1, "analyze");
    return sendJson(res, 200, { analysis });
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (req.method === "GET" && projectMatch) {
    const project = await store.getProject(projectMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    return sendJson(res, 200, { project });
  }

  // ── CRM Sync ──
  const crmConfigMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/crm-config$/);
  if (req.method === "GET" && crmConfigMatch) {
    const project = await store.getProject(crmConfigMatch[1]);
    if (!project) return sendJson(res, 404, { error: "Project not found." });
    return sendJson(res, 200, { config: getCrmConfig(project) });
  }

  if (req.method === "PUT" && crmConfigMatch) {
    const project = await store.getProject(crmConfigMatch[1]);
    if (!project) return sendJson(res, 404, { error: "Project not found." });
    const payload = await parseRequestJson(req);
    project.crmConfig = {
      enabled: Boolean(payload.enabled),
      type: String(payload.type || "generic").toLowerCase(),
      baseUrl: String(payload.baseUrl || "").trim(),
      apiKey: String(payload.apiKey || "").trim(),
      pipelineId: payload.pipelineId ? Number(payload.pipelineId) : null,
      statusId: payload.statusId ? Number(payload.statusId) : null,
      responsibleUserId: payload.responsibleUserId || null,
      responsibleId: payload.responsibleId || null,
      sourceId: payload.sourceId || "EMAIL"
    };
    await store.persist();
    return sendJson(res, 200, { config: project.crmConfig });
  }

  const crmSyncMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/crm-sync$/);
  if (req.method === "POST" && crmSyncMatch) {
    const project = await store.getProject(crmSyncMatch[1]);
    if (!project) return sendJson(res, 404, { error: "Project not found." });
    const payload = await parseRequestJson(req);
    const { normalizeIntegrationMessage } = await import("./services/integration-api.js");
    const result = await syncProjectToCrm(project, store, (proj, msg, opts) =>
      normalizeIntegrationMessage(proj, msg, opts), {
      limit: payload.limit || 50,
      dryRun: payload.dryRun || false
    });
    if (result.synced > 0) notifyNewMessages(project.id, result.synced, "crm-sync");
    return sendJson(res, 200, result);
  }

  // ── CRM Webhook callback (external CRM pushes status back) ──
  const crmCallbackMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/crm-callback$/);
  if (req.method === "POST" && crmCallbackMatch) {
    const project = await store.getProject(crmCallbackMatch[1]);
    if (!project) return sendJson(res, 404, { error: "Project not found." });
    const payload = await parseRequestJson(req);
    const messageKey = payload.messageKey || payload.message_key;
    const externalStatus = payload.status || payload.externalStatus;
    if (!messageKey) return sendJson(res, 400, { error: "Field 'messageKey' is required." });

    // Map CRM status to pipeline status
    const statusMap = {
      won: "ready_for_crm",
      lost: "review",
      processed: "ready_for_crm",
      rejected: "review",
      clarification: "needs_clarification"
    };
    const newStatus = statusMap[externalStatus] || null;

    const result = { messageKey, externalStatus, synced: false };
    if (newStatus) {
      await store.updateMessageStatus(project.id, messageKey, newStatus);
      notifyStatusChange(project.id, messageKey, newStatus);
      result.synced = true;
      result.pipelineStatus = newStatus;
    }

    if (payload.externalId) {
      const config = getCrmConfig(project);
      await store.acknowledgeMessageExport(project.id, messageKey, {
        consumer: `crm-${config.type || "generic"}`,
        externalId: payload.externalId,
        note: `CRM callback: ${externalStatus}`
      });
    }

    return sendJson(res, 200, result);
  }

  // ── Swagger UI ──
  if (req.method === "GET" && (url.pathname === "/docs" || url.pathname === "/docs/")) {
    const baseUrl = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buildSwaggerUiPage(baseUrl));
    return;
  }

  return sendJson(res, 404, { error: "Not found." });
}

async function handleIntegrationApi(req, res, url) {
  if (req.method === "GET" && (url.pathname === "/api/integration/openapi.json" || url.pathname === "/api/integration/openapi.v1.json")) {
    return sendJson(res, 200, buildLegacyIntegrationOpenApi({
      baseUrl: `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`
    }));
  }

  if (req.method === "GET" && (url.pathname === "/api/integration/changelog" || url.pathname === "/api/integration/changelog.v1.json")) {
    const baseUrl = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
    return sendJson(res, 200, buildLegacyIntegrationChangelogDocument(baseUrl));
  }

  const activeClients = getIntegrationClients();
  if (activeClients.length === 0) {
    return sendJson(res, 503, { error: "Integration API is not configured. Create a client via API Docs page." });
  }

  const currentClient = resolveIntegrationClient(req.headers, activeClients);
  if (!currentClient) {
    return sendJson(res, 401, { error: "Unauthorized. Provide x-api-key or Bearer token." });
  }

  // Rate limiting
  const rateResult = checkRateLimit(currentClient.id);
  res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX);
  res.setHeader("X-RateLimit-Remaining", rateResult.remaining);
  if (!rateResult.allowed) {
    res.setHeader("Retry-After", rateResult.retryAfter);
    return sendJson(res, 429, {
      error: "Rate limit exceeded. Try again later.",
      retryAfter: rateResult.retryAfter,
      limit: RATE_LIMIT_MAX,
      windowSeconds: RATE_LIMIT_WINDOW_MS / 1000
    });
  }

  if (req.method === "GET" && url.pathname === "/api/integration/health") {
    return sendJson(res, 200, {
      ok: true,
      authConfigured: true,
      client: {
        id: currentClient.id,
        name: currentClient.name,
        project_ids: currentClient.projectIds
      },
      contract: {
        version: getLegacyIntegrationApiVersion(),
        changelog_url: "/api/integration/changelog",
        openapi_url: "/api/integration/openapi.v1.json"
      },
      background: {
        role: backgroundRole,
        schedulerEnabled: shouldRunScheduler(backgroundRole),
        webhooksEnabled: shouldRunWebhooks(backgroundRole)
      }
    });
  }

  if (req.method === "GET" && url.pathname === "/api/integration/projects") {
    const projects = await store.listProjects();
    return sendJson(res, 200, {
      data: projects.filter((project) => canClientAccessProject(currentClient, project.id)).map((project) => ({
        id: project.id,
        name: project.name,
        type: project.type,
        mailbox: project.mailbox,
        recent_messages_count: (project.recentMessages || []).length
      }))
    });
  }

  const integrationMessagesMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/messages$/);
  if (req.method === "GET" && integrationMessagesMatch) {
    const projectId = decodeURIComponent(integrationMessagesMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const since = String(url.searchParams.get("since") || "").trim();
    const cursor = String(url.searchParams.get("cursor") || "").trim();
    if (since && Number.isNaN(Date.parse(since))) {
      return sendJson(res, 400, { error: "Query parameter 'since' must be a valid ISO datetime." });
    }
    if (cursor && !parseIntegrationCursor(cursor)) {
      return sendJson(res, 400, { error: "Query parameter 'cursor' must be a valid integration cursor." });
    }

    return sendJson(res, 200, listIntegrationMessages(project, {
      page: url.searchParams.get("page"),
      limit: url.searchParams.get("limit"),
      status: url.searchParams.get("status"),
      since,
      exported: url.searchParams.get("exported"),
      cursor
    }, {
      consumerId: currentClient.id
    }));
  }

  // ── Bulk acknowledge ──
  const integrationBulkAckMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/messages\/ack$/);
  if (req.method === "POST" && integrationBulkAckMatch) {
    const projectId = decodeURIComponent(integrationBulkAckMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const payload = await parseRequestJson(req);
    if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
      return sendJson(res, 400, { error: "Field 'messages' must be a non-empty array." });
    }
    if (payload.messages.length > 200) {
      return sendJson(res, 400, { error: "Maximum 200 messages per batch." });
    }
    const results = await store.bulkAcknowledgeExport(projectId, payload.messages, {
      consumer: currentClient.id
    });
    if (!results) {
      return sendJson(res, 404, { error: "Project not found." });
    }
    const acknowledged = results.filter((r) => r.acknowledged && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.acknowledged).length;
    return sendJson(res, 200, { data: results, summary: { acknowledged, skipped, failed, total: results.length } });
  }

  const integrationAckMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/messages\/([^/]+)\/ack$/);
  if (req.method === "POST" && integrationAckMatch) {
    const projectId = decodeURIComponent(integrationAckMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const messageKey = decodeURIComponent(integrationAckMatch[2]);
    const payload = await parseRequestJson(req);
    const idempotencyKey = resolveIdempotencyKey(req.headers, payload);
    const message = await store.acknowledgeMessageExport(projectId, messageKey, {
      ...payload,
      consumer: currentClient.id,
      idempotencyKey
    });
    if (!message) {
      return sendJson(res, 404, { error: "Message not found." });
    }

    const project = await store.getProject(projectId);
    return sendJson(res, 200, { data: findIntegrationMessage(project, messageKey, { consumerId: currentClient.id }) });
  }

  const integrationDeliveriesMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/deliveries$/);
  if (req.method === "GET" && integrationDeliveriesMatch) {
    const projectId = decodeURIComponent(integrationDeliveriesMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    return sendJson(res, 200, listIntegrationDeliveries(project, {
      status: url.searchParams.get("status"),
      limit: url.searchParams.get("limit")
    }, {
      clientId: currentClient.id
    }));
  }

  const integrationDeliveryStatsMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/deliveries\/stats$/);
  if (req.method === "GET" && integrationDeliveryStatsMatch) {
    const projectId = decodeURIComponent(integrationDeliveryStatsMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    return sendJson(res, 200, summarizeIntegrationDeliveries(project, {
      status: url.searchParams.get("status"),
      failure_limit: url.searchParams.get("failure_limit")
    }, {
      clientId: currentClient.id
    }));
  }

  const integrationRequeueMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/deliveries\/([^/]+)\/requeue$/);
  if (req.method === "POST" && integrationRequeueMatch) {
    const projectId = decodeURIComponent(integrationRequeueMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const deliveryId = decodeURIComponent(integrationRequeueMatch[2]);
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }
    const existingDelivery = findIntegrationDelivery(project, deliveryId);
    if (!existingDelivery) {
      return sendJson(res, 404, { error: "Delivery not found." });
    }
    if (existingDelivery.client_id && existingDelivery.client_id !== currentClient.id) {
      return sendJson(res, 403, { error: "Client is not allowed to manage this delivery." });
    }
    const payload = await parseRequestJson(req);
    const idempotencyKey = resolveIdempotencyKey(req.headers, payload);
    await store.requeueWebhookDelivery(projectId, deliveryId, {
      ...payload,
      idempotencyKey
    });
    return sendJson(res, 200, { data: findIntegrationDelivery(project, deliveryId, { clientId: currentClient.id }) });
  }

  const integrationMessageMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/messages\/([^/]+)$/);
  if (req.method === "GET" && integrationMessageMatch) {
    const projectId = decodeURIComponent(integrationMessageMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const message = findIntegrationMessage(project, decodeURIComponent(integrationMessageMatch[2]), { consumerId: currentClient.id });
    if (!message) {
      return sendJson(res, 404, { error: "Message not found." });
    }

    return sendJson(res, 200, { data: message });
  }

  return sendJson(res, 404, { error: "Not found." });
}

async function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.join(publicDir, safePath);

  try {
    const contents = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(contents);
  } catch {
    const fallback = await readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fallback);
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (filePath.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }

  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  return "text/html; charset=utf-8";
}

function buildSwaggerUiPage(baseUrl) {
  const specUrl = `${baseUrl}/api/integration/openapi.json`;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pochta API — Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none !important; }
    .swagger-ui .info { margin: 20px 0; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: ${JSON.stringify(specUrl)},
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout"
    });
  </script>
</body>
</html>`;
}
