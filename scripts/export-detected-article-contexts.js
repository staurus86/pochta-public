import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = process.env.POCHTA_BASE_URL || "https://pochta-production.up.railway.app";
const CONTEXT_RADIUS = Number(process.env.ARTICLE_CONTEXT_RADIUS || 100);
const MAX_MESSAGES = Number(process.env.ARTICLE_CONTEXT_MAX_MESSAGES || 0);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}`);
  }

  return response.json();
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchCorpus(message) {
  const analysis = message.analysis || {};
  const lead = analysis.lead || {};
  const attachmentFiles = analysis.attachmentAnalysis?.files || [];
  const attachmentPreviews = attachmentFiles
    .map((file) => [file.filename, file.preview].filter(Boolean).join("\n"))
    .filter(Boolean);

  return [
    message.subject,
    message.bodyPreview,
    lead.freeText,
    ...(lead.lineItems || []).map((item) => [item.article, item.descriptionRu].filter(Boolean).join(" ")),
    ...(lead.productNames || []).map((item) => [item.article, item.name].filter(Boolean).join(" ")),
    ...attachmentPreviews
  ]
    .filter(Boolean)
    .join("\n\n");
}

function extractContext(text, article, radius = CONTEXT_RADIUS) {
  const normalizedText = String(text || "");
  if (!normalizedText.trim()) {
    return "";
  }

  const directIndex = normalizedText.toUpperCase().indexOf(String(article || "").toUpperCase());
  if (directIndex >= 0) {
    const start = Math.max(0, directIndex - radius);
    const end = Math.min(normalizedText.length, directIndex + String(article).length + radius);
    return normalizedText.slice(start, end).replace(/\s+/g, " ").trim();
  }

  const fallbackPattern = new RegExp(`.{0,${radius}}${escapeRegExp(article)}.{0,${radius}}`, "i");
  const match = normalizedText.match(fallbackPattern);
  if (match) {
    return match[0].replace(/\s+/g, " ").trim();
  }

  return normalizedText.slice(0, Math.min(normalizedText.length, radius * 2 + String(article || "").length + 32))
    .replace(/\s+/g, " ")
    .trim();
}

function formatEntry(project, message, article, context) {
  return [
    `PROJECT: ${project.id} | ${project.name}`,
    `MESSAGE: ${message.messageKey || message.id}`,
    `DATE: ${message.createdAt || ""}`,
    `FROM: ${normalizeWhitespace(message.from || message.analysis?.sender?.email || "")}`,
    `SUBJECT: ${normalizeWhitespace(message.subject || "")}`,
    `ARTICLE: ${article}`,
    `CONTEXT: ${context || "[context not found]"}`,
    ""
  ].join("\n");
}

async function main() {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const outputPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.resolve(process.cwd(), "docs", `detected-articles-contexts-${timestamp}.txt`);
  const baseUrl = String(process.argv[3] || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const maxMessages = Number(process.argv[4] || MAX_MESSAGES || 0);

  const projectsPayload = await fetchJson(`${baseUrl}/api/projects`);
  const projects = Array.isArray(projectsPayload?.projects) ? projectsPayload.projects : [];
  const targetProjects = projects.filter((project) => project.type === "mailbox-file-parser");

  const lines = [];
  let exported = 0;
  let processedMessages = 0;

  for (const project of targetProjects) {
    const messagesPayload = await fetchJson(`${baseUrl}/api/projects/${encodeURIComponent(project.id)}/messages`);
    const messages = Array.isArray(messagesPayload?.messages) ? messagesPayload.messages : [];

    for (const message of messages) {
      if (maxMessages > 0 && processedMessages >= maxMessages) {
        break;
      }
      processedMessages += 1;

      const articles = [...new Set((message.analysis?.lead?.articles || []).map((item) => String(item || "").trim()).filter(Boolean))];
      if (articles.length === 0) continue;

      const corpus = buildSearchCorpus(message);
      for (const article of articles) {
        const context = extractContext(corpus, article, CONTEXT_RADIUS);
        lines.push(formatEntry(project, message, article, context));
        exported += 1;
      }
    }

    if (maxMessages > 0 && processedMessages >= maxMessages) {
      break;
    }
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, lines.join("\n"), "utf8");

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    outputPath,
    exported,
    contextRadius: CONTEXT_RADIUS,
    processedMessages,
    maxMessages
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message
  }, null, 2));
  process.exit(1);
});
