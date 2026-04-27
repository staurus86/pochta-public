import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectsStore } from "./storage/projects-store.js";
import { analyzeEmail, analyzeEmailAsync, applyPostProcessing } from "./services/email-analyzer.js";
import { isAiEnabled, getAiConfig } from "./services/ai-classifier.js";
import { getLlmExtractConfig, isLlmExtractEnabled } from "./services/llm-extractor.js";
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
import { parseMailboxConfigText } from "./services/mailbox-config-parser.js";
import { detectionKb } from "./services/detection-kb.js";
import { ManagerAuth } from "./services/manager-auth.js";
import {
  exportIntegrationEvents,
  exportIntegrationMessages,
  findIntegrationDelivery,
  findIntegrationMessage,
  findIntegrationThread,
  listIntegrationEvents,
  listIntegrationDeliveries,
  listIntegrationMessages,
  listIntegrationPresets,
  listIntegrationThreads,
  parseIntegrationCursor,
  summarizeIntegrationCoverage,
  summarizeIntegrationDeliveries,
  summarizeIntegrationMessages,
  summarizeIntegrationProblems
} from "./services/integration-api.js";
import { LegacyWebhookDispatcher } from "./services/webhook-dispatcher.js";
import { createSiderusCrmSender, buildSiderusCrmPayload } from "./services/siderus-crm-sender.js";
import { readLlmCache } from "./services/llm-cache.js";
import { mergeLlmExtraction } from "./services/llm-extractor.js";

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
const IDLE_SHUTDOWN_MS = Number(process.env.IDLE_SHUTDOWN_MINUTES || 0) * 60_000;
let lastRequestAt = Date.now();
const envClients = loadIntegrationClients(process.env);
const BACKGROUND_JOB_TTL_MS = Number(process.env.LEGACY_BACKGROUND_JOB_TTL_MS || 60 * 60 * 1000);

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

function normalizeProcessingBatchSize(value, fallback = 100) {
  const numeric = Number(value || fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(10, Math.min(500, Math.round(numeric)));
}

function createProcessingTelemetry() {
  return {
    batches: 0,
    yields: 0,
    processed: 0,
    totalAnalysisMs: 0,
    maxAnalysisMs: 0
  };
}

function recordProcessingTelemetrySample(telemetry, durationMs) {
  telemetry.processed += 1;
  telemetry.totalAnalysisMs += Number(durationMs || 0);
  telemetry.maxAnalysisMs = Math.max(telemetry.maxAnalysisMs, Number(durationMs || 0));
}

function finalizeProcessingTelemetry(telemetry, durationMs) {
  const processed = telemetry.processed || 0;
  return {
    batches: telemetry.batches,
    yields: telemetry.yields,
    processed,
    avgAnalysisMs: processed ? Number((telemetry.totalAnalysisMs / processed).toFixed(2)) : 0,
    maxAnalysisMs: telemetry.maxAnalysisMs,
    totalAnalysisMs: telemetry.totalAnalysisMs,
    messagesPerSecond: durationMs > 0 ? Number((processed / (durationMs / 1000)).toFixed(2)) : 0
  };
}

function yieldProcessingLoop() {
  return new Promise((resolve) => setImmediate(resolve));
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
const siderusCrmSender = createSiderusCrmSender(process.env);
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
setInterval(cleanupBackgroundJobs, 10 * 60 * 1000).unref();

// Idle shutdown: exit(0) after IDLE_SHUTDOWN_MINUTES of no user traffic.
// Railway restartPolicyType=ON_FAILURE will NOT restart on exit(0).
if (IDLE_SHUTDOWN_MS > 0) {
  setInterval(() => {
    if (!isShuttingDown && Date.now() - lastRequestAt > IDLE_SHUTDOWN_MS) {
      console.log(`[idle-shutdown] No requests for ${process.env.IDLE_SHUTDOWN_MINUTES} min, exiting.`);
      process.exit(0);
    }
  }, 60_000).unref();
}

// LLM backlog scheduler: every 2 hours, auto-process old messages without llmExtraction
// Runs only when LLM is enabled and there's no active llm-reanalyze job
const LLM_BACKLOG_INTERVAL_MS = 2 * 60 * 60 * 1000;
const LLM_BACKLOG_BATCH = 30; // max messages per project per run
const LLM_BACKLOG_DELAY_MS = 3500;
setInterval(() => {
  if (!isLlmExtractEnabled()) return;
  store.listProjects().then(async (projects) => {
    for (const project of projects) {
      if (findRunningProjectJob(project.id, ["llm-reanalyze"])) continue;
      const queue = (project.recentMessages || []).filter((msg) => {
        if (!msg.analysis) return false;
        if (msg.pipelineStatus === "ignored_spam" || msg.pipelineStatus === "ignored_duplicate") return false;
        if (msg.analysis.classification?.label === "СПАМ") return false;
        return !msg.analysis.llmExtraction?.processedAt;
      }).slice(0, LLM_BACKLOG_BATCH);
      if (queue.length === 0) continue;
      console.log(`LLM backlog: processing ${queue.length} old messages for project ${project.id}`);
      const { analyzeEmailAsync: _analyzeAsync } = await import("./services/email-analyzer.js");
      let count = 0;
      for (const msg of queue) {
        const body = msg.body || msg.bodyPreview || msg.analysis?.lead?.freeText || "";
        try {
          const newAnalysis = await _analyzeAsync(project, {
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
          const wasManuallyChanged = (msg.auditLog || []).some((e) => e.action === "status_change");
          if (!wasManuallyChanged) {
            msg.pipelineStatus = computePipelineStatus(newAnalysis);
          }
          count++;
        } catch (err) {
          console.warn("LLM backlog error:", err.message);
        }
        await new Promise((r) => setTimeout(r, LLM_BACKLOG_DELAY_MS));
      }
      if (count > 0) {
        await store.persist();
        console.log(`LLM backlog: processed ${count}/${queue.length} for project ${project.id}`);
      }
    }
  }).catch((err) => console.warn("LLM backlog scheduler error:", err.message));
}, LLM_BACKLOG_INTERVAL_MS).unref();

/**
 * Compute pipeline status from analysis result.
 * Accounts for LLM downgrade (LLM said "other" for a Клиент — send to review).
 */
function computePipelineStatus(analysis) {
    const label = analysis.classification?.label;
    const requiresReview = analysis.intakeFlow?.requiresReview || analysis.classification?.llmDowngraded;
    if (label === "СПАМ") return "ignored_spam";
    if (label === "Клиент") {
        if (requiresReview) return "review";
        // J4: quality gate blocks ready_for_crm if data is incomplete/dirty
        const gate = analysis.qualityGate;
        if (gate && gate.ok === false) return "review";
        return "ready_for_crm";
    }
    if (analysis.crm?.needsClarification) return "needs_clarification";
    return "review";
}

let isReady = false;
let isShuttingDown = false;
let shutdownTimer = null;

// P3: Detection KB cache — invalidated on any mutation
let kbCache = null;
let kbCacheVersion = 0;

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
      const statusCode = isReady && !isShuttingDown ? 200 : 503;
      sendJson(res, statusCode, {
        ok: isReady && !isShuttingDown,
        ready: isReady,
        shuttingDown: isShuttingDown
      });
      return;
    }

    lastRequestAt = Date.now();

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
    // S2: Only expose error details in development to avoid leaking internals
    const body = { error: message };
    if (process.env.NODE_ENV !== "production" && statusCode >= 500) body.details = error.message;
    res.end(JSON.stringify(body));
  }
});

