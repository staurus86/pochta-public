import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { toSlug } from "../utils/slug.js";
import { normalizeSchedule } from "../services/project-schedule.js";

const DEFAULT_PROJECTS = [
  {
    id: "mailroom-primary",
    type: "email-parser",
    name: "Primary Mailroom",
    mailbox: "inbox@example.com",
    description: "Первичный проект для разбора входящих писем и маршрутизации заявок в CRM.",
    brands: ["ABB", "Schneider Electric", "Legrand", "IEK"],
    managerPool: {
      defaultMop: "Ольга Демидова",
      defaultMoz: "Андрей Назаров",
      brandOwners: [
        { brand: "ABB", mop: "Иван Колесов", moz: "Мария Петрова" },
        { brand: "Schneider Electric", mop: "Елена Соколова", moz: "Роман Кравцов" }
      ]
    },
    knownCompanies: [
      {
        "id": "client-1001",
        "legalName": "ООО ПромСнаб",
        "inn": "7701234567",
        "website": "https://promsnab.ru",
        "domain": "promsnab.ru",
        "curatorMop": "Иван Колесов",
        "curatorMoz": "Мария Петрова",
        "contacts": [
          {
            "fullName": "Павел Ильин",
            "email": "p.ilin@promsnab.ru",
            "position": "Менеджер по закупкам"
          }
        ]
      }
    ],
    recentAnalyses: [],
    recentRuns: [],
    recentMessages: [],
    schedule: normalizeSchedule({
      enabled: false,
      time: "12:00",
      timezone: "Europe/Moscow",
      days: 1
    })
  },
  {
    id: "project-2-tender-parser",
    type: "tender-importer",
    name: "Project 2 Tender Parser",
    mailbox: "parsertender@siderus.online",
    description: "IMAP -> SAP SRM tender parsing -> Google Sheets import from folder 'project 2'.",
    brands: [],
    managerPool: {
      defaultMop: "Не назначен",
      defaultMoz: "Не назначен",
      brandOwners: []
    },
    runtime: {
      scriptPath: "project 2/tender_parser.py",
      workingDirectory: "project 2",
      seenFile: "project 2/seen_emails.json",
      logFile: "project 2/tender_parser.log",
      credentialsFile: "project 2/credentials.json"
    },
    knownCompanies: [],
    recentAnalyses: [],
    recentRuns: [],
    recentMessages: [],
    schedule: normalizeSchedule({
      enabled: true,
      time: "12:00",
      timezone: "Europe/Moscow",
      days: 1
    })
  },
  {
    id: "project-3-mailbox-file",
    type: "mailbox-file-parser",
    name: "Project 3 Mailbox File Parser",
    mailbox: "multi-mailbox@project3.local",
    description: "Читает mailbox-конфигурации из 1.txt, забирает письма и прогоняет тела через CRM-анализатор первого проекта.",
    brands: [],
    managerPool: {
      defaultMop: "Не назначен",
      defaultMoz: "Не назначен",
      brandOwners: []
    },
    runtime: {
      scriptPath: "project 3/mailbox_file_runner.py",
      workingDirectory: "project 3",
      sourceFile: "1.txt"
    },
    knownCompanies: [],
    recentAnalyses: [],
    recentRuns: [],
    recentMessages: [],
    schedule: normalizeSchedule({
      enabled: false,
      time: "12:00",
      timezone: "Europe/Moscow",
      days: 1
    })
  },
  {
    id: "project-4-klvrt-mail",
    type: "mailbox-file-parser",
    name: "Project 4 — Klvrt Mail",
    mailbox: "robot-mail-siderus@klvrt.ru",
    description: "Забор писем из ящика robot-mail-siderus@klvrt.ru (mail.klvrt.ru), разбор и классификация.",
    brands: [],
    managerPool: {
      defaultMop: "Не назначен",
      defaultMoz: "Не назначен",
      brandOwners: []
    },
    runtime: {
      scriptPath: "project 3/mailbox_file_runner.py",
      workingDirectory: "project 3",
      sourceFile: "2.txt",
      imapHost: "mail.klvrt.ru",
      imapPort: "993"
    },
    knownCompanies: [],
    recentAnalyses: [],
    recentRuns: [],
    recentMessages: [],
    schedule: normalizeSchedule({
      enabled: false,
      time: "12:00",
      timezone: "Europe/Moscow",
      days: 1
    })
  }
];

