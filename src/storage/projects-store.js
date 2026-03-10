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
        schedule: normalizeSchedule(),
        ...project,
        recentAnalyses: project.recentAnalyses || [],
        recentRuns: project.recentRuns || [],
        recentMessages: project.recentMessages || [],
        schedule: normalizeSchedule(project.schedule)
      }));
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
      processed: runSummary.processed,
      added: runSummary.added,
      skipped: runSummary.skipped,
      failed: runSummary.failed,
      durationMs: runSummary.durationMs,
      trigger: runSummary.trigger || "manual"
    };

    project.recentRuns = [summary, ...(project.recentRuns || [])].slice(0, 10);
    await this.persist();
    return summary;
  }

  async replaceRecentMessages(projectId, messages) {
    await this.ensureLoaded();
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    project.recentMessages = (messages || []).slice(0, 100);
    await this.persist();
    return project.recentMessages;
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