// Improvement 8: auto-import brand catalog on startup if aliases are below threshold
async function ensureBrandCatalogLoaded() {
  try {
    const stats = detectionKb.getStats();
    const aliasCount = stats.brandAliasCount || 0;
    if (aliasCount < 5000) {
      console.log(`[startup] Brand aliases: ${aliasCount} < 5000, importing catalog...`);
      const { readFileSync } = await import("node:fs");
      const catalogPath = new URL("../data/brand-catalog.json", import.meta.url);
      const catalog = JSON.parse(readFileSync(catalogPath));
      const result = detectionKb.importBrandCatalog(catalog.brands || catalog);
      console.log(`[startup] Brand catalog imported: +${result.added} aliases (total: ${result.total})`);
    }
  } catch (e) {
    console.error(`[startup] Failed to import brand catalog:`, e.message);
  }
}

server.listen(port, host, () => {
  isReady = true;
  console.log(`Server listening on http://${host}:${port}`);
  console.log(`Legacy background role: ${backgroundRole}`);

  if (shouldRunScheduler(backgroundRole)) {
    scheduler.start();
  }

  if (shouldRunWebhooks(backgroundRole)) {
    webhookDispatcher.start();
  }

  ensureBrandCatalogLoaded();
});

server.keepAliveTimeout = Number(process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS || 60_000);
server.headersTimeout = Number(process.env.SERVER_HEADERS_TIMEOUT_MS || 65_000);
server.requestTimeout = Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 120_000);

function shutdown(signal, error = null) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  isReady = false;

  if (error) {
    console.error(`${signal} triggered by fatal error:`, error);
  } else {
    console.log(`${signal} received, shutting down gracefully...`);
  }

  scheduler.stop();
  webhookDispatcher.stop();

  server.close(() => {
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
    process.exit(error ? 1 : 0);
  });

  if (typeof server.closeIdleConnections === "function") {
    server.closeIdleConnections();
  }

  shutdownTimer = setTimeout(() => {
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    process.exit(error ? 1 : 0);
  }, Number(process.env.SHUTDOWN_FORCE_TIMEOUT_MS || 10000));
  shutdownTimer.unref?.();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (error) => shutdown("uncaughtException", error));
process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  shutdown("unhandledRejection", error);
});

async function parseRequestJson(req) {
  return parseJsonBody(req, { maxBytes: jsonBodyLimitBytes });
}

function createBackgroundJob(projectId) {
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id: jobId,
    projectId,
    kind: "generic",
    status: "running",
    run: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null
  };
  backgroundJobs.set(jobId, job);
  return job;
}

function createTypedBackgroundJob(projectId, kind) {
  const job = createBackgroundJob(projectId);
  job.kind = kind;
  return job;
}

function finishBackgroundJob(job, { status, run = null, error = null } = {}) {
  job.status = status || "done";
  job.run = run;
  job.error = error || null;
  job.finishedAt = new Date().toISOString();
}

function findRunningProjectJob(projectId, kinds = []) {
  for (const job of backgroundJobs.values()) {
    if (job.projectId !== projectId) continue;
    if (job.status !== "running") continue;
    if (kinds.length > 0 && !kinds.includes(job.kind)) continue;
    return job;
  }
  return null;
}

function cleanupBackgroundJobs() {
  const cutoff = Date.now() - BACKGROUND_JOB_TTL_MS;
  for (const [id, job] of backgroundJobs.entries()) {
    const finishedAt = job.finishedAt ? Date.parse(job.finishedAt) : null;
    if (job.status !== "running" && finishedAt && finishedAt < cutoff) {
      backgroundJobs.delete(id);
    }
  }
}