export class ProjectsStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, "projects.json");
    this.projects = null;
  }

  async ensureLoaded() {
    if (this.projects) {
      return;
    }

    await mkdir(this.dataDir, { recursive: true });

    try {
      const fileContents = await readFile(this.filePath, "utf-8");
      this.projects = JSON.parse(fileContents).map((project) => ({
        recentAnalyses: [],
        recentRuns: [],
        recentMessages: [],
        webhookDeliveries: [],
        schedule: normalizeSchedule(),
        ...project,
        recentAnalyses: project.recentAnalyses || [],
        recentRuns: project.recentRuns || [],
        recentMessages: (project.recentMessages || []).map((message) => ({
          ...message,
          integrationExport: message.integrationExport || null,
          integrationExports: normalizeIntegrationExports(message),
          integrationIdempotency: normalizeIntegrationIdempotency(message)
        })),
        webhookDeliveries: project.webhookDeliveries || [],
        schedule: normalizeSchedule(project.schedule)
      }));

      // Migration: add any missing default projects
      const existingIds = new Set(this.projects.map((p) => p.id));
      let added = false;
      for (const dp of DEFAULT_PROJECTS) {
        if (!existingIds.has(dp.id)) {
          this.projects.push(dp);
          added = true;
        }
      }
      if (added) {
        await this.persist();
      }
    } catch {
      this.projects = DEFAULT_PROJECTS;
      await this.persist();
    }
  }

  async persist() {
    await writeFile(this.filePath, JSON.stringify(this.projects, null, 2), "utf-8");
  }

  async listProjects() {
    await this.ensureLoaded();
    return this.projects;
  }

  async getProject(id) {
    await this.ensureLoaded();
    return this.projects.find((project) => project.id === id) || null;
  }

  async createProject(payload) {
    await this.ensureLoaded();

    const baseId = toSlug(payload.name || payload.mailbox || "project");
    const nextId = this.generateProjectId(baseId);
    const project = {
      id: nextId,
      type: payload.type?.trim() || "email-parser",
      name: payload.name?.trim() || nextId,
      mailbox: payload.mailbox?.trim() || "",
      description: payload.description?.trim() || "",
      brands: normalizeStringArray(payload.brands),
      managerPool: {
        defaultMop: payload.defaultMop?.trim() || "Не назначен",
        defaultMoz: payload.defaultMoz?.trim() || "Не назначен",
        brandOwners: []
      },
      knownCompanies: [],
      recentAnalyses: [],
      recentRuns: [],
      recentMessages: [],
      webhookDeliveries: [],
      schedule: normalizeSchedule(payload.schedule)
    };

    this.projects.unshift(project);
    await this.persist();
    return project;
  }

  async appendAnalysis(projectId, analysis) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    const summary = {
      id: analysis.analysisId,
      createdAt: analysis.createdAt,
      senderEmail: analysis.sender.email,
      category: analysis.classification.label,
      company: analysis.crm.company?.legalName || analysis.sender.companyName || "Не определено",
      actions: analysis.crm.actions
    };

    project.recentAnalyses = [summary, ...(project.recentAnalyses || [])].slice(0, 10);
    await this.persist();
    return summary;
  }

  async appendRun(projectId, runSummary) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    const summary = {
      id: runSummary.id,
      createdAt: runSummary.createdAt,
      status: runSummary.status,
      days: runSummary.days,
      maxEmails: runSummary.maxEmails,
      processed: runSummary.processed,
      added: runSummary.added,
      skipped: runSummary.skipped,
      failed: runSummary.failed,
      durationMs: runSummary.durationMs,
      accountCount: runSummary.accountCount,
      fetchedEmailCount: runSummary.fetchedEmailCount,
      totalMessages: runSummary.totalMessages,
      spamCount: runSummary.spamCount,
      readyForCrmCount: runSummary.readyForCrmCount,
      clarificationCount: runSummary.clarificationCount,
      trigger: runSummary.trigger || "manual"
    };

    project.recentRuns = [summary, ...(project.recentRuns || [])].slice(0, 10);
    await this.persist();
    return summary;
  }

  async updateMessageStatus(projectId, messageKey, newStatus) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    const msg = (project.recentMessages || []).find(
      (m) => (m.messageKey || m.id) === messageKey
    );
    if (!msg) {
      return null;
    }

    const oldStatus = msg.pipelineStatus;
    msg.pipelineStatus = newStatus;
    if (!msg.auditLog) msg.auditLog = [];
    msg.auditLog.push({
      action: "status_change",
      from: oldStatus,
      to: newStatus,
      at: new Date().toISOString()
    });
    await this.persist();
    return { messageKey, pipelineStatus: newStatus, previousStatus: oldStatus };
  }

  async acknowledgeMessageExport(projectId, messageKey, payload = {}) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    const message = (project.recentMessages || []).find((item) => (item.messageKey || item.id) === messageKey);
    if (!message) {
      return null;
    }

    message.integrationIdempotency = normalizeIntegrationIdempotency(message);
    const acknowledgedAt = new Date().toISOString();
    const consumerId = payload.consumer ? String(payload.consumer).trim() : "legacy-default";
    const idempotencyKey = payload.idempotencyKey ? String(payload.idempotencyKey).trim() : null;
    const ackBucket = message.integrationIdempotency.ack[consumerId] || {};
    if (idempotencyKey && ackBucket[idempotencyKey]) {
      return message;
    }

    const exportState = {
      acknowledgedAt,
      consumer: consumerId,
      externalId: payload.externalId ? String(payload.externalId).trim() : null,
      note: payload.note ? String(payload.note).trim() : null
    };
    message.integrationExports = normalizeIntegrationExports(message);
    message.integrationExports[consumerId] = exportState;
    message.integrationExport = exportState;
    if (idempotencyKey) {
      message.integrationIdempotency.ack[consumerId] = pushIdempotencyRecord(ackBucket, idempotencyKey, {
        at: acknowledgedAt,
        type: "integration_ack"
      });
    }

    if (!message.auditLog) message.auditLog = [];
    message.auditLog.push({
      action: "integration_ack",
      at: acknowledgedAt,
      consumer: exportState.consumer,
      externalId: exportState.externalId,
      note: exportState.note
    });

    await this.persist();
    return message;
  }

  async deleteMessage(projectId, messageKey) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    const before = (project.recentMessages || []).length;
    project.recentMessages = (project.recentMessages || []).filter(
      (msg) => (msg.messageKey || msg.id) !== messageKey
    );
    const deleted = before - project.recentMessages.length;
    if (deleted > 0) {
      await this.persist();
    }
    return { deleted, remaining: project.recentMessages.length };
  }

  async deleteAllMessages(projectId) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    const deleted = (project.recentMessages || []).length;
    project.recentMessages = [];
    await this.persist();
    return { deleted, remaining: 0 };
  }

  async replaceRecentMessages(projectId, messages) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    const existingByKey = new Map((project.recentMessages || []).map((item) => [
      item.messageKey || item.id,
      {
        integrationExport: item.integrationExport || null,
        integrationExports: normalizeIntegrationExports(item)
      }
    ]));

    project.recentMessages = (messages || []).slice(0, 5000).map((item) => {
      const existing = existingByKey.get(item.messageKey || item.id);
      if (!existing) {
        return {
          ...item,
          integrationExport: item.integrationExport || null,
          integrationExports: normalizeIntegrationExports(item),
          integrationIdempotency: normalizeIntegrationIdempotency(item)
        };
      }

      return {
        ...item,
        integrationExport: item.integrationExport || existing.integrationExport || null,
        integrationExports: {
          ...existing.integrationExports,
          ...normalizeIntegrationExports(item)
        },
        integrationIdempotency: {
          ...existing.integrationIdempotency,
          ...normalizeIntegrationIdempotency(item)
        }
      };
    });
    await this.persist();
    return project.recentMessages;
  }

  async enqueueWebhookDeliveries(projectId, deliveries) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return { added: 0, total: 0 };
    }

    const existingKeys = new Set((project.webhookDeliveries || []).map((item) => item.key));
    const newDeliveries = deliveries.filter((item) => !existingKeys.has(item.key));
    project.webhookDeliveries = [...newDeliveries, ...(project.webhookDeliveries || [])].slice(0, 5000);
    if (newDeliveries.length > 0) {
      await this.persist();
    }

    return { added: newDeliveries.length, total: project.webhookDeliveries.length };
  }

  async listWebhookDeliveries(projectId, { status, limit = 100 } = {}) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    const statuses = Array.isArray(status)
      ? status.map((item) => String(item).trim()).filter(Boolean)
      : String(status || "").split(",").map((item) => item.trim()).filter(Boolean);

    return (project.webhookDeliveries || [])
      .filter((item) => statuses.length === 0 || statuses.includes(item.status))
      .slice(0, limit);
  }

  async getDueWebhookDeliveries(nowIso, limit = 20) {
    await this.ensureLoaded();
    const dueItems = [];

    for (const project of this.projects) {
      for (const delivery of project.webhookDeliveries || []) {
        if (delivery.status !== "pending") {
          continue;
        }

        if (delivery.nextAttemptAt && delivery.nextAttemptAt > nowIso) {
          continue;
        }

        dueItems.push({ projectId: project.id, delivery });
        if (dueItems.length >= limit) {
          return dueItems;
        }
      }
    }

    return dueItems;
  }

  async updateWebhookDelivery(projectId, deliveryId, patch) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    const delivery = (project.webhookDeliveries || []).find((item) => item.id === deliveryId);
    if (!delivery) {
      return null;
    }

    Object.assign(delivery, patch);
    await this.persist();
    return delivery;
  }

  async requeueWebhookDelivery(projectId, deliveryId, payload = {}) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    const delivery = (project.webhookDeliveries || []).find((item) => item.id === deliveryId);
    if (!delivery) {
      return null;
    }

    delivery.idempotency = normalizeDeliveryIdempotency(delivery);
    const idempotencyKey = payload.idempotencyKey ? String(payload.idempotencyKey).trim() : null;
    if (idempotencyKey && delivery.idempotency.requeue[idempotencyKey]) {
      return delivery;
    }

    const now = new Date().toISOString();
    delivery.status = "pending";
    delivery.nextAttemptAt = now;
    delivery.updatedAt = now;
    delivery.lastError = null;
    delivery.responseStatus = null;

    if (payload.reason) {
      delivery.lastManualAction = {
        action: "requeue",
        reason: String(payload.reason).trim(),
        at: now
      };
    }
    if (idempotencyKey) {
      delivery.idempotency.requeue = pushIdempotencyRecord(delivery.idempotency.requeue, idempotencyKey, {
        at: now,
        type: "delivery_requeue"
      });
    }

    await this.persist();
    return delivery;
  }

  async updateSchedule(projectId, scheduleInput) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    project.schedule = normalizeSchedule({
      ...(project.schedule || {}),
      ...(scheduleInput || {})
    });

    await this.persist();
    return project.schedule;
  }

  async markScheduleTriggered(projectId, slot, triggeredAt) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    project.schedule = normalizeSchedule({
      ...(project.schedule || {}),
      lastTriggeredSlot: slot,
      lastTriggeredAt: triggeredAt
    });

    await this.persist();
    return project.schedule;
  }

  generateProjectId(baseId) {
    const existing = new Set(this.projects.map((project) => project.id));
    let candidate = baseId || "project";
    let suffix = 1;

    while (existing.has(candidate)) {
      suffix += 1;
      candidate = `${baseId}-${suffix}`;
    }

    return candidate;
  }
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeIntegrationExports(message) {
  const exportsMap = message?.integrationExports && typeof message.integrationExports === "object"
    ? { ...message.integrationExports }
    : {};

  if (message?.integrationExport?.consumer) {
    exportsMap[message.integrationExport.consumer] = {
      ...message.integrationExport
    };
  }

  return exportsMap;
}

function normalizeIntegrationIdempotency(message) {
  const state = message?.integrationIdempotency && typeof message.integrationIdempotency === "object"
    ? message.integrationIdempotency
    : {};

  return {
    ack: state.ack && typeof state.ack === "object" ? { ...state.ack } : {}
  };
}

function normalizeDeliveryIdempotency(delivery) {
  const state = delivery?.idempotency && typeof delivery.idempotency === "object"
    ? delivery.idempotency
    : {};

  return {
    requeue: state.requeue && typeof state.requeue === "object" ? { ...state.requeue } : {}
  };
}

function pushIdempotencyRecord(bucket, key, record) {
  const entries = Object.entries({
    ...(bucket || {}),
    [key]: record
  }).sort((a, b) => String(b[1]?.at || "").localeCompare(String(a[1]?.at || "")));

  return Object.fromEntries(entries.slice(0, 20));
}
