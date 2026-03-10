const projectForm = document.querySelector("#project-form");
const analysisForm = document.querySelector("#analysis-form");
const tenderRunForm = document.querySelector("#tender-run-form");
const projectsList = document.querySelector("#projects-list");
const projectsCount = document.querySelector("#projects-count");
const resultBlock = document.querySelector("#analysis-result");
const runtimeResult = document.querySelector("#runtime-result");
const selectedProjectLabel = document.querySelector("#selected-project-label");
const workspaceTitle = document.querySelector("#workspace-title");
const emailWorkspace = document.querySelector("#email-parser-workspace");
const tenderWorkspace = document.querySelector("#tender-importer-workspace");
const refreshRuntimeButton = document.querySelector("#refresh-runtime");

let projects = [];
let selectedProjectId = null;

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

tenderRunForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedProjectId) {
    runtimeResult.textContent = "Сначала выберите проект.";
    return;
  }

  const selectedProject = getSelectedProject();
  if (selectedProject?.type !== "tender-importer") {
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
}

function renderProjects() {
  projectsList.innerHTML = "";

  if (projects.length === 0) {
    projectsList.textContent = "Проектов пока нет.";
    return;
  }

  for (const project of projects) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `project-card${project.id === selectedProjectId ? " active" : ""}`;
    card.innerHTML = `
      <strong>${escapeHtml(project.name)}</strong>
      <span>${escapeHtml(project.mailbox)}</span>
      <span>Тип: ${escapeHtml(project.type || "email-parser")}</span>
      <span>История: ${(project.recentAnalyses || []).length + (project.recentRuns || []).length}</span>
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
}

async function refreshRuntime() {
  const selectedProject = getSelectedProject();
  if (!selectedProject || selectedProject.type !== "tender-importer") {
    runtimeResult.textContent = "Выберите проект 2, чтобы увидеть runtime status.";
    return;
  }

  const response = await fetch(`/api/projects/${selectedProjectId}/runtime`);
  const data = await response.json();
  runtimeResult.textContent = JSON.stringify(data.runtime || data, null, 2);
}

function renderWorkspace(project) {
  const isTender = project?.type === "tender-importer";
  emailWorkspace.classList.toggle("hidden", isTender);
  tenderWorkspace.classList.toggle("hidden", !isTender);
  workspaceTitle.textContent = isTender ? "Запуск tender parser" : "Тест входящего письма";
}

function getSelectedProject() {
  return projects.find((project) => project.id === selectedProjectId) || null;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