async function finalizeProjectRun(job, project, run) {
  await store.appendRun(project.id, run);
  if (Array.isArray(run.recentMessages)) {
    await store.replaceRecentMessages(project.id, run.recentMessages);
  }
  if (Array.isArray(run.newMessages) && run.newMessages.length > 0) {
    await webhookDispatcher.enqueueProjectMessages(project.id, run.newMessages);
    siderusCrmSender?.sendNewMessages(project, run.newMessages).catch((err) =>
      console.warn("[siderus-crm] batch send error:", err.message)
    );
  }
  finishBackgroundJob(job, { status: "done", run });
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

  // Auto LLM extraction on new non-spam messages
  if (isLlmExtractEnabled() && Array.isArray(run.newMessages) && run.newMessages.length > 0) {
    const LLM_AUTO_DELAY_MS = 3500;
    const queue = run.newMessages.filter((m) =>
      m.pipelineStatus !== "ignored_spam" &&
      m.pipelineStatus !== "ignored_duplicate" &&
      !m.analysis?.llmExtraction?.processedAt
    );
    if (queue.length > 0) {
      console.log(`Auto-LLM: queued ${queue.length} new messages for project ${project.id}`);
      (async () => {
        let count = 0;
        for (const msg of queue) {
          const body = msg.body || msg.bodyPreview || msg.analysis?.lead?.freeText || "";
          try {
            const newAnalysis = await analyzeEmailAsync(project, {
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
            // Update pipelineStatus unless manually overridden
            const wasManuallyChanged = (msg.auditLog || []).some((e) => e.action === "status_change");
            if (!wasManuallyChanged) {
              msg.pipelineStatus = computePipelineStatus(newAnalysis);
            }
            count++;
          } catch (err) {
            console.warn("Auto-LLM error:", err.message);
          }
          if (count % 10 === 0) await store.persist();
          await new Promise((r) => setTimeout(r, LLM_AUTO_DELAY_MS));
        }
        if (count > 0) {
          await store.persist();
          console.log(`Auto-LLM: processed ${count}/${queue.length} messages for project ${project.id}`);
        }
      })().catch((err) => console.warn("Auto-LLM background error:", err.message));
    }
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
    // C2: Restrict CORS — only allow same host or explicitly configured origin
    const reqOrigin = req.headers.origin;
    const configuredOrigin = process.env.ALLOWED_ORIGIN;
    const corsOrigin = (() => {
      if (configuredOrigin) return reqOrigin === configuredOrigin ? configuredOrigin : null;
      if (!reqOrigin) return null; // same-origin request, no CORS header needed
      try { if (new URL(reqOrigin).host === req.headers.host) return reqOrigin; } catch {}
      return null;
    })();
    const sseHeaders = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    };
    if (corsOrigin) sseHeaders["Access-Control-Allow-Origin"] = corsOrigin;
    res.writeHead(200, sseHeaders);
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

  // ── Auth endpoints (public — no token required) ──
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const payload = await parseRequestJson(req);
    if (!payload.login || !payload.password) {
      return sendJson(res, 400, { error: "Fields 'login' and 'password' are required." });
    }
    const result = managerAuth.authenticate(payload.login, payload.password);
    if (!result) return sendJson(res, 401, { error: "Invalid credentials." });
    return sendJson(res, 200, result);
  }

  // Attachment download — must be before the auth gate because browsers
  // cannot send Bearer headers when opening files in new tabs.
  const attachMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)\/(.+)$/);
  if (req.method === "GET" && attachMatch) {
    // auth: Bearer header OR ?token= query param
    const attachUser = extractAuthUser(req) || (() => {
      const qt = url.searchParams.get("token");
      return qt ? managerAuth.verifyToken(qt) : null;
    })();
    if (!attachUser) return sendJson(res, 401, { error: "Authentication required" });
    const messageKey = decodeURIComponent(attachMatch[1]);
    const filename = decodeURIComponent(attachMatch[2]);
    const safeName = filename.replace(/[<>:"/\\|?*]/g, "_");
    const filePath = path.join(dataDir, "attachments", messageKey, safeName);
    // C1: Prevent path traversal — verify resolved path stays inside attachments dir
    const attachBase = path.resolve(path.join(dataDir, "attachments"));
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(attachBase + path.sep) && resolvedPath !== attachBase) {
      return sendJson(res, 403, { error: "Access denied." });
    }
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

  // ── Global auth gate — all /api/* routes below require a valid token ──
  requireAuth(req);

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = extractAuthUser(req);
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
    const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
    const offset = Number(url.searchParams.get("offset")) || 0;
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

    const total = allMessages.length;
    return sendJson(res, 200, {
      messages: allMessages.slice(offset, offset + limit),
      total,
      offset,
      limit,
      user: user.fullName
    });
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
      ok: !isShuttingDown,
      ready: isReady,
      shuttingDown: isShuttingDown,
      background: {
        role: backgroundRole,
        schedulerEnabled: shouldRunScheduler(backgroundRole),
        webhooksEnabled: shouldRunWebhooks(backgroundRole),
        runningJobs: [...backgroundJobs.values()].filter((job) => job.status === "running").length,
        failedJobs: [...backgroundJobs.values()].filter((job) => job.status === "error").length,
        retainedJobs: backgroundJobs.size
      },
      ai: getAiConfig(),
      llm: getLlmExtractConfig(),
      sse: { clients: sseClients.size },
      rateLimit: { max: RATE_LIMIT_MAX, windowSeconds: RATE_LIMIT_WINDOW_MS / 1000 }
    });
  }

  // --- LLM suggestions log --------------------------------------------------
  if (req.method === "GET" && url.pathname === "/api/llm-suggestions") {
    const { readFileSync: rfsSync, existsSync } = await import("node:fs");
    const suggestionsPath = path.join(dataDir, "llm-suggestions.jsonl");
    if (!existsSync(suggestionsPath)) {
      return sendJson(res, 200, { entries: [], total: 0 });
    }
    const lines = rfsSync(suggestionsPath, "utf8").trim().split("\n").filter(Boolean);
    const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
    const offset = Number(url.searchParams.get("offset") || 0);
    const entries = lines
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .reverse(); // newest first
    return sendJson(res, 200, {
      total: entries.length,
      entries: entries.slice(offset, offset + limit)
    });
  }

  if (req.method === "DELETE" && url.pathname === "/api/llm-suggestions") {
    const { writeFileSync, existsSync } = await import("node:fs");
    const suggestionsPath = path.join(dataDir, "llm-suggestions.jsonl");
    if (existsSync(suggestionsPath)) writeFileSync(suggestionsPath, "", "utf8");
    return sendJson(res, 200, { ok: true, cleared: true });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/background-jobs/cleanup") {
    const before = backgroundJobs.size;
    cleanupBackgroundJobs();
    return sendJson(res, 200, { ok: true, before, after: backgroundJobs.size, removed: before - backgroundJobs.size });
  }

  if (req.method === "GET" && url.pathname === "/api/detection-kb") {
    // P3: Serve from cache if unchanged since last mutation
    if (kbCache && kbCache.version === kbCacheVersion) {
      return sendJson(res, 200, kbCache.data);
    }
    const senderProfiles = detectionKb.getSenderProfiles();
    const data = {
      stats: detectionKb.getStats(),
      nomenclatureStats: detectionKb.getNomenclatureStats(),
      rules: detectionKb.getRules(),
      brandAliases: detectionKb.getBrandAliases(),
      senderProfiles,
      autoLearnedSenderProfiles: senderProfiles.filter((item) => String(item.notes || "").includes("Auto-learn from feedback")),
      learnedNomenclature: detectionKb.getLearnedNomenclature(150),
      ownBrands: detectionKb.getOwnBrands(),
      corpus: detectionKb.getCorpus(25)
    };
    kbCache = { version: kbCacheVersion, data };
    return sendJson(res, 200, data);
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/rules") {
    const payload = await parseRequestJson(req);
    if (!payload.scope || !payload.classifier || !payload.matchType || !payload.pattern) {
      return sendJson(res, 400, { error: "Fields 'scope', 'classifier', 'matchType' and 'pattern' are required." });
    }
    // C3: Validate regex before inserting into DB
    if (payload.matchType === "regex") {
      try { new RegExp(payload.pattern, "iu"); } catch (e) {
        return sendJson(res, 400, { error: `Invalid regex pattern: ${e.message}` });
      }
    }
    const rule = detectionKb.addRule(payload);
    kbCacheVersion++;
    return sendJson(res, 201, { rule });
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/brand-aliases") {
    const payload = await parseRequestJson(req);
    if (!payload.canonicalBrand || !payload.alias) {
      return sendJson(res, 400, { error: "Fields 'canonicalBrand' and 'alias' are required." });
    }

    const brandAlias = detectionKb.addBrandAlias(payload);
    kbCacheVersion++;
    return sendJson(res, 201, { brandAlias });
  }

  const deleteRuleMatch = url.pathname.match(/^\/api\/detection-kb\/rules\/(\d+)$/);
  if (req.method === "DELETE" && deleteRuleMatch) {
    const result = detectionKb.deactivateRule(deleteRuleMatch[1]);
    kbCacheVersion++;
    return sendJson(res, 200, result);
  }

  const deleteSenderMatch = url.pathname.match(/^\/api\/detection-kb\/sender-profiles\/(\d+)$/);
  if (req.method === "DELETE" && deleteSenderMatch) {
    const result = detectionKb.deactivateSenderProfile(deleteSenderMatch[1]);
    kbCacheVersion++;
    return sendJson(res, 200, result);
  }

  const deleteBrandMatch = url.pathname.match(/^\/api\/detection-kb\/brand-aliases\/(\d+)$/);
  if (req.method === "DELETE" && deleteBrandMatch) {
    const result = detectionKb.deactivateBrandAlias(deleteBrandMatch[1]);
    kbCacheVersion++;
    return sendJson(res, 200, result);
  }

  const deleteNomenclatureMatch = url.pathname.match(/^\/api\/detection-kb\/nomenclature\/(\d+)$/);
  if (req.method === "DELETE" && deleteNomenclatureMatch) {
    const result = detectionKb.deleteNomenclatureEntry(deleteNomenclatureMatch[1]);
    kbCacheVersion++;
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/sender-profiles") {
    const payload = await parseRequestJson(req);
    if (!payload.classification) {
      return sendJson(res, 400, { error: "Field 'classification' is required." });
    }

    const senderProfile = detectionKb.addSenderProfile(payload);
    kbCacheVersion++;
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
    kbCacheVersion++;
    return sendJson(res, 201, { ownBrand });
  }

  const deleteOwnBrandMatch = url.pathname.match(/^\/api\/detection-kb\/own-brands\/(\d+)$/);
  if (req.method === "DELETE" && deleteOwnBrandMatch) {
    const result = detectionKb.deactivateOwnBrand(deleteOwnBrandMatch[1]);
    kbCacheVersion++;
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/brand-catalog/import") {
    const payload = await parseRequestJson(req);
    if (!Array.isArray(payload.brands)) {
      return sendJson(res, 400, { error: "Field 'brands' must be an array of { canonical, aliases[] }." });
    }

    const result = detectionKb.importBrandCatalog(payload.brands);
    kbCacheVersion++;
    return sendJson(res, 200, result);
  }

  if (req.method === "DELETE" && url.pathname === "/api/detection-kb/brand-catalog") {
    const result = detectionKb.clearBrandAliases();
    kbCacheVersion++;
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

  const mailboxesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/mailboxes$/);
  if (req.method === "GET" && mailboxesMatch) {
    const project = await store.getProject(mailboxesMatch[1]);
    if (!project) return sendJson(res, 404, { error: "Project not found." });
    if (project.type !== "mailbox-file-parser") return sendJson(res, 400, { error: "Mailboxes available only for mailbox-file-parser projects." });
    const sourceFile = path.resolve(rootDir, project.runtime?.sourceFile || "1.txt");
    let mailboxes = [];
    try {
      const contents = await readFile(sourceFile, "utf-8");
      mailboxes = parseMailboxConfigText(contents).map((a) => ({
        mailbox: a.mailbox,
        brand: a.brand || "",
        siteUrl: a.siteUrl || ""
      }));
    } catch { /* file missing or parse error */ }
    return sendJson(res, 200, { mailboxes, total: mailboxes.length });
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

    return sendJson(res, 200, { job: { id: job.id, status: job.status, run: job.run || null, error: job.error || null, startedAt: job.startedAt, progress: job.progress || null } });
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
    const activeJob = findRunningProjectJob(project.id, ["run", "reprocess"]);
    if (activeJob) {
      return sendJson(res, 409, {
        error: "A background job is already running for this project.",
        jobId: activeJob.id,
        status: activeJob.status,
        kind: activeJob.kind
      });
    }

    if (["mailbox-file-parser", "tender-importer"].includes(project.type)) {
      const job = createTypedBackgroundJob(project.id, "run");
      const runner = project.type === "mailbox-file-parser"
        ? () => runMailboxFileParser(project, rootDir, payload)
        : () => runTenderImporter(project, rootDir, payload);

      runner()
        .then(async (run) => {
          await finalizeProjectRun(job, project, run);
        })
        .catch((error) => {
          finishBackgroundJob(job, {
            status: "error",
            error: error.code === "EPERM"
              ? "Process spawning is blocked in the current sandbox. Run locally or on Railway."
              : error.message
          });
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
    const activeJob = findRunningProjectJob(project.id, ["run", "reprocess"]);
    if (activeJob) {
      return sendJson(res, 409, {
        error: "A background job is already running for this project.",
        jobId: activeJob.id,
        status: activeJob.status,
        kind: activeJob.kind
      });
    }
    const job = createTypedBackgroundJob(project.id, "reprocess");

    reprocessMailboxMessages(project, payload)
      .then(async (run) => {
        await finalizeProjectRun(job, project, run);
      })
      .catch((error) => {
        finishBackgroundJob(job, { status: "error", error: error.message });
      });

    return sendJson(res, 202, {
      jobId: job.id,
      message: "Переразбор запущен в фоновом режиме. Проверяйте статус через /api/projects/" + project.id + "/job/" + job.id
    });
  }

  const reanalyzeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/reanalyze$/);
  if (req.method === "POST" && reanalyzeMatch) {
    const project = await store.getProject(reanalyzeMatch[1]);
    if (!project) return sendJson(res, 404, { error: "Project not found." });

    const activeJob = findRunningProjectJob(project.id, ["reanalyze"]);
    if (activeJob) return sendJson(res, 409, { error: "Reanalysis already running.", jobId: activeJob.id });

    const payload = await parseRequestJson(req).catch(() => ({}));
    const BATCH_SIZE = normalizeProcessingBatchSize(payload.batchSize, 100);
    const messages = project.recentMessages || [];

    const job = createTypedBackgroundJob(project.id, "reanalyze");
    job.progress = { total: messages.length, processed: 0, skipped: 0, errors: 0, currentSubject: null };

    (async () => {
      const startTime = Date.now();
      const telemetry = createProcessingTelemetry();

      for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        if (job.status !== "running") break;
        const batch = messages.slice(i, i + BATCH_SIZE);
        for (let j = 0; j < batch.length; j++) {
          if (job.status !== "running") break;
          const msg = batch[j];
          job.progress.currentSubject = msg.subject || "(без темы)";
          if (!msg.analysis && !msg.body && !msg.bodyPreview) { job.progress.skipped++; continue; }
          // Never reanalyze confirmed spam/duplicates
          if (msg.pipelineStatus === "ignored_spam" || msg.pipelineStatus === "ignored_duplicate") { job.progress.skipped++; continue; }
          try {
            const sampleStartedAt = Date.now();
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
            // Preserve LLM data — reanalysis uses sync analyzeEmail (rules only).
            // Durable cache has the full LLM payload (contact, requestType, etc.);
            // in-memory llmExtraction stores only metadata. Prefer cache as source of truth.
            const cachedLlm = readLlmCache(msg.messageKey || msg.id);
            if (cachedLlm && cachedLlm.contact) {
              // Re-merge LLM sender fields (gap-only) so rules' empty company/fio/phone
              // get filled from LLM-extracted values. Skip articles/brands — fresh rules own those.
              mergeLlmExtraction(newAnalysis, {
                sender_name: cachedLlm.contact.name || null,
                company_name: cachedLlm.contact.company || null,
                sender_phone: cachedLlm.contact.phone || null,
                inn: cachedLlm.contact.inn || null,
                request_type: cachedLlm.requestType || null,
                is_urgent: Boolean(cachedLlm.isUrgent)
              }, msg.messageKey || msg.id || "");
            }
            // Restore llmExtraction metadata: prefer live, fall back to cache.
            const savedLlmMeta = msg.analysis?.llmExtraction || (cachedLlm && cachedLlm.processedAt ? {
              processedAt: cachedLlm.processedAt,
              model: cachedLlm.model,
              requestType: cachedLlm.requestType,
              isUrgent: cachedLlm.isUrgent,
              missingForProcessing: cachedLlm.missingForProcessing || [],
              newArticlesAdded: cachedLlm.newArticlesAdded || 0,
              fromCache: true
            } : null);
            if (savedLlmMeta) newAnalysis.llmExtraction = savedLlmMeta;
            if (msg.analysis?.llmConfig) newAnalysis.llmConfig = msg.analysis.llmConfig;
            // J4: re-run post-processing after LLM cache restore so request-type fallback,
            // missing-enum normalization, and quality gate reflect the merged state.
            applyPostProcessing(newAnalysis);
            msg.analysis = newAnalysis;
            msg.brand = (newAnalysis.detectedBrands || [])[0] || null;
            const wasManuallyChanged = (msg.auditLog || []).some((e) => e.action === "status_change");
            if (!wasManuallyChanged) {
              msg.pipelineStatus = computePipelineStatus(newAnalysis);
            }
            recordProcessingTelemetrySample(telemetry, Date.now() - sampleStartedAt);
            job.progress.processed++;
          } catch { job.progress.errors++; }
          // Yield every 10 messages to keep event loop responsive (SSE keepalive, health checks)
          if (j % 10 === 9) { telemetry.yields += 1; await yieldProcessingLoop(); }
        }

        telemetry.batches += 1;
        if (telemetry.batches % 5 === 0) await store.persist();
        if (i + BATCH_SIZE < messages.length) { telemetry.yields += 1; await yieldProcessingLoop(); }
      }

      job.progress.currentSubject = null;
      await store.persist();
      const durationMs = Date.now() - startTime;
      finishBackgroundJob(job, {
        status: "done",
        run: {
          total: messages.length,
          processed: job.progress.processed,
          skipped: job.progress.skipped,
          errors: job.progress.errors,
          durationMs,
          telemetry: finalizeProcessingTelemetry(telemetry, durationMs)
        }
      });
    })().catch((err) => finishBackgroundJob(job, { status: "error", error: err.message }));

    return sendJson(res, 202, { jobId: job.id, total: messages.length, message: `Анализ запущен для ${messages.length} писем.` });
  }

  if (req.method === "DELETE" && reanalyzeMatch) {
    const job = findRunningProjectJob(reanalyzeMatch[1], ["reanalyze"]);
    if (!job) return sendJson(res, 404, { error: "No active reanalysis job." });
    finishBackgroundJob(job, { status: "cancelled", error: "Отменено пользователем" });
    return sendJson(res, 200, { ok: true, jobId: job.id });
  }

  // --- LLM reanalyze (background job, processes only not-yet-LLM-analyzed non-spam) ---
  const reanalyzeLlmMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/reanalyze-llm$/);
  if (req.method === "POST" && reanalyzeLlmMatch) {
    const project = await store.getProject(reanalyzeLlmMatch[1]);
    if (!project) return sendJson(res, 404, { error: "Project not found." });

    if (!isLlmExtractEnabled()) {
      return sendJson(res, 400, { error: "LLM extraction is disabled. Set LLM_EXTRACT_ENABLED=true and LLM_EXTRACT_API_KEY." });
    }

    const activeJob = findRunningProjectJob(project.id, ["llm-reanalyze"]);
    if (activeJob) {
      return sendJson(res, 409, { error: "LLM reanalysis already running.", jobId: activeJob.id });
    }

    const job = createTypedBackgroundJob(project.id, "llm-reanalyze");
    // Parse audit filters from body (optional). When filters provided, includes
    // already-LLM-processed messages that still have gaps in targeted fields.
    const reqBody = await parseRequestJson(req).catch(() => ({}));
    const filters = Array.isArray(reqBody?.filters) ? reqBody.filters : [];
    const isAuditMode = filters.length > 0;
    job.progress = { total: 0, processed: 0, skipped: 0, errors: 0, currentSubject: null, mode: isAuditMode ? "audit" : "backlog", filters };

    // Build queue: non-spam messages matching backlog or audit filter
    const queue = (project.recentMessages || []).filter((msg) => {
      if (!msg.analysis) return false;
      if (msg.pipelineStatus === "ignored_spam" || msg.pipelineStatus === "ignored_duplicate") return false;
      const label = msg.analysis.classification?.label || "";
      if (label === "СПАМ") return false;

      const hasLlm = Boolean(msg.analysis.llmExtraction?.processedAt);
      if (!isAuditMode) return !hasLlm;

      // Audit mode: include if any filter matches a known gap
      const a = msg.analysis;
      return filters.some((f) => {
        if (f === "empty_request_type") return !a.llmExtraction?.requestType;
        if (f === "empty_company") return !a.sender?.companyName;
        if (f === "empty_fio") return !a.sender?.fullName;
        if (f === "empty_phone") return !a.sender?.mobilePhone && !a.sender?.cityPhone;
        if (f === "empty_inn") return !a.sender?.inn;
        if (f === "no_llm") return !hasLlm;
        return false;
      });
    });

    // In audit mode, save a snapshot of each message's prior llmExtraction (or
    // fall back to durable llm-cache.json to heal messages regressed by prior
    // audit runs that had silent LLM failures). Then clear processedAt so
    // analyzeEmailAsync re-calls LLM. If the new call returns null, we restore
    // the snapshot so we never lose previously-extracted data.
    const priorLlmSnapshot = new Map();
    if (isAuditMode) {
      for (const msg of queue) {
        const key = msg.messageKey || msg.id;
        let priorLlm = null;
        if (msg.analysis?.llmExtraction?.processedAt) {
          priorLlm = { ...msg.analysis.llmExtraction };
        } else {
          const cached = readLlmCache(key);
          if (cached && cached.processedAt) {
            priorLlm = {
              processedAt: cached.processedAt,
              model: cached.model,
              requestType: cached.requestType,
              isUrgent: cached.isUrgent,
              missingForProcessing: cached.missingForProcessing || [],
              newArticlesAdded: cached.newArticlesAdded || 0,
              fromCache: true
            };
          }
        }
        if (priorLlm) {
          priorLlmSnapshot.set(key, priorLlm);
          if (msg.analysis?.llmExtraction) {
            msg.analysis.llmExtraction.processedAt = null;
          }
        }
      }
    }

    job.progress.total = queue.length;
    job.progress.llmFailed = 0;

    // Run async in background with bounded concurrency pool
    (async () => {
      const { analyzeEmailAsync } = await import("./services/email-analyzer.js");
      // Concurrency pool: N workers pull from shared queue. With N=5 and ~2s/request
      // this gives ~150 req/min vs. 17 req/min in the old sequential loop — ~9× speedup.
      // Override via LLM_REANALYZE_CONCURRENCY env if provider has stricter rate limits.
      const CONCURRENCY = Math.max(1, Number(process.env.LLM_REANALYZE_CONCURRENCY) || 5);
      let queueIdx = 0;
      let lastPersistedCount = 0;
      let persistInFlight = false;
      const persistGuard = async () => {
        if (persistInFlight) return;
        const due = (job.progress.processed + job.progress.errors) - lastPersistedCount;
        if (due < 10) return;
        persistInFlight = true;
        try {
          lastPersistedCount = job.progress.processed + job.progress.errors;
          await store.persist();
        } finally {
          persistInFlight = false;
        }
      };

      async function worker() {
        while (job.status === "running") {
          const idx = queueIdx++;
          if (idx >= queue.length) break;
          const msg = queue[idx];

          job.progress.currentSubject = msg.subject || "(без темы)";
          const body = msg.body || msg.bodyPreview || msg.analysis?.lead?.freeText || "";
          try {
            const newAnalysis = await analyzeEmailAsync(project, {
              messageKey: msg.messageKey || msg.id,
              fromEmail: msg.from || msg.analysis?.sender?.email || "",
              fromName: msg.analysis?.sender?.fullName || "",
              subject: msg.subject || "",
              body,
              attachments: (msg.attachmentFiles || msg.attachments || []).map((a) => typeof a === "string" ? a : a.filename || a.name || ""),
              attachmentFiles: (msg.attachmentFiles || []).map((a) => typeof a === "string" ? { filename: a } : a)
            });
            newAnalysis.analysisId = msg.analysis?.analysisId || newAnalysis.analysisId;

            // Audit-mode LLM-failure guard: if fresh call returned no llmExtraction
            // (silent API failure/timeout — llmExtract returns null on non-2xx),
            // restore the prior snapshot so we don't regress on previously-filled fields.
            if (isAuditMode && !newAnalysis.llmExtraction?.processedAt) {
              const key = msg.messageKey || msg.id;
              const prior = priorLlmSnapshot.get(key);
              if (prior) {
                newAnalysis.llmExtraction = prior;
                job.progress.llmFailed++;
              }
            }

            msg.analysis = newAnalysis;
            msg.brand = (newAnalysis.detectedBrands || [])[0] || null;
            const wasManuallyChanged = (msg.auditLog || []).some((e) => e.action === "status_change");
            if (!wasManuallyChanged) {
              const label = newAnalysis.classification?.label;
              msg.pipelineStatus = label === "СПАМ"
                ? "ignored_spam"
                : label === "Клиент"
                  ? "ready_for_crm"
                  : newAnalysis.crm?.needsClarification
                    ? "needs_clarification"
                    : "review";
            }
            job.progress.processed++;
          } catch {
            job.progress.errors++;
          }

          await persistGuard();
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

      // Retroactive reclassification: apply stored llmExtraction.requestType to existing
      // classifications. Handles: upgrades (Не определено → Клиент/Поставщик), downgrades
      // (Клиент/Поставщик → Не определено when rt=other), flips (Клиент → Поставщик on vendor_offer)
      let retroclassified = 0;
      for (const msg of project.recentMessages || []) {
        if (!msg.analysis) continue;
        const rt = msg.analysis.llmExtraction?.requestType;
        if (!rt) continue;
        const wasManuallyChanged = (msg.auditLog || []).some((e) => e.action === "status_change");
        if (wasManuallyChanged) continue;
        const currentLabel = msg.analysis.classification?.label;

        if (currentLabel === "Не определено") {
          if (["quotation", "order", "info_request", "complaint"].includes(rt)) {
            msg.analysis.classification.label = "Клиент";
            msg.analysis.classification.llmReclassified = true;
            msg.analysis.classification.llmRequestType = rt;
            msg.pipelineStatus = msg.analysis.crm?.needsClarification ? "needs_clarification" : "ready_for_crm";
            retroclassified++;
          } else if (rt === "vendor_offer") {
            msg.analysis.classification.label = "Поставщик услуг";
            msg.analysis.classification.llmReclassified = true;
            msg.analysis.classification.llmRequestType = rt;
            retroclassified++;
          }
        } else if (rt === "other" && (currentLabel === "Клиент" || currentLabel === "Поставщик услуг")) {
          // Downgrade guard: keep rules label when hard evidence or high rules confidence
          const hasArticles = (msg.analysis.lead?.articles || []).length > 0;
          const hasBrands = (msg.analysis.detectedBrands || []).length > 0;
          const rulesConf = Number(msg.analysis.classification?.confidence ?? 0);
          const rulesHighConf = rulesConf >= 0.85;
          if (!hasArticles && !hasBrands && !rulesHighConf) {
            msg.analysis.classification.label = "Не определено";
            msg.analysis.classification.llmRequestType = rt;
            msg.analysis.classification.llmDowngraded = true;
            msg.analysis.classification.needsReview = true;
            msg.pipelineStatus = "review";
            retroclassified++;
          } else {
            msg.analysis.classification.llmRequestType = rt;
            msg.analysis.classification.llmDisagreed = true;
          }
        } else if (rt === "vendor_offer" && currentLabel === "Клиент") {
          msg.analysis.classification.label = "Поставщик услуг";
          msg.analysis.classification.llmRequestType = rt;
          msg.analysis.classification.llmReclassified = true;
          msg.pipelineStatus = "review";
          retroclassified++;
        }
      }
      if (retroclassified > 0) {
        console.log(`LLM retroclassified ${retroclassified} "Не определено" messages for project ${project.id}`);
      }

      job.progress.retroclassified = retroclassified;
      job.progress.currentSubject = null;
      await store.persist();
      finishBackgroundJob(job, {
        status: "done",
        run: {
          total: queue.length,
          processed: job.progress.processed,
          errors: job.progress.errors,
          retroclassified,
          durationMs: Date.now() - Date.parse(job.startedAt)
        }
      });
    })().catch((err) => {
      finishBackgroundJob(job, { status: "error", error: err.message });
    });

    return sendJson(res, 202, {
      jobId: job.id,
      total: queue.length,
      mode: isAuditMode ? "audit" : "backlog",
      filters,
      message: isAuditMode
        ? `LLM-аудит запущен для ${queue.length} писем с пропусками в полях: ${filters.join(", ")}.`
        : `LLM-анализ запущен для ${queue.length} писем.`
    });
  }

  if (req.method === "DELETE" && reanalyzeLlmMatch) {
    const job = findRunningProjectJob(reanalyzeLlmMatch[1], ["llm-reanalyze"]);
    if (!job) return sendJson(res, 404, { error: "No active LLM reanalysis job." });
    finishBackgroundJob(job, { status: "cancelled", error: "Отменено пользователем" });
    return sendJson(res, 200, { ok: true, jobId: job.id });
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

  const messageIntegrationJsonMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/messages\/([^/]+)\/integration-json$/);
  if (req.method === "GET" && messageIntegrationJsonMatch) {
    const project = await store.getProject(messageIntegrationJsonMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }
    const messageKey = decodeURIComponent(messageIntegrationJsonMatch[2]);
    const { normalizeIntegrationMessage } = await import("./services/integration-api.js");
    const message = (project.recentMessages || []).find((item) => (item.messageKey || item.id) === messageKey);
    if (!message) {
      return sendJson(res, 404, { error: "Message not found." });
    }
    const payload = normalizeIntegrationMessage(project, message, {
      include: "body,attachments_analysis,extraction_meta,audit"
    });
    return sendJson(res, 200, { data: payload });
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
    // S3: Rate-limit feedback by IP to prevent KB spam
    const fbClientId = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
    const fbRate = checkRateLimit(`feedback:${fbClientId}`);
    if (!fbRate.allowed) return sendJson(res, 429, { error: "Rate limit exceeded.", retryAfter: fbRate.retryAfter });
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

    for (const item of Array.isArray(payload.lineItems) ? payload.lineItems : []) {
      const article = String(item.article || "").trim();
      const productName = String(item.descriptionRu || item.name || "").trim();
      if (!article) continue;
      try {
        detectionKb.learnNomenclatureFeedback({
          article,
          productName,
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

  // ── CRM single-send ──
  const crmSendMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/messages\/([^/]+)\/crm-send$/);
  if (req.method === "POST" && crmSendMatch) {
    if (!siderusCrmSender?.isEnabled()) return sendJson(res, 503, { error: "CRM sender not configured." });
    const project = await store.getProject(crmSendMatch[1]);
    if (!project) return sendJson(res, 404, { error: "Project not found." });
    const messageKey = decodeURIComponent(crmSendMatch[2]);
    const message = (project.recentMessages || []).find((m) => (m.messageKey || m.id) === messageKey);
    if (!message) return sendJson(res, 404, { error: "Message not found." });
    if (message.pipelineStatus !== "ready_for_crm") {
      return sendJson(res, 400, { error: "Message is not ready_for_crm." });
    }
    try {
      const payload = buildSiderusCrmPayload(project, message);
      await siderusCrmSender._post(payload);
      const sentAt = new Date().toISOString();
      await store.acknowledgeMessageExport(project.id, messageKey, { consumer: "siderus-crm", note: "manual send" });
      return sendJson(res, 200, { ok: true, sentAt });
    } catch (err) {
      return sendJson(res, 502, { error: err.message });
    }
  }

  // ── CRM bulk resend ──
  const crmResendMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/crm-resend$/);
  if (req.method === "POST" && crmResendMatch) {
    if (!siderusCrmSender?.isEnabled()) return sendJson(res, 503, { error: "CRM sender not configured." });
    const project = await store.getProject(crmResendMatch[1]);
    if (!project) return sendJson(res, 404, { error: "Project not found." });
    const eligible = (project.recentMessages || []).filter((m) => m.pipelineStatus === "ready_for_crm");
    const toSend = eligible.filter((m) => !m.integrationExports?.["siderus-crm"]);
    let sent = 0, skipped = eligible.length - toSend.length, failed = 0;
    const errors = [];
    for (const message of toSend) {
      const key = message.messageKey || message.id;
      try {
        const payload = buildSiderusCrmPayload(project, message);
        await siderusCrmSender._post(payload);
        await store.acknowledgeMessageExport(project.id, key, { consumer: "siderus-crm", note: "bulk resend" });
        sent++;
      } catch (err) {
        failed++;
        errors.push({ key, error: err.message });
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return sendJson(res, 200, { sent, skipped, failed, total: eligible.length, errors });
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

  const resolveScopedClientPresets = (projectId = "") => detectionKb.listApiClientPresets(currentClient.id, { projectId });

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

  if (req.method === "GET" && url.pathname === "/api/integration/presets") {
    const projectId = String(url.searchParams.get("project_id") || "").trim();
    if (projectId && !canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    return sendJson(res, 200, listIntegrationPresets({
      clientPresets: resolveScopedClientPresets(projectId)
    }));
  }

  if (req.method === "POST" && url.pathname === "/api/integration/presets") {
    const payload = await parseRequestJson(req);
    const projectId = String(payload.projectId || payload.project_id || "").trim();
    if (projectId && !canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    try {
      const preset = detectionKb.upsertApiClientPreset(currentClient.id, payload);
      return sendJson(res, 200, { data: preset });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || "Invalid preset payload." });
    }
  }

  const integrationPresetMatch = url.pathname.match(/^\/api\/integration\/presets\/([^/]+)$/);
  if (integrationPresetMatch && req.method === "PUT") {
    const payload = await parseRequestJson(req);
    const projectId = String(payload.projectId || payload.project_id || "").trim();
    if (projectId && !canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    try {
      const preset = detectionKb.upsertApiClientPreset(currentClient.id, {
        ...payload,
        presetKey: decodeURIComponent(integrationPresetMatch[1])
      });
      return sendJson(res, 200, { data: preset });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || "Invalid preset payload." });
    }
  }

  if (integrationPresetMatch && req.method === "DELETE") {
    const projectId = String(url.searchParams.get("project_id") || "").trim();
    if (projectId && !canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    return sendJson(res, 200, {
      data: detectionKb.deleteApiClientPreset(currentClient.id, decodeURIComponent(integrationPresetMatch[1]), { projectId })
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
      preset: url.searchParams.get("preset"),
      status: url.searchParams.get("status"),
      since,
      exported: url.searchParams.get("exported"),
      cursor,
      brand: url.searchParams.get("brand"),
      label: url.searchParams.get("label"),
      q: url.searchParams.get("q"),
      has_attachments: url.searchParams.get("has_attachments"),
      attachment_ext: url.searchParams.get("attachment_ext"),
      min_attachments: url.searchParams.get("min_attachments"),
      product_type: url.searchParams.get("product_type"),
      confirmed: url.searchParams.get("confirmed"),
      priority: url.searchParams.get("priority"),
      risk: url.searchParams.get("risk"),
      has_conflicts: url.searchParams.get("has_conflicts"),
      company_present: url.searchParams.get("company_present"),
      inn_present: url.searchParams.get("inn_present"),
      phone_present: url.searchParams.get("phone_present"),
      article_present: url.searchParams.get("article_present"),
      sla_overdue: url.searchParams.get("sla_overdue"),
      include: url.searchParams.get("include")
    }, {
      consumerId: currentClient.id,
      clientPresets: resolveScopedClientPresets(projectId)
    }));
  }

  const integrationMessageStatsMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/messages\/stats$/);
  if (req.method === "GET" && integrationMessageStatsMatch) {
    const projectId = decodeURIComponent(integrationMessageStatsMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    return sendJson(res, 200, summarizeIntegrationMessages(project, {
      preset: url.searchParams.get("preset"),
      status: url.searchParams.get("status"),
      since: url.searchParams.get("since"),
      exported: url.searchParams.get("exported"),
      brand: url.searchParams.get("brand"),
      label: url.searchParams.get("label"),
      q: url.searchParams.get("q"),
      has_attachments: url.searchParams.get("has_attachments"),
      attachment_ext: url.searchParams.get("attachment_ext"),
      min_attachments: url.searchParams.get("min_attachments"),
      product_type: url.searchParams.get("product_type"),
      confirmed: url.searchParams.get("confirmed"),
      priority: url.searchParams.get("priority"),
      risk: url.searchParams.get("risk"),
      has_conflicts: url.searchParams.get("has_conflicts"),
      company_present: url.searchParams.get("company_present"),
      inn_present: url.searchParams.get("inn_present"),
      phone_present: url.searchParams.get("phone_present"),
      article_present: url.searchParams.get("article_present"),
      sla_overdue: url.searchParams.get("sla_overdue")
    }, {
      consumerId: currentClient.id,
      clientPresets: resolveScopedClientPresets(projectId)
    }));
  }

  const integrationMessageCoverageMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/messages\/coverage$/);
  if (req.method === "GET" && integrationMessageCoverageMatch) {
    const projectId = decodeURIComponent(integrationMessageCoverageMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    return sendJson(res, 200, summarizeIntegrationCoverage(project, {
      preset: url.searchParams.get("preset"),
      status: url.searchParams.get("status"),
      since: url.searchParams.get("since"),
      exported: url.searchParams.get("exported"),
      brand: url.searchParams.get("brand"),
      label: url.searchParams.get("label"),
      q: url.searchParams.get("q"),
      has_attachments: url.searchParams.get("has_attachments"),
      attachment_ext: url.searchParams.get("attachment_ext"),
      min_attachments: url.searchParams.get("min_attachments"),
      product_type: url.searchParams.get("product_type"),
      confirmed: url.searchParams.get("confirmed"),
      priority: url.searchParams.get("priority"),
      risk: url.searchParams.get("risk"),
      has_conflicts: url.searchParams.get("has_conflicts"),
      company_present: url.searchParams.get("company_present"),
      inn_present: url.searchParams.get("inn_present"),
      phone_present: url.searchParams.get("phone_present"),
      article_present: url.searchParams.get("article_present"),
      sla_overdue: url.searchParams.get("sla_overdue")
    }, {
      consumerId: currentClient.id,
      clientPresets: resolveScopedClientPresets(projectId)
    }));
  }

  const integrationMessageProblemsMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/messages\/problems$/);
  if (req.method === "GET" && integrationMessageProblemsMatch) {
    const projectId = decodeURIComponent(integrationMessageProblemsMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    return sendJson(res, 200, summarizeIntegrationProblems(project, {
      preset: url.searchParams.get("preset"),
      status: url.searchParams.get("status"),
      since: url.searchParams.get("since"),
      exported: url.searchParams.get("exported"),
      brand: url.searchParams.get("brand"),
      label: url.searchParams.get("label"),
      q: url.searchParams.get("q"),
      has_attachments: url.searchParams.get("has_attachments"),
      attachment_ext: url.searchParams.get("attachment_ext"),
      min_attachments: url.searchParams.get("min_attachments"),
      product_type: url.searchParams.get("product_type"),
      confirmed: url.searchParams.get("confirmed"),
      priority: url.searchParams.get("priority"),
      risk: url.searchParams.get("risk"),
      has_conflicts: url.searchParams.get("has_conflicts"),
      company_present: url.searchParams.get("company_present"),
      inn_present: url.searchParams.get("inn_present"),
      phone_present: url.searchParams.get("phone_present"),
      article_present: url.searchParams.get("article_present"),
      sla_overdue: url.searchParams.get("sla_overdue"),
      limit: url.searchParams.get("limit")
    }, {
      consumerId: currentClient.id,
      clientPresets: resolveScopedClientPresets(projectId)
    }));
  }

  const integrationMessageExportMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/messages\/export$/);
  if (req.method === "GET" && integrationMessageExportMatch) {
    const projectId = decodeURIComponent(integrationMessageExportMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const exported = exportIntegrationMessages(project, {
      preset: url.searchParams.get("preset"),
      status: url.searchParams.get("status"),
      since: url.searchParams.get("since"),
      exported: url.searchParams.get("exported"),
      brand: url.searchParams.get("brand"),
      label: url.searchParams.get("label"),
      q: url.searchParams.get("q"),
      has_attachments: url.searchParams.get("has_attachments"),
      attachment_ext: url.searchParams.get("attachment_ext"),
      min_attachments: url.searchParams.get("min_attachments"),
      product_type: url.searchParams.get("product_type"),
      confirmed: url.searchParams.get("confirmed"),
      priority: url.searchParams.get("priority"),
      risk: url.searchParams.get("risk"),
      has_conflicts: url.searchParams.get("has_conflicts"),
      company_present: url.searchParams.get("company_present"),
      inn_present: url.searchParams.get("inn_present"),
      phone_present: url.searchParams.get("phone_present"),
      article_present: url.searchParams.get("article_present"),
      sla_overdue: url.searchParams.get("sla_overdue"),
      include: url.searchParams.get("include"),
      format: url.searchParams.get("format")
    }, {
      consumerId: currentClient.id,
      clientPresets: resolveScopedClientPresets(projectId)
    });

    return sendText(res, 200, exported.body, {
      contentType: exported.contentType,
      filename: exported.filename
    });
  }

  const integrationEventsMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/events$/);
  if (req.method === "GET" && integrationEventsMatch) {
    const projectId = decodeURIComponent(integrationEventsMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const cursor = String(url.searchParams.get("cursor") || "").trim();
    if (cursor) {
      try {
        Buffer.from(cursor, "base64url").toString("utf-8");
      } catch {
        return sendJson(res, 400, { error: "Query parameter 'cursor' must be a valid event cursor." });
      }
    }

    return sendJson(res, 200, listIntegrationEvents(project, {
      limit: url.searchParams.get("limit"),
      preset: url.searchParams.get("preset"),
      since: url.searchParams.get("since"),
      cursor,
      type: url.searchParams.get("type"),
      scope: url.searchParams.get("scope"),
      status: url.searchParams.get("status"),
      exported: url.searchParams.get("exported"),
      brand: url.searchParams.get("brand"),
      label: url.searchParams.get("label"),
      q: url.searchParams.get("q"),
      has_attachments: url.searchParams.get("has_attachments"),
      attachment_ext: url.searchParams.get("attachment_ext"),
      min_attachments: url.searchParams.get("min_attachments"),
      product_type: url.searchParams.get("product_type"),
      confirmed: url.searchParams.get("confirmed"),
      priority: url.searchParams.get("priority"),
      risk: url.searchParams.get("risk"),
      has_conflicts: url.searchParams.get("has_conflicts"),
      company_present: url.searchParams.get("company_present"),
      inn_present: url.searchParams.get("inn_present"),
      phone_present: url.searchParams.get("phone_present"),
      article_present: url.searchParams.get("article_present"),
      sla_overdue: url.searchParams.get("sla_overdue")
    }, {
      consumerId: currentClient.id,
      clientId: currentClient.id,
      clientPresets: resolveScopedClientPresets(projectId)
    }));
  }

  const integrationEventsExportMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/events\/export$/);
  if (req.method === "GET" && integrationEventsExportMatch) {
    const projectId = decodeURIComponent(integrationEventsExportMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const exported = exportIntegrationEvents(project, {
      format: url.searchParams.get("format"),
      preset: url.searchParams.get("preset"),
      limit: url.searchParams.get("limit"),
      since: url.searchParams.get("since"),
      cursor: url.searchParams.get("cursor"),
      type: url.searchParams.get("type"),
      scope: url.searchParams.get("scope"),
      status: url.searchParams.get("status"),
      exported: url.searchParams.get("exported"),
      brand: url.searchParams.get("brand"),
      label: url.searchParams.get("label"),
      q: url.searchParams.get("q"),
      has_attachments: url.searchParams.get("has_attachments"),
      attachment_ext: url.searchParams.get("attachment_ext"),
      min_attachments: url.searchParams.get("min_attachments"),
      product_type: url.searchParams.get("product_type"),
      confirmed: url.searchParams.get("confirmed"),
      priority: url.searchParams.get("priority"),
      risk: url.searchParams.get("risk"),
      has_conflicts: url.searchParams.get("has_conflicts"),
      company_present: url.searchParams.get("company_present"),
      inn_present: url.searchParams.get("inn_present"),
      phone_present: url.searchParams.get("phone_present"),
      article_present: url.searchParams.get("article_present"),
      sla_overdue: url.searchParams.get("sla_overdue")
    }, {
      consumerId: currentClient.id,
      clientId: currentClient.id,
      clientPresets: resolveScopedClientPresets(projectId)
    });

    return sendText(res, 200, exported.body, {
      contentType: exported.contentType,
      filename: exported.filename
    });
  }

  const integrationThreadsMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/threads$/);
  if (req.method === "GET" && integrationThreadsMatch) {
    const projectId = decodeURIComponent(integrationThreadsMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    return sendJson(res, 200, listIntegrationThreads(project, {
      preset: url.searchParams.get("preset"),
      status: url.searchParams.get("status"),
      since: url.searchParams.get("since"),
      exported: url.searchParams.get("exported"),
      brand: url.searchParams.get("brand"),
      label: url.searchParams.get("label"),
      q: url.searchParams.get("q"),
      has_attachments: url.searchParams.get("has_attachments"),
      attachment_ext: url.searchParams.get("attachment_ext"),
      min_attachments: url.searchParams.get("min_attachments"),
      product_type: url.searchParams.get("product_type"),
      confirmed: url.searchParams.get("confirmed"),
      priority: url.searchParams.get("priority"),
      risk: url.searchParams.get("risk"),
      has_conflicts: url.searchParams.get("has_conflicts"),
      company_present: url.searchParams.get("company_present"),
      inn_present: url.searchParams.get("inn_present"),
      phone_present: url.searchParams.get("phone_present"),
      article_present: url.searchParams.get("article_present"),
      sla_overdue: url.searchParams.get("sla_overdue"),
      include: url.searchParams.get("include"),
      include_messages: url.searchParams.get("include_messages")
    }, {
      consumerId: currentClient.id,
      clientPresets: resolveScopedClientPresets(projectId)
    }));
  }

  const integrationThreadMatch = url.pathname.match(/^\/api\/integration\/projects\/([^/]+)\/threads\/([^/]+)$/);
  if (req.method === "GET" && integrationThreadMatch) {
    const projectId = decodeURIComponent(integrationThreadMatch[1]);
    if (!canClientAccessProject(currentClient, projectId)) {
      return sendJson(res, 403, { error: "Client is not allowed to access this project." });
    }
    const project = await store.getProject(projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const thread = findIntegrationThread(project, decodeURIComponent(integrationThreadMatch[2]), {
      include: url.searchParams.get("include"),
      preset: url.searchParams.get("preset")
    }, {
      consumerId: currentClient.id,
      clientPresets: resolveScopedClientPresets(projectId)
    });
    if (!thread) {
      return sendJson(res, 404, { error: "Thread not found." });
    }

    return sendJson(res, 200, { data: thread });
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

    const message = findIntegrationMessage(project, decodeURIComponent(integrationMessageMatch[2]), {
      consumerId: currentClient.id,
      include: url.searchParams.get("include")
    });
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

function sendText(res, statusCode, body, options = {}) {
  const headers = {
    "Content-Type": options.contentType || "text/plain; charset=utf-8"
  };
  if (options.filename) {
    headers["Content-Disposition"] = `attachment; filename="${options.filename}"`;
  }
  res.writeHead(statusCode, headers);
  res.end(body);
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
