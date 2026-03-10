const projectForm = document.querySelector("#project-form");
const analysisForm = document.querySelector("#analysis-form");
const tenderRunForm = document.querySelector("#tender-run-form");
const scheduleForm = document.querySelector("#schedule-form");
const projectsList = document.querySelector("#projects-list");
const projectsCount = document.querySelector("#projects-count");
const resultBlock = document.querySelector("#analysis-result");
const runtimeResult = document.querySelector("#runtime-result");
const selectedProjectLabel = document.querySelector("#selected-project-label");
const workspaceTitle = document.querySelector("#workspace-title");
const emailWorkspace = document.querySelector("#email-parser-workspace");
const tenderWorkspace = document.querySelector("#tender-importer-workspace");
const refreshRuntimeButton = document.querySelector("#refresh-runtime");
const runnerInboxPanel = document.querySelector("#runner-inbox-panel");
const runnerMessagesList = document.querySelector("#runner-messages-list");
const runnerMessageDetail = document.querySelector("#runner-message-detail");

let projects = [];
let selectedProjectId = null;
let runnerMessages = [];
let selectedRunnerMessageId = null;

await refreshProjects();

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(projectForm);
  const payload = Object.fromEntries(formData.entries());

  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    resultBlock.textContent = "Не удалось создать проект.";
    return;
  }

  projectForm.reset();
  await refreshProjects();
});

analysisForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedProjectId) {
    resultBlock.textContent = "Сначала выберите проект.";
    return;
  }

  const selectedProject = getSelectedProject();
  if (selectedProject?.type !== "email-parser") {
    resultBlock.textContent = "Этот проект не поддерживает разбор писем в CRM-формат.";
    return;
  }

  const formData = new FormData(analysisForm);
  const payload = Object.fromEntries(formData.entries());
  const response = await fetch(`/api/projects/${selectedProjectId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  resultBlock.textContent = JSON.stringify(data.analysis || data, null, 2);
  await refreshProjects();
});

scheduleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selectedProject = getSelectedProject();
  if (!selectedProject || !isRunnerProject(selectedProject)) {
    runtimeResult.textContent = "Расписание доступно только для runner-проектов.";
    return;
  }

  const formData = new FormData(scheduleForm);
  const payload = {
    enabled: formData.get("enabled") === "on",
    time: formData.get("time"),
    timezone: formData.get("timezone"),
    days: Number(formData.get("days") || 1)
  };

  const response = await fetch(`/api/projects/${selectedProjectId}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  runtimeResult.textContent = JSON.stringify(data.schedule || data, null, 2);
  await refreshProjects();
});

tenderRunForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedProjectId) {
    runtimeResult.textContent = "Сначала выберите проект.";
    return;
  }

  const selectedProject = getSelectedProject();
  if (!selectedProject || !isRunnerProject(selectedProject)) {
    runtimeResult.textContent = "Этот проект не поддерживает Python-runner.";
    return;
  }

  const formData = new FormData(tenderRunForm);
  const payload = {
    days: Number(formData.get("days") || 1),
    reset: formData.get("reset") === "on"
  };

  runtimeResult.textContent = "Запуск модуля...";

  const response = await fetch(`/api/projects/${selectedProjectId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  runtimeResult.textContent = JSON.stringify(data.run || data, null, 2);
  await refreshProjects();
  await refreshRunnerMessages();
});

refreshRuntimeButton.addEventListener("click", async () => {
  await refreshRuntime();
});

async function refreshProjects() {
  const response = await fetch("/api/projects");
  const data = await response.json();
  projects = data.projects || [];
  projectsCount.textContent = String(projects.length);

  if (!selectedProjectId && projects[0]) {
    selectedProjectId = projects[0].id;
  }

  if (selectedProjectId && !projects.some((project) => project.id === selectedProjectId)) {
    selectedProjectId = projects[0]?.id || null;
  }

  renderProjects();
  await refreshRuntime();
  await refreshRunnerMessages();
}

function renderProjects() {
  projectsList.innerHTML = "";

  if (projects.length === 0) {
    projectsList.textContent = "Проектов пока нет.";
    return;
  }

  for (const project of projects) {
    const scheduleLabel = project.schedule?.enabled
      ? `Авто: ${project.schedule.time} ${project.schedule.timezone}`
      : "Авто: выключено";

    const card = document.createElement("button");
    card.type = "button";
    card.className = `project-card${project.id === selectedProjectId ? " active" : ""}`;
    card.innerHTML = `
      <strong>${escapeHtml(project.name)}</strong>
      <span>${escapeHtml(project.mailbox)}</span>
      <span>Тип: ${escapeHtml(project.type || "email-parser")}</span>
      <span>${escapeHtml(scheduleLabel)}</span>
    `;
    card.addEventListener("click", async () => {
      selectedProjectId = project.id;
      renderProjects();
      await refreshRuntime();
    });
    projectsList.appendChild(card);
  }

  const selectedProject = getSelectedProject();
  selectedProjectLabel.textContent = selectedProject
    ? `${selectedProject.name} · ${selectedProject.mailbox}`
    : "Проект не выбран";
  renderWorkspace(selectedProject);
  syncScheduleForm(selectedProject);
}

async function refreshRuntime() {
  const selectedProject = getSelectedProject();
  if (!selectedProject || !isRunnerProject(selectedProject)) {
    runtimeResult.textContent = "Выберите runner-проект, чтобы увидеть runtime status.";
    return;
  }

  const response = await fetch(`/api/projects/${selectedProjectId}/runtime`);
  const data = await response.json();
  runtimeResult.textContent = JSON.stringify(data.runtime || data, null, 2);
}

async function refreshRunnerMessages() {
  const selectedProject = getSelectedProject();
  if (selectedProject?.type !== "mailbox-file-parser") {
    runnerMessages = [];
    selectedRunnerMessageId = null;
    renderRunnerInbox(selectedProject);
    return;
  }

  const response = await fetch(`/api/projects/${selectedProjectId}/messages`);
  const data = await response.json();
  runnerMessages = (data.messages || [])
    .filter((message) => !["ignored_spam", "fetch_error"].includes(message.pipelineStatus))
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

  if (!runnerMessages.some((message) => getMessageId(message) === selectedRunnerMessageId)) {
    selectedRunnerMessageId = runnerMessages[0] ? getMessageId(runnerMessages[0]) : null;
  }

  renderRunnerInbox(selectedProject);
}

function renderWorkspace(project) {
  const isRunner = isRunnerProject(project);
  emailWorkspace.classList.toggle("hidden", isRunner);
  tenderWorkspace.classList.toggle("hidden", !isRunner);
  runnerInboxPanel.classList.toggle("hidden", project?.type !== "mailbox-file-parser");
  workspaceTitle.textContent = isRunner ? `Запуск ${project?.name || "runner"}` : "Тест входящего письма";
}

function syncScheduleForm(project) {
  const schedule = project?.schedule || {};
  scheduleForm.elements.enabled.checked = Boolean(schedule.enabled);
  scheduleForm.elements.time.value = schedule.time || "12:00";
  scheduleForm.elements.timezone.value = schedule.timezone || "Europe/Moscow";
  scheduleForm.elements.days.value = String(schedule.days || 1);
}

function getSelectedProject() {
  return projects.find((project) => project.id === selectedProjectId) || null;
}

function isRunnerProject(project) {
  return ["tender-importer", "mailbox-file-parser"].includes(project?.type);
}

function renderRunnerInbox(project) {
  if (project?.type !== "mailbox-file-parser") {
    runnerMessagesList.innerHTML = "";
    runnerMessageDetail.textContent = "Inbox доступен только для проекта чтения почты из 1.txt.";
    return;
  }

  runnerMessagesList.innerHTML = "";
  if (runnerMessages.length === 0) {
    runnerMessagesList.textContent = "После запуска здесь появятся письма, подходящие под CRM-разбор.";
    runnerMessageDetail.textContent = "Запустите project 3. Спам и ошибки чтения в inbox не показываются.";
    return;
  }

  for (const message of runnerMessages) {
    const card = document.createElement("button");
    const messageId = getMessageId(message);
    card.type = "button";
    card.className = `message-card${messageId === selectedRunnerMessageId ? " active" : ""}`;
    card.innerHTML = `
      <strong>${escapeHtml(message.subject || "Без темы")}</strong>
      <span>${escapeHtml(message.from || "Неизвестный отправитель")}</span>
      <span>${escapeHtml(message.mailbox || "")}</span>
      <small>${escapeHtml(formatCardMeta(message))}</small>
      <span class="status-badge ${statusClassName(message.pipelineStatus)}">${escapeHtml(statusLabel(message.pipelineStatus))}</span>
    `;
    card.addEventListener("click", () => {
      selectedRunnerMessageId = messageId;
      renderRunnerInbox(project);
    });
    runnerMessagesList.appendChild(card);
  }

  const selectedMessage = runnerMessages.find((message) => getMessageId(message) === selectedRunnerMessageId) || runnerMessages[0];
  runnerMessageDetail.textContent = formatMessageDetail(selectedMessage);
}

function formatMessageDetail(message) {
  if (!message) {
    return "Письмо не выбрано.";
  }

  const analysis = message.analysis || {};
  const sender = analysis.sender || {};
  const lead = analysis.lead || {};
  const crm = analysis.crm || {};
  const intakeFlow = analysis.intakeFlow || {};
  const matchedRules = analysis.classification?.signals?.matchedRules || [];

  return [
    `Статус: ${statusLabel(message.pipelineStatus)}`,
    `Классификация: ${analysis.classification?.label || "Не определено"} (${formatPercent(analysis.classification?.confidence)})`,
    `Почтовый ящик: ${message.mailbox || "Не указано"}`,
    `Отправитель: ${message.from || sender.email || "Не указано"}`,
    `Тема: ${message.subject || "Без темы"}`,
    `Дата фиксации: ${formatDate(message.createdAt)}`,
    "",
    "Отправитель",
    `Email: ${sender.email || "Не найден"}`,
    `ФИО: ${sender.fullName || "Не найдено"}`,
    `Должность: ${sender.position || "Не найдено"}`,
    `Компания: ${sender.companyName || "Не найдено"}`,
    `Сайт: ${sender.website || "Не найден"}`,
    `Городской телефон: ${sender.cityPhone || "Не найден"}`,
    `Мобильный телефон: ${sender.mobilePhone || "Не найден"}`,
    `ИНН: ${sender.inn || "Не найден"}`,
    `Карточка реквизитов: ${sender.legalCardAttached ? "Да" : "Нет"}`,
    "",
    "Заявка",
    `Тип: ${lead.requestType || "Не определён"}`,
    `Бренды: ${formatArray(analysis.detectedBrands || lead.detectedBrands)}`,
    `Артикулы: ${formatArray(lead.articles)}`,
    `Позиций: ${lead.totalPositions || 0}`,
    `Фото шильдика: ${lead.hasNameplatePhotos ? "Да" : "Нет"}`,
    `Фото артикула: ${lead.hasArticlePhotos ? "Да" : "Нет"}`,
    `Свободный текст: ${lead.freeText || message.bodyPreview || "Нет данных"}`,
    "",
    "CRM",
    `Юрлицо найдено: ${crm.isExistingCompany ? "Да" : "Нет"}`,
    `Компания CRM: ${crm.company?.legalName || "Не найдено"}`,
    `Куратор MOP: ${crm.curatorMop || "Не назначен"}`,
    `Куратор MOZ: ${crm.curatorMoz || "Не назначен"}`,
    `Нужно уточнение: ${crm.needsClarification ? "Да" : "Нет"}`,
    `Действия: ${formatArray(crm.actions)}`,
    "",
    "Пайплайн",
    `Разложить по полям: ${intakeFlow.parseToFields ? "Да" : "Нет"}`,
    `Запросить реквизиты: ${intakeFlow.requestClarification ? "Да" : "Нет"}`,
    `Создать клиента в CRM: ${intakeFlow.createClientInCrm ? "Да" : "Нет"}`,
    `Создать запрос в CRM: ${intakeFlow.createRequestInCrm ? "Да" : "Нет"}`,
    "",
    "Правила детекции",
    matchedRules.length
      ? matchedRules.map((rule) => `- ${rule.classifier} | ${rule.scope} | ${rule.pattern} | +${rule.weight}`).join("\n")
      : "Совпадений по базе не найдено",
    "",
    "Вложения",
    message.attachments?.length ? message.attachments.join(", ") : "Нет",
    "",
    "Техданные",
    `messageKey: ${message.messageKey || "Нет"}`
  ].join("\n");
}

function getMessageId(message) {
  return message.messageKey || message.id;
}

function formatCardMeta(message) {
  const company = message.analysis?.sender?.companyName || "Компания не найдена";
  return `${company} · ${formatDate(message.createdAt)}`;
}

function statusLabel(status) {
  const mapping = {
    ready_for_crm: "Готово к CRM",
    needs_clarification: "Нужно уточнение",
    review: "Нужна проверка",
    ignored_spam: "СПАМ",
    fetch_error: "Ошибка чтения"
  };
  return mapping[status] || "Не определено";
}

function statusClassName(status) {
  if (status === "ready_for_crm") {
    return "ready";
  }

  if (status === "needs_clarification") {
    return "clarify";
  }

  if (status === "ignored_spam" || status === "fetch_error") {
    return "spam";
  }

  return "";
}

function formatDate(value) {
  if (!value) {
    return "Без даты";
  }

  return new Date(value).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function formatArray(items) {
  return Array.isArray(items) && items.length ? items.join(", ") : "Нет";
}

function formatPercent(value) {
  if (typeof value !== "number") {
    return "0%";
  }

  return `${Math.round(value * 100)}%`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
