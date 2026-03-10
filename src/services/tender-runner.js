import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export async function getTenderRuntime(project, rootDir) {
  const runtime = project.runtime || {};
  const workingDirectory = path.resolve(rootDir, runtime.workingDirectory || "project 2");
  const scriptPath = path.resolve(rootDir, runtime.scriptPath || "project 2/tender_parser.py");
  const seenFile = path.resolve(rootDir, runtime.seenFile || "project 2/seen_emails.json");
  const logFile = path.resolve(rootDir, runtime.logFile || "project 2/tender_parser.log");
  const credentialsFile = path.resolve(rootDir, runtime.credentialsFile || "project 2/credentials.json");
  await ensureSeededFiles({ seenFile, logFile });

  const [scriptExists, credentialsExists] = await Promise.all([
    exists(scriptPath),
    exists(credentialsFile)
  ]);

  const [seenStats, logStats, logTail] = await Promise.all([
    readSeenStats(seenFile),
    readFileStats(logFile),
    readLogTail(logFile, 15)
  ]);

  return {
    projectId: project.id,
    kind: "tender-importer",
    workingDirectory,
    scriptPath,
    scriptExists,
    credentialsExists,
    seenCount: seenStats.count,
    lastSeenAt: seenStats.lastSeenAt,
    logSizeBytes: logStats.size,
    logUpdatedAt: logStats.updatedAt,
    recentLogLines: logTail
  };
}

export async function runTenderImporter(project, rootDir, options = {}) {
  const runtime = project.runtime || {};
  const workingDirectory = path.resolve(rootDir, runtime.workingDirectory || "project 2");
  const scriptPath = path.resolve(rootDir, runtime.scriptPath || "project 2/tender_parser.py");
  const runtimeDir = path.join(workingDirectory, ".runtime");

  await mkdir(runtimeDir, { recursive: true });

  const days = Number(options.days || 1);
  const shouldReset = Boolean(options.reset);
  const env = await buildRuntimeEnv(project, rootDir, runtimeDir);
  const args = [scriptPath];

  if (shouldReset) {
    args.push("--reset");
  } else {
    args.push(String(Math.max(1, days)));
  }

  const startedAt = Date.now();
  const result = await runPythonProcess(args, workingDirectory, env, Number(options.timeoutMs || 240000));
  const summary = parseSummary(result.stdout) || {};

  return {
    id: randomUUID(),
    createdAt: new Date(startedAt).toISOString(),
    status: result.exitCode === 0 ? summary.status || "ok" : "error",
    days,
    processed: Number(summary.processed || 0),
    added: Number(summary.added || 0),
    skipped: Number(summary.skipped || 0),
    failed: Number(summary.failed || 0),
    durationMs: Date.now() - startedAt,
    reset: shouldReset,
    exitCode: result.exitCode,
    stdout: truncateLines(result.stdout, 30),
    stderr: truncateLines(result.stderr, 30),
    message: summary.message || (result.exitCode === 0 ? "Выполнение завершено" : "Процесс завершился с ошибкой")
  };
}

async function buildRuntimeEnv(project, rootDir, runtimeDir) {
  const runtime = project.runtime || {};
  const credentialsFile = path.resolve(rootDir, runtime.credentialsFile || "project 2/credentials.json");
  const seenFile = path.resolve(rootDir, runtime.seenFile || "project 2/seen_emails.json");
  const logFile = path.resolve(rootDir, runtime.logFile || "project 2/tender_parser.log");
  const env = { ...process.env };

  await ensureSeededFiles({ seenFile, logFile });

  env.PROJECT2_RUNTIME_DIR = runtimeDir;
  env.PROJECT2_GOOGLE_CREDENTIALS = credentialsFile;
  env.PROJECT2_SEEN_FILE = seenFile;
  env.PROJECT2_LOG_FILE = logFile;

  setEnvIfPresent(env, "PROJECT2_GMAIL_USER");
  setEnvIfPresent(env, "PROJECT2_GMAIL_PASSWORD");
  setEnvIfPresent(env, "PROJECT2_IMAP_HOST");
  setEnvIfPresent(env, "PROJECT2_IMAP_PORT");
  setEnvIfPresent(env, "PROJECT2_GOOGLE_SHEETS_ID");

  const inlineCredentials = process.env.PROJECT2_GOOGLE_CREDENTIALS_JSON;
  const inlineCredentialsB64 = process.env.PROJECT2_GOOGLE_CREDENTIALS_B64;
  if (inlineCredentials) {
    const inlinePath = path.join(runtimeDir, "credentials.runtime.json");
    await writeFile(inlinePath, inlineCredentials, "utf-8");
    env.PROJECT2_GOOGLE_CREDENTIALS = inlinePath;
  } else if (inlineCredentialsB64) {
    const inlinePath = path.join(runtimeDir, "credentials.runtime.json");
    const decoded = Buffer.from(inlineCredentialsB64, "base64").toString("utf-8");
    await writeFile(inlinePath, decoded, "utf-8");
    env.PROJECT2_GOOGLE_CREDENTIALS = inlinePath;
  }

  return env;
}

async function ensureSeededFiles({ seenFile, logFile }) {
  await Promise.all([
    seedFileIfMissing(seenFile, process.env.PROJECT2_SEEN_B64, "{}"),
    seedFileIfMissing(logFile, process.env.PROJECT2_LOG_B64, "")
  ]);
}

async function seedFileIfMissing(filePath, base64Value, fallbackContents) {
  if (await exists(filePath)) {
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });

  if (base64Value) {
    const decoded = Buffer.from(base64Value, "base64").toString("utf-8");
    await writeFile(filePath, decoded, "utf-8");
    return;
  }

  await writeFile(filePath, fallbackContents, "utf-8");
}

function setEnvIfPresent(target, name) {
  if (process.env[name]) {
    target[name] = process.env[name];
  }
}

function runPythonProcess(args, workingDirectory, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("python", args, {
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

function parseSummary(stdout) {
  const line = String(stdout || "")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("SUMMARY_JSON="));

  if (!line) {
    return null;
  }

  try {
    return JSON.parse(line.slice("SUMMARY_JSON=".length));
  } catch {
    return null;
  }
}

async function readSeenStats(filePath) {
  try {
    const data = JSON.parse(await readFile(filePath, "utf-8"));
    const timestamps = Object.values(data)
      .map((item) => item?.timestamp)
      .filter(Boolean)
      .sort();

    return {
      count: Object.keys(data).length,
      lastSeenAt: timestamps.at(-1) || null
    };
  } catch {
    return {
      count: 0,
      lastSeenAt: null
    };
  }
}

async function readFileStats(filePath) {
  try {
    const file = await stat(filePath);
    return {
      size: file.size,
      updatedAt: file.mtime.toISOString()
    };
  } catch {
    return {
      size: 0,
      updatedAt: null
    };
  }
}

async function readLogTail(filePath, linesCount) {
  try {
    const contents = await readFile(filePath, "utf-8");
    return truncateLines(contents, linesCount);
  } catch {
    return [];
  }
}

function truncateLines(text, linesCount) {
  return String(text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-linesCount);
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
