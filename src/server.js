import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectsStore } from "./storage/projects-store.js";
import { analyzeEmail } from "./services/email-analyzer.js";
import { getTenderRuntime, runTenderImporter } from "./services/tender-runner.js";
import { ProjectScheduler } from "./services/project-scheduler.js";
import { getMailboxFileRuntime, runMailboxFileParser } from "./services/project3-runner.js";
import { detectionKb } from "./services/detection-kb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = path.resolve(rootDir, process.env.DATA_DIR || "data");
const port = Number(process.env.PORT || 3000);
const store = new ProjectsStore({ dataDir });
const scheduler = new ProjectScheduler({ store, rootDir });

// Background job tracking for long-running tasks
const backgroundJobs = new Map();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Internal Server Error", details: error.message }));
  }
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  scheduler.start();
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/detection-kb") {
    return sendJson(res, 200, {
      stats: detectionKb.getStats(),
      rules: detectionKb.getRules(),
      brandAliases: detectionKb.getBrandAliases(),
      senderProfiles: detectionKb.getSenderProfiles(),
      corpus: detectionKb.getCorpus(25)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/rules") {
    const payload = await parseJsonBody(req);
    if (!payload.scope || !payload.classifier || !payload.matchType || !payload.pattern) {
      return sendJson(res, 400, { error: "Fields 'scope', 'classifier', 'matchType' and 'pattern' are required." });
    }

    const rule = detectionKb.addRule(payload);
    return sendJson(res, 201, { rule });
  }

  if (req.method === "POST" && url.pathname === "/api/detection-kb/brand-aliases") {
    const payload = await parseJsonBody(req);
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

  if (req.method === "POST" && url.pathname === "/api/detection-kb/sender-profiles") {
    const payload = await parseJsonBody(req);
    if (!payload.classification) {
      return sendJson(res, 400, { error: "Field 'classification' is required." });
    }

    const senderProfile = detectionKb.addSenderProfile(payload);
    return sendJson(res, 201, { senderProfile });
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    const projects = await store.listProjects();
    return sendJson(res, 200, { projects });
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    const payload = await parseJsonBody(req);
    if (!payload.name || !payload.mailbox) {
      return sendJson(res, 400, { error: "Fields 'name' and 'mailbox' are required." });
    }

    const project = await store.createProject(payload);
    return sendJson(res, 201, { project });
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

    const payload = await parseJsonBody(req);

    // mailbox-file-parser runs async to avoid Railway HTTP timeout
    if (project.type === "mailbox-file-parser") {
      const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const job = { id: jobId, projectId: project.id, status: "running", run: null, error: null, startedAt: new Date().toISOString() };
      backgroundJobs.set(jobId, job);

      // Fire and forget — process runs in background
      runMailboxFileParser(project, rootDir, payload)
        .then(async (run) => {
          await store.appendRun(project.id, run);
          if (Array.isArray(run.recentMessages)) {
            await store.replaceRecentMessages(project.id, run.recentMessages);
          }
          job.status = "done";
          job.run = run;
        })
        .catch((error) => {
          job.status = "error";
          job.error = error.message;
        });

      return sendJson(res, 202, { jobId, message: "Запуск начат в фоновом режиме. Проверяйте статус через /api/projects/" + project.id + "/job/" + jobId });
    }

    // tender-importer runs synchronously (fast)
    let run;
    try {
      run = await runTenderImporter(project, rootDir, payload);
    } catch (error) {
      return sendJson(res, 500, {
        error: "Project runner failed to start.",
        details: error.code === "EPERM"
          ? "Process spawning is blocked in the current sandbox. Run locally or on Railway."
          : error.message
      });
    }

    await store.appendRun(project.id, run);
    if (Array.isArray(run.recentMessages)) {
      await store.replaceRecentMessages(project.id, run.recentMessages);
    }
    return sendJson(res, 200, { run });
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
  if (req.method === "PATCH" && messagePatchMatch) {
    const project = await store.getProject(messagePatchMatch[1]);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found." });
    }

    const payload = await parseJsonBody(req);
    if (!payload.pipelineStatus) {
      return sendJson(res, 400, { error: "Field 'pipelineStatus' is required." });
    }

    const result = await store.updateMessageStatus(project.id, decodeURIComponent(messagePatchMatch[2]), payload.pipelineStatus);
    if (!result) {
      return sendJson(res, 404, { error: "Message not found." });
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

    const payload = await parseJsonBody(req);
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

    const payload = await parseJsonBody(req);
    if (!payload.fromEmail || !payload.body) {
      return sendJson(res, 400, { error: "Fields 'fromEmail' and 'body' are required." });
    }

    const analysis = analyzeEmail(project, payload);
    await store.appendAnalysis(project.id, analysis);
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

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
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
