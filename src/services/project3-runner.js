import { createHash, randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
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

  const result = await runPythonProcess(scriptPath, workingDirectory, {
    ...process.env,
    PROJECT3_SOURCE_FILE: sourceFile,
    PROJECT3_DAYS: String(days),
    PROJECT3_MAX_EMAILS: String(maxEmails),
    PROJECT3_IMAP_HOST: process.env.PROJECT3_IMAP_HOST || "mail.hosting.reg.ru",
    PROJECT3_IMAP_PORT: process.env.PROJECT3_IMAP_PORT || "993"
  }, Number(options.timeoutMs || 300000), days);

  const payload = parsePayload(result.stdout) || { emails: [], accountCount: 0, fetchedEmailCount: 0, errorCount: 0 };
  const brands = unique((project.brands || []).concat(payload.emails.map((item) => item.brand).filter(Boolean)));
  const analysisProject = {
    mailbox: project.mailbox,
    brands,
    managerPool: project.managerPool || { defaultMop: "Не назначен", defaultMoz: "Не назначен", brandOwners: [] },
    knownCompanies: project.knownCompanies || []
  };

  const analyzedEmails = payload.emails
    .filter((item) => item.body || item.error)
    .map((item) => {
      const { fromName, fromEmail } = splitFromHeader(item.from);
      const analysis = analyzeEmail(analysisProject, {
        fromName,
        fromEmail,
        subject: item.subject,
        body: item.body || item.error,
        attachments: item.attachments || []
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

      const messageKey = createMessageKey(item, fromEmail);

      return {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        messageKey,
        mailbox: item.mailbox,
        brand: item.brand,
        siteUrl: item.siteUrl,
        subject: item.subject,
        from: item.from,
        bodyPreview: String(item.body || item.error || "").slice(0, 2000),
        attachments: item.attachments || [],
        error: item.error || null,
        pipelineStatus,
        analysis
      };
    });

  const nonSpamMessages = analyzedEmails.filter((item) => item.pipelineStatus !== "ignored_spam" && item.pipelineStatus !== "fetch_error");
  detectionKb.ingestAnalyzedMessages(project.id, nonSpamMessages);

  return {
    id: randomUUID(),
    createdAt: new Date(startedAt).toISOString(),
    status: result.exitCode === 0 ? "ok" : "error",
    days,
    maxEmails,
    processed: nonSpamMessages.length,
    added: 0,
    skipped: analyzedEmails.filter((item) => item.pipelineStatus === "ignored_spam").length,
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
    recentMessages: analyzedEmails.slice(0, 100)
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

function createMessageKey(item, fromEmail) {
  return createHash("sha1")
    .update([item.mailbox, fromEmail, item.subject, item.date].join("|"))
    .digest("hex");
}

function unique(items) {
  return [...new Set(items)];
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
