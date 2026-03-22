import { createHash, randomUUID } from "node:crypto";
import { access, readFile, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { analyzeEmail } from "./email-analyzer.js";
import { parseMailboxConfigText } from "./mailbox-config-parser.js";
import { detectionKb } from "./detection-kb.js";

export async function getMailboxFileRuntime(project, rootDir) {
  const runtime = project.runtime || {};
  const sourceFile = path.resolve(rootDir, runtime.sourceFile || "1.txt");
  const scriptPath = path.resolve(rootDir, runtime.scriptPath || "project 3/mailbox_file_runner.py");

  const sourceExists = await exists(sourceFile);
  const scriptExists = await exists(scriptPath);
  const accounts = sourceExists ? parseMailboxConfigText(await readFile(sourceFile, "utf-8")) : [];

  return {
    projectId: project.id,
    kind: "mailbox-file-parser",
    sourceFile,
    sourceExists,
    scriptPath,
    scriptExists,
    accountCount: accounts.length,
    brands: unique(accounts.map((account) => account.brand).filter(Boolean)),
    mailboxesPreview: accounts.slice(0, 10).map((account) => ({
      mailbox: account.mailbox,
      brand: account.brand,
      siteUrl: account.siteUrl
    }))
  };
}

export async function runMailboxFileParser(project, rootDir, options = {}) {
  const runtime = project.runtime || {};
  const sourceFile = path.resolve(rootDir, runtime.sourceFile || "1.txt");
  const scriptPath = path.resolve(rootDir, runtime.scriptPath || "project 3/mailbox_file_runner.py");
  const days = Math.max(1, Number(options.days || project.schedule?.days || 1));
  const maxEmails = Math.max(1, Number(options.maxEmails || 100));
  const workingDirectory = path.resolve(rootDir, runtime.workingDirectory || "project 3");
  const startedAt = Date.now();

  const imapHost = runtime.imapHost || process.env.PROJECT3_IMAP_HOST || "mail.hosting.reg.ru";
  const imapPort = runtime.imapPort || process.env.PROJECT3_IMAP_PORT || "993";

  const result = await runPythonProcess(scriptPath, workingDirectory, {
    ...process.env,
    PROJECT3_SOURCE_FILE: sourceFile,
    PROJECT3_DAYS: String(days),
    PROJECT3_MAX_EMAILS: String(maxEmails),
    PROJECT3_IMAP_HOST: imapHost,
    PROJECT3_IMAP_PORT: imapPort
  }, Number(options.timeoutMs || 900000), days);

  const payload = parsePayload(result.stdout) || { emails: [], accountCount: 0, fetchedEmailCount: 0, errorCount: 0 };
  const brands = unique((project.brands || []).concat(payload.emails.map((item) => item.brand).filter(Boolean)));
  const analysisProject = {
    mailbox: project.mailbox,
    brands,
    managerPool: project.managerPool || { defaultMop: "Не назначен", defaultMoz: "Не назначен", brandOwners: [] },
    knownCompanies: project.knownCompanies || []
  };

  const filteredEmails = payload.emails.filter((item) => item.body || item.error);
  const analyzedEmails = [];
  for (const item of filteredEmails) {
    const { fromName, fromEmail } = splitFromHeader(item.from);
    const messageKey = createMessageKey(item, fromEmail);

    // Save attachment files to disk before analysis so the analyzer can read them.
    const attachmentFiles = [];
    if (Array.isArray(item.attachmentData)) {
      for (const att of item.attachmentData) {
        if (att.base64) {
          try {
            const attDir = path.resolve(rootDir, "data", "attachments", messageKey);
            await mkdir(attDir, { recursive: true });
            const safeName = att.filename.replace(/[<>:"/\\|?*]/g, "_");
            await writeFile(path.join(attDir, safeName), Buffer.from(att.base64, "base64"));
            attachmentFiles.push({ filename: att.filename, safeName, contentType: att.contentType, size: att.size });
          } catch { /* skip failed save */ }
        } else {
          attachmentFiles.push({ filename: att.filename, contentType: att.contentType || "", size: att.size || 0, safeName: null });
        }
      }
    }

    const analysis = analyzeEmail(analysisProject, {
      messageKey,
      fromName,
      fromEmail,
      subject: item.subject,
      body: item.body || item.error,
      attachments: item.attachments || [],
      attachmentFiles
    });

    const pipelineStatus = item.error
      ? "fetch_error"
      : analysis.classification.label === "СПАМ"
        ? "ignored_spam"
        : analysis.classification.label === "Клиент"
          ? "ready_for_crm"
          : analysis.crm?.needsClarification
            ? "needs_clarification"
            : "review";

    analyzedEmails.push({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      messageKey,
      mailbox: item.mailbox,
      brand: item.brand,
      siteUrl: item.siteUrl,
      subject: item.subject,
      from: item.from,
      bodyPreview: String(item.body || item.error || "").slice(0, 4000),
      attachments: item.attachments || [],
      attachmentFiles,
      error: item.error || null,
      pipelineStatus,
      analysis,
      emailMessageId: item.messageId || null,
      inReplyTo: item.inReplyTo || null,
      references: item.references || null
    });
  }

  // Deduplicate: skip emails that already exist in project messages
  const existingKeys = new Set((project.recentMessages || []).map((m) => m.messageKey));
  const newEmails = analyzedEmails.filter((item) => !existingKeys.has(item.messageKey));
  const duplicateCount = analyzedEmails.length - newEmails.length;

  const nonSpamMessages = newEmails.filter((item) => item.pipelineStatus !== "ignored_spam" && item.pipelineStatus !== "fetch_error");
  detectionKb.ingestAnalyzedMessages(project.id, nonSpamMessages);

  // Thread resolution: assign threadId based on In-Reply-To / References / Message-ID
  resolveThreadIds([...newEmails, ...(project.recentMessages || [])]);

  // Merge: keep existing messages + add new ones (cap at 2000)
  const mergedMessages = [...newEmails, ...(project.recentMessages || [])].slice(0, 5000);

  return {
    id: randomUUID(),
    createdAt: new Date(startedAt).toISOString(),
    status: result.exitCode === 0 ? "ok" : "error",
    days,
    maxEmails,
    processed: nonSpamMessages.length,
    added: newEmails.length,
    skipped: analyzedEmails.filter((item) => item.pipelineStatus === "ignored_spam").length,
    duplicates: duplicateCount,
    failed: payload.errorCount || 0,
    durationMs: Date.now() - startedAt,
    accountCount: payload.accountCount || 0,
    fetchedEmailCount: payload.fetchedEmailCount || 0,
    totalMessages: analyzedEmails.length,
    spamCount: analyzedEmails.filter((item) => item.pipelineStatus === "ignored_spam").length,
    readyForCrmCount: analyzedEmails.filter((item) => item.pipelineStatus === "ready_for_crm").length,
    clarificationCount: analyzedEmails.filter((item) => item.pipelineStatus === "needs_clarification").length,
    stdout: tailLines(result.stdout, 20),
    stderr: tailLines(result.stderr, 20),
    analysesPreview: nonSpamMessages.slice(0, 20),
    newMessages: newEmails,
    recentMessages: mergedMessages
  };
}

export async function reprocessMailboxMessages(project, options = {}) {
  const startedAt = Date.now();
  const limit = Math.max(1, Number(options.limit || 500));
  const batchSize = normalizeBatchSize(options.batchSize, 100);
  const preserveStatus = options.preserveStatus !== false;
  const statusFilter = parseStatuses(options.status);
  const selectedKeys = new Set(normalizeStringArray(options.messageKeys));
  const analysisProject = buildAnalysisProject(project);
  const sourceMessages = (project.recentMessages || [])
    .filter((item) => statusFilter.length === 0 || statusFilter.includes(item.pipelineStatus))
    .filter((item) => selectedKeys.size === 0 || selectedKeys.has(item.messageKey || item.id))
    .slice(0, limit);

  const updatedByKey = new Map();
  const changesPreview = [];
  let changedCount = 0;
  let statusChangedCount = 0;
  const telemetry = createTelemetry();

  for (let index = 0; index < sourceMessages.length; index += batchSize) {
    const batch = sourceMessages.slice(index, index + batchSize);
    for (const message of batch) {
      const sampleStartedAt = Date.now();
      const { fromName, fromEmail } = splitFromHeader(message.from);
      const analysis = analyzeEmail(analysisProject, {
        messageKey: message.messageKey || message.id,
        fromName,
        fromEmail,
        subject: message.subject,
        body: message.bodyPreview || "",
        attachments: message.attachments || [],
        attachmentFiles: message.attachmentFiles || []
      });
      recordTelemetrySample(telemetry, Date.now() - sampleStartedAt);
      const computedStatus = resolvePipelineStatus(message.error, analysis);
      const nextStatus = preserveStatus ? message.pipelineStatus : computedStatus;
      const diff = diffAnalysis(message.analysis || {}, analysis, message.pipelineStatus, nextStatus);

      if (diff.changed) {
        changedCount += 1;
        if (changesPreview.length < 20) {
          changesPreview.push({
            messageKey: message.messageKey || message.id,
            subject: message.subject || "",
            before: diff.before,
            after: diff.after
          });
        }
      }

      if (nextStatus !== message.pipelineStatus) {
        statusChangedCount += 1;
      }

      updatedByKey.set(message.messageKey || message.id, {
        ...message,
        pipelineStatus: nextStatus,
        analysis,
        reprocessedAt: new Date().toISOString(),
        auditLog: [
          ...(message.auditLog || []),
          {
            action: "reprocess",
            at: new Date().toISOString(),
            preserveStatus,
            previousStatus: message.pipelineStatus || null,
            computedStatus,
            nextStatus
          }
        ]
      });
    }

    telemetry.batches += 1;
    if (index + batchSize < sourceMessages.length) {
      telemetry.yields += 1;
      await yieldToEventLoop();
    }
  }

  const recentMessages = (project.recentMessages || []).map((item) => updatedByKey.get(item.messageKey || item.id) || item);
  resolveThreadIds(recentMessages);
  const nonSpamMessages = recentMessages.filter((item) => item.pipelineStatus !== "ignored_spam" && item.pipelineStatus !== "fetch_error");
  detectionKb.ingestAnalyzedMessages(project.id, nonSpamMessages);

  return {
    id: randomUUID(),
    createdAt: new Date(startedAt).toISOString(),
    status: "ok",
    trigger: "manual-reprocess",
    reprocessed: sourceMessages.length,
    changed: changedCount,
    statusChanged: statusChangedCount,
    preserveStatus,
    statusFilter,
    limit,
    batchSize,
    durationMs: Date.now() - startedAt,
    telemetry: finalizeTelemetry(telemetry, Date.now() - startedAt),
    changesPreview,
    newMessages: [],
    recentMessages
  };
}

function splitFromHeader(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(.*?)(?:<([^>]+)>)$/);
  if (match) {
    return {
      fromName: match[1].replace(/["']/g, "").trim(),
      fromEmail: match[2].trim().toLowerCase()
    };
  }

  return {
    fromName: "",
    fromEmail: text.toLowerCase()
  };
}

function buildAnalysisProject(project) {
  const inferredBrands = (project.recentMessages || []).flatMap((item) => [
    item.brand,
    ...(item.analysis?.detectedBrands || []),
    ...(item.analysis?.lead?.detectedBrands || [])
  ]).filter(Boolean);

  return {
    mailbox: project.mailbox,
    brands: unique((project.brands || []).concat(inferredBrands)),
    managerPool: project.managerPool || { defaultMop: "Не назначен", defaultMoz: "Не назначен", brandOwners: [] },
    knownCompanies: project.knownCompanies || []
  };
}

function resolvePipelineStatus(error, analysis) {
  if (error) {
    return "fetch_error";
  }

  if (analysis.classification.label === "СПАМ") {
    return "ignored_spam";
  }

  if (analysis.crm?.needsClarification) {
    return "needs_clarification";
  }

  if (analysis.classification.label === "Клиент") {
    return "ready_for_crm";
  }

  return "review";
}

function diffAnalysis(previous, next, previousStatus, nextStatus) {
  const before = {
    pipelineStatus: previousStatus || null,
    brands: unique([...(previous.detectedBrands || []), ...(previous.lead?.detectedBrands || [])]),
    articles: previous.lead?.articles || [],
    inn: previous.sender?.inn || null,
    kpp: previous.sender?.kpp || null,
    ogrn: previous.sender?.ogrn || null,
    cityPhone: previous.sender?.cityPhone || null,
    mobilePhone: previous.sender?.mobilePhone || null
  };
  const after = {
    pipelineStatus: nextStatus || null,
    brands: unique([...(next.detectedBrands || []), ...(next.lead?.detectedBrands || [])]),
    articles: next.lead?.articles || [],
    inn: next.sender?.inn || null,
    kpp: next.sender?.kpp || null,
    ogrn: next.sender?.ogrn || null,
    cityPhone: next.sender?.cityPhone || null,
    mobilePhone: next.sender?.mobilePhone || null
  };

  return {
    changed: JSON.stringify(before) !== JSON.stringify(after),
    before,
    after
  };
}

function parseStatuses(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function parsePayload(stdout) {
  const line = String(stdout || "")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("PROJECT3_JSON="));

  if (!line) {
    return null;
  }

  try {
    return JSON.parse(line.slice("PROJECT3_JSON=".length));
  } catch {
    return null;
  }
}

function runPythonProcess(scriptPath, workingDirectory, env, timeoutMs, days) {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [scriptPath, String(days)], {
      cwd: workingDirectory,
      env,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({ exitCode: -1, stdout, stderr: `${stderr}\nTimeout after ${timeoutMs}ms` });
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });

    child.on("close", (exitCode) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr });
      }
    });
  });
}

function tailLines(text, count) {
  return String(text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-count);
}

function normalizeBatchSize(value, fallback = 100) {
  const numeric = Number(value || fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(10, Math.min(500, Math.round(numeric)));
}

function createTelemetry() {
  return {
    batches: 0,
    yields: 0,
    processed: 0,
    totalAnalysisMs: 0,
    maxAnalysisMs: 0
  };
}

function recordTelemetrySample(telemetry, durationMs) {
  telemetry.processed += 1;
  telemetry.totalAnalysisMs += Number(durationMs || 0);
  telemetry.maxAnalysisMs = Math.max(telemetry.maxAnalysisMs, Number(durationMs || 0));
}

function finalizeTelemetry(telemetry, durationMs) {
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

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createMessageKey(item, fromEmail) {
  return createHash("sha1")
    .update([item.mailbox, fromEmail, item.subject, item.date].join("|"))
    .digest("hex");
}

function unique(items) {
  return [...new Set(items)];
}

/**
 * Resolve thread IDs for a list of messages based on RFC 2822 threading headers.
 * Uses Message-ID, In-Reply-To, References to build a thread graph.
 * Falls back to normalized subject + sender domain for messages without headers.
 */
function resolveThreadIds(messages) {
  // Map: Message-ID → threadId
  const messageIdToThread = new Map();
  // Map: threadId → Set of Message-IDs
  let nextThreadNum = 1;

  // Pass 1: Build thread graph from headers
  for (const msg of messages) {
    if (msg.threadId) continue; // already resolved

    const msgId = (msg.emailMessageId || "").trim();
    const inReplyTo = (msg.inReplyTo || "").trim();
    const refs = (msg.references || "").trim().split(/\s+/).filter(Boolean);

    // Find existing thread from In-Reply-To or References
    let threadId = null;
    if (inReplyTo && messageIdToThread.has(inReplyTo)) {
      threadId = messageIdToThread.get(inReplyTo);
    }
    if (!threadId) {
      for (const ref of refs) {
        if (messageIdToThread.has(ref)) {
          threadId = messageIdToThread.get(ref);
          break;
        }
      }
    }

    // Create new thread if not found
    if (!threadId) {
      threadId = `thread-${nextThreadNum++}`;
    }

    msg.threadId = threadId;
    if (msgId) messageIdToThread.set(msgId, threadId);
    // Also register all references under same thread
    for (const ref of refs) {
      if (!messageIdToThread.has(ref)) {
        messageIdToThread.set(ref, threadId);
      }
    }
  }

  // Pass 2: Fallback — group messages without headers by normalized subject + sender domain
  const subjectThreads = new Map();
  for (const msg of messages) {
    if (msg.emailMessageId || msg.inReplyTo || msg.references) continue;
    if (msg.threadId) continue;

    const normSubject = (msg.subject || "")
      .replace(/^(re|fwd?|ответ|переслано)\s*[:]\s*/gi, "")
      .replace(/^(re|fwd?|ответ|переслано)\s*[:]\s*/gi, "")
      .trim().toLowerCase();
    const senderDomain = ((msg.analysis?.sender?.email || msg.from || "").match(/@([^>]+)/) || [])[1] || "";
    const fallbackKey = `${normSubject}|${senderDomain.toLowerCase()}`;

    if (subjectThreads.has(fallbackKey)) {
      msg.threadId = subjectThreads.get(fallbackKey);
    } else {
      msg.threadId = `thread-${nextThreadNum++}`;
      subjectThreads.set(fallbackKey, msg.threadId);
    }
  }
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
