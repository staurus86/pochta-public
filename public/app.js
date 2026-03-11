// ═══════════════════════════════════════════════════════
//  Pochta Platform — Premium Dashboard SPA
// ═══════════════════════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const projectSelect = $('#project-select');
const pageTitle = $('#page-title');
const inboxBadge = $('#inbox-badge');

// IDs проектов (из projects.json defaults)
const P2_ID = 'project-2-tender-parser';
const P3_ID = 'project-3-mailbox-file';
const P1_ID = 'mailroom-primary';

let projects = [];
let selectedProjectId = null;
let runnerMessages = [];
let allRunnerMessages = [];
let selectedMessageId = null;
let currentPage = 'dashboard';
let kbData = null;
let kbTab = 'rules';
let inboxTab = 'all';

await init();

async function init() {
  setupNavigation();
  setupForms();
  await refreshProjects();
  await refreshKb();
  await refreshP3Messages();
}

// ═══════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════

function setupNavigation() {
  $$('.nav-item[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  $$('#kb-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      kbTab = tab.dataset.kbTab;
      $$('#kb-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
      renderKb();
    });
  });

  $('#refresh-kb').addEventListener('click', () => refreshKb());

  // Inbox tabs
  $$('#inbox-tabs .inbox-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      inboxTab = tab.dataset.inboxTab;
      $$('#inbox-tabs .inbox-tab').forEach((t) => t.classList.toggle('active', t === tab));
      renderInbox();
    });
  });
}

function navigateTo(page) {
  currentPage = page;
  $$('.page').forEach((p) => p.classList.remove('active'));
  $(`#page-${page}`)?.classList.add('active');
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === page));

  const titles = {
    dashboard: 'Дашборд',
    inbox: 'Входящие',
    analyze: 'Тест разбора',
    project2: 'Project 2 — Tender Parser',
    project3: 'Project 3 — Mailbox Parser',
    projects: 'Все проекты',
    kb: 'База знаний'
  };
  pageTitle.textContent = titles[page] || 'Pochta';

  if (page === 'inbox') refreshP3Messages();
  if (page === 'project2') refreshP2();
  if (page === 'project3') refreshP3();
}

// ═══════════════════════════════════════════════════════
//  FORMS
// ═══════════════════════════════════════════════════════

function setupForms() {
  projectSelect.addEventListener('change', async () => {
    selectedProjectId = projectSelect.value;
  });

  // ── Create project ──
  $('#project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(fd.entries()))
    });
    if (res.ok) { e.target.reset(); await refreshProjects(); }
  });

  // ── Analyze test email ──
  $('#analysis-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    selectedProjectId = projectSelect.value || P1_ID;
    const project = getProject(selectedProjectId);
    if (project?.type !== 'email-parser') {
      showAnalysisResult({ error: 'Выберите проект типа email-parser.' });
      return;
    }
    const fd = new FormData(e.target);
    const res = await fetch(`/api/projects/${selectedProjectId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(fd.entries()))
    });
    const data = await res.json();
    showAnalysisResult(data.analysis || data);
    await refreshProjects();
  });

  // ═══ PROJECT 2 ═══
  $('#p2-run-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = $('#p2-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;"></div> Выполняется...';
    try {
      const res = await fetch(`/api/projects/${P2_ID}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          days: Number(fd.get('days') || 1),
          maxEmails: Number(fd.get('maxEmails') || 100),
          reset: fd.get('reset') === 'on'
        })
      });
      const data = await res.json();
      $('#p2-runtime-result').textContent = JSON.stringify(data.run || data, null, 2);
    } catch (err) {
      $('#p2-runtime-result').textContent = 'Ошибка: ' + err.message;
    }
    btn.disabled = false;
    btn.textContent = 'Запустить Tender Parser';
    await refreshProjects();
    renderP2Kpis();
  });

  $('#p2-schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await fetch(`/api/projects/${P2_ID}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: fd.get('enabled') === 'on',
        time: fd.get('time'),
        timezone: fd.get('timezone'),
        days: Number(fd.get('days') || 1)
      })
    });
    await refreshProjects();
    renderP2Schedule();
  });

  $('#p2-refresh-runtime').addEventListener('click', () => refreshP2Runtime());

  // ═══ PROJECT 3 ═══
  $('#p3-run-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = $('#p3-run-btn');
    btn.disabled = true;
    await startP3Job({
      days: Number(fd.get('days') || 1),
      maxEmails: Number(fd.get('maxEmails') || 100)
    }, btn, 'Получить и разобрать письма', '#p3-runtime-result');
  });

  $('#p3-schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await fetch(`/api/projects/${P3_ID}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: fd.get('enabled') === 'on',
        time: fd.get('time'),
        timezone: fd.get('timezone'),
        days: Number(fd.get('days') || 1)
      })
    });
    await refreshProjects();
    renderP3Schedule();
  });

  $('#p3-refresh-runtime').addEventListener('click', () => refreshP3Runtime());

  // ═══ INBOX actions ═══
  $('#inbox-fetch-btn').addEventListener('click', async () => {
    const btn = $('#inbox-fetch-btn');
    btn.disabled = true;
    $('#inbox-status-text').textContent = 'Подключение к почтовым ящикам...';
    await startP3Job({ days: 1, maxEmails: 100 }, btn, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Получить письма', null, (run) => {
      if (run) {
        $('#inbox-status-text').textContent = `Получено ${run.fetchedEmailCount || 0} писем, CRM-готовых: ${run.readyForCrmCount || 0}, спам: ${run.spamCount || 0}`;
      }
    });
  });

  $('#inbox-delete-all-btn').addEventListener('click', async () => {
    if (!confirm('Удалить все письма из inbox? Это действие необратимо.')) return;
    await fetch(`/api/projects/${P3_ID}/messages`, { method: 'DELETE' });
    await refreshP3Messages();
    await refreshProjects();
    $('#inbox-status-text').textContent = 'Все письма удалены.';
  });
}

// ═══════════════════════════════════════════════════════
//  DATA
// ═══════════════════════════════════════════════════════

function getProject(id) {
  return projects.find((p) => p.id === (id || selectedProjectId)) || null;
}

async function refreshProjects() {
  const res = await fetch('/api/projects');
  const data = await res.json();
  projects = data.projects || [];

  if (!selectedProjectId && projects[0]) selectedProjectId = projects[0].id;

  renderProjectSelect();
  renderDashboard();
  renderProjectsTable();
}

async function refreshP3Messages() {
  try {
    const res = await fetch(`/api/projects/${P3_ID}/messages`);
    const data = await res.json();
    allRunnerMessages = (data.messages || []).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } catch {
    allRunnerMessages = [];
  }

  // Compute filtered lists
  runnerMessages = filterInboxMessages(inboxTab);

  if (!runnerMessages.some((m) => mid(m) === selectedMessageId)) {
    selectedMessageId = runnerMessages[0] ? mid(runnerMessages[0]) : null;
  }

  // Update badge with non-spam count
  const nonSpam = allRunnerMessages.filter((m) => m.pipelineStatus !== 'ignored_spam' && m.pipelineStatus !== 'fetch_error');
  inboxBadge.textContent = nonSpam.length;
  updateInboxTabCounts();
  renderInbox();
}

function isRequest(m) {
  const rules = m.analysis?.classification?.signals?.matchedRules || [];
  return rules.some((r) => r.weight >= 3);
}

function isSpam(m) {
  return m.pipelineStatus === 'ignored_spam';
}

function isModeration(m) {
  if (isSpam(m) || isRequest(m) || m.pipelineStatus === 'fetch_error') return false;
  const label = m.analysis?.classification?.label || '';
  const status = m.pipelineStatus || '';
  return label === 'Клиент' || ['ready_for_crm', 'needs_clarification', 'review'].includes(status);
}

function filterInboxMessages(tab) {
  if (tab === 'requests') return allRunnerMessages.filter(isRequest);
  if (tab === 'moderation') return allRunnerMessages.filter(isModeration);
  if (tab === 'spam') return allRunnerMessages.filter(isSpam);
  // 'all' — everything except fetch_error
  return allRunnerMessages.filter((m) => m.pipelineStatus !== 'fetch_error');
}

function updateInboxTabCounts() {
  const all = allRunnerMessages.filter((m) => m.pipelineStatus !== 'fetch_error');
  $('#tab-count-all').textContent = all.length;
  $('#tab-count-requests').textContent = allRunnerMessages.filter(isRequest).length;
  $('#tab-count-moderation').textContent = allRunnerMessages.filter(isModeration).length;
  $('#tab-count-spam').textContent = allRunnerMessages.filter(isSpam).length;
}

async function refreshP2() {
  renderP2Kpis();
  renderP2Schedule();
  await refreshP2Runtime();
}

async function refreshP3() {
  await refreshP3Messages();
  renderP3Kpis();
  renderP3Schedule();
  await refreshP3Runtime();
}

async function refreshP2Runtime() {
  try {
    const res = await fetch(`/api/projects/${P2_ID}/runtime`);
    const data = await res.json();
    $('#p2-runtime-result').textContent = JSON.stringify(data.runtime || data, null, 2);
  } catch { $('#p2-runtime-result').textContent = 'Ошибка загрузки.'; }
}

async function refreshP3Runtime() {
  try {
    const res = await fetch(`/api/projects/${P3_ID}/runtime`);
    const data = await res.json();
    $('#p3-runtime-result').textContent = JSON.stringify(data.runtime || data, null, 2);
  } catch { $('#p3-runtime-result').textContent = 'Ошибка загрузки.'; }
}

async function refreshKb() {
  try {
    const res = await fetch('/api/detection-kb');
    kbData = await res.json();
  } catch { kbData = null; }
  renderKb();
}

// ═══ P3 async job launcher with polling & timer ═══
async function startP3Job(payload, btn, resetLabel, runtimeEl, onDone) {
  const timerEl = $('#p3-job-timer') || createJobTimer();
  let elapsed = 0;
  const timerInterval = setInterval(() => {
    elapsed++;
    timerEl.textContent = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
    timerEl.style.display = 'inline-block';
    if (btn) btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;"></div> Выполняется... ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  }, 1000);

  try {
    const res = await fetch(`/api/projects/${P3_ID}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    // Async job (202) — poll for completion
    if (data.jobId) {
      const jobId = data.jobId;
      if (runtimeEl) $(runtimeEl).textContent = 'Задача запущена в фоне, ожидаю результат...';

      let job = null;
      while (true) {
        await sleep(3000);
        try {
          const jr = await fetch(`/api/projects/${P3_ID}/job/${jobId}`);
          const jd = await jr.json();
          job = jd.job;
          if (job.status !== 'running') break;
        } catch { /* retry */ }
      }

      if (job.status === 'done' && job.run) {
        if (runtimeEl) $(runtimeEl).textContent = JSON.stringify(job.run, null, 2);
        if (onDone) onDone(job.run);
      } else {
        if (runtimeEl) $(runtimeEl).textContent = 'Ошибка: ' + (job.error || 'Неизвестная ошибка');
        if (onDone) onDone(null);
      }
    } else {
      // Sync response (shouldn't happen for P3, but handle gracefully)
      if (runtimeEl) $(runtimeEl).textContent = JSON.stringify(data.run || data, null, 2);
      if (onDone) onDone(data.run);
    }
  } catch (err) {
    if (runtimeEl) $(runtimeEl).textContent = 'Ошибка: ' + err.message;
    if (onDone) onDone(null);
  }

  clearInterval(timerInterval);
  timerEl.style.display = 'none';
  if (btn) { btn.disabled = false; btn.innerHTML = resetLabel; }
  await refreshProjects();
  await refreshP3Messages();
  renderP3Kpis();
}

function createJobTimer() {
  const el = document.createElement('span');
  el.id = 'p3-job-timer';
  el.className = 'badge badge-system';
  el.style.cssText = 'display:none;margin-left:8px;font-family:"JetBrains Mono",monospace;font-size:12px;';
  const header = document.querySelector('#page-project3 .panel-header') || document.body;
  header.appendChild(el);
  return el;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function deleteMessage(messageKey) {
  await fetch(`/api/projects/${P3_ID}/messages/${encodeURIComponent(messageKey)}`, { method: 'DELETE' });
  await refreshP3Messages();
  await refreshProjects();
}

// ═══════════════════════════════════════════════════════
//  RENDERERS
// ═══════════════════════════════════════════════════════

function renderProjectSelect() {
  projectSelect.innerHTML = projects.map((p) =>
    `<option value="${esc(p.id)}" ${p.id === selectedProjectId ? 'selected' : ''}>${esc(p.name)} · ${esc(p.mailbox)}</option>`
  ).join('');
}

function renderDashboard() {
  const allAnalyses = projects.flatMap((p) => p.recentAnalyses || []);
  const allRuns = projects.flatMap((p) => p.recentRuns || []);
  const clientCount = allAnalyses.filter((a) => a.category === 'Клиент').length;
  const spamCount = allRunnerMessages.filter((m) => m.pipelineStatus === 'ignored_spam').length;
  const readyCount = allRunnerMessages.filter((m) => m.pipelineStatus === 'ready_for_crm').length;
  const clarifyCount = allRunnerMessages.filter((m) => m.pipelineStatus === 'needs_clarification').length;
  const latestRun = allRuns.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];

  const kpis = [
    { label: 'Проектов', value: projects.length, cls: 'accent' },
    { label: 'Разборов', value: allAnalyses.length, cls: '' },
    { label: 'Клиентских', value: clientCount, cls: 'green' },
    { label: 'Спам удалено', value: spamCount, cls: 'rose' },
    { label: 'Готово к CRM', value: readyCount, cls: 'green' },
    { label: 'Уточнение', value: clarifyCount, cls: 'amber' },
    { label: 'В inbox', value: runnerMessages.length, cls: 'accent' },
    { label: 'Посл. запуск', value: latestRun ? formatDuration(latestRun.durationMs) : '—', cls: '', sub: latestRun ? fmtDate(latestRun.createdAt) : '' }
  ];

  $('#kpi-grid').innerHTML = kpis.map((k) => `
    <div class="kpi-card">
      <div class="kpi-label">${esc(k.label)}</div>
      <div class="kpi-value ${k.cls}">${esc(k.value)}</div>
      ${k.sub ? `<div class="kpi-sub">${esc(k.sub)}</div>` : ''}
    </div>
  `).join('');

  // Heatmap
  const inboxAccounts = new Map();
  allRunnerMessages.forEach((m) => {
    const mb = m.mailbox || 'unknown';
    if (!inboxAccounts.has(mb)) inboxAccounts.set(mb, { name: mb, count: 0 });
    inboxAccounts.get(mb).count++;
  });
  if (inboxAccounts.size === 0) {
    projects.forEach((p) => inboxAccounts.set(p.mailbox, { name: p.name, count: p.recentAnalyses?.length || 0 }));
  }
  const maxCount = Math.max(1, ...Array.from(inboxAccounts.values()).map((a) => a.count));
  $('#inbox-count-label').textContent = `${inboxAccounts.size} ящиков`;
  $('#inbox-heatmap').innerHTML = Array.from(inboxAccounts.entries()).map(([mb, data]) => {
    const ratio = data.count / maxCount;
    const cls = ratio > 0.5 ? 'hot' : ratio > 0.15 ? 'warm' : 'cold';
    return `<div class="heatmap-cell ${cls}"><div class="cell-name" title="${esc(mb)}">${esc(mb.split('@')[0])}</div><div class="cell-value">${data.count}</div></div>`;
  }).join('');

  // Recent analyses
  $('#recent-analyses-body').innerHTML = allAnalyses.slice(0, 8).map((a) => `
    <tr><td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${esc(a.senderEmail)}</td>
    <td>${classificationBadge(a.category)}</td><td>${esc(a.company || '—')}</td>
    <td style="font-size:11px;color:var(--text-muted)">${fmtDate(a.createdAt)}</td></tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">Нет данных</td></tr>';

  // Recent runs
  const allRunsSorted = allRuns.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  $('#recent-runs-body').innerHTML = allRunsSorted.slice(0, 6).map((r) => {
    const isTender = r.added != null && r.totalMessages == null;
    return `<tr><td style="font-size:12px;">${esc(findProjectName(r))}</td>
    <td>${r.status === 'ok' ? '<span class="badge badge-ready">OK</span>' : '<span class="badge badge-error">Ошибка</span>'}</td>
    <td>${isTender ? (r.processed ?? '—') : (r.totalMessages ?? r.processed ?? '—')}</td>
    <td>${isTender ? `<span title="Добавлено">${r.added ?? '—'}</span>` : (r.spamCount ?? r.skipped ?? '—')}</td>
    <td>${isTender ? `<span title="Пропущено">${r.skipped ?? '—'}</span>` : (r.readyForCrmCount ?? '—')}</td>
    <td>${isTender ? (r.failed ?? '—') : (r.clarificationCount ?? '—')}</td>
    <td style="font-size:11px;color:var(--text-muted)">${formatDuration(r.durationMs)}</td>
    <td><span class="badge ${r.trigger === 'schedule' ? 'badge-system' : 'badge-unknown'}">${esc(r.trigger || 'manual')}</span></td></tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;">Нет запусков</td></tr>';
}

function renderProjectsTable() {
  $('#projects-count-label').textContent = projects.length;
  $('#projects-table-body').innerHTML = projects.map((p) => {
    const pageMap = { 'tender-importer': 'project2', 'mailbox-file-parser': 'project3' };
    const targetPage = pageMap[p.type] || 'analyze';
    return `<tr style="cursor:pointer" onclick="event.preventDefault();" data-nav="${targetPage}">
      <td><strong>${esc(p.name)}</strong></td>
      <td><span class="badge ${p.type === 'email-parser' ? 'badge-client' : p.type === 'tender-importer' ? 'badge-system' : 'badge-vendor'}">${esc(p.type)}</span></td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${esc(p.mailbox)}</td>
      <td>${p.schedule?.enabled ? `<span class="badge badge-ready">${esc(p.schedule.time)} ${esc(p.schedule.timezone)}</span>` : '<span class="badge badge-unknown">Выключено</span>'}</td>
    </tr>`;
  }).join('');

  // Add click handlers for project rows
  $$('#projects-table-body tr[data-nav]').forEach((row) => {
    row.addEventListener('click', () => navigateTo(row.dataset.nav));
  });
}

// ═══ P2 KPIs & Schedule ═══
function renderP2Kpis() {
  const p = getProject(P2_ID);
  const run = p?.recentRuns?.[0] || {};
  const kpis = [
    { label: 'Статус', value: run.status || '—', cls: run.status === 'ok' ? 'green' : run.status === 'error' ? 'rose' : '' },
    { label: 'Обработано', value: run.processed ?? '—', cls: '' },
    { label: 'Добавлено', value: run.added ?? '—', cls: 'green' },
    { label: 'Пропущено', value: run.skipped ?? '—', cls: 'amber' },
    { label: 'Ошибок', value: run.failed ?? '—', cls: 'rose' },
    { label: 'Время', value: formatDuration(run.durationMs), cls: '' }
  ];
  $('#p2-kpi-grid').innerHTML = kpis.map((k) => `<div class="kpi-card"><div class="kpi-label">${esc(k.label)}</div><div class="kpi-value ${k.cls}">${esc(k.value)}</div></div>`).join('');
}

function renderP2Schedule() {
  const p = getProject(P2_ID);
  if (!p?.schedule) return;
  const sf = $('#p2-schedule-form');
  sf.elements.enabled.checked = Boolean(p.schedule.enabled);
  sf.elements.time.value = p.schedule.time || '12:00';
  sf.elements.timezone.value = p.schedule.timezone || 'Europe/Moscow';
  sf.elements.days.value = String(p.schedule.days || 1);
}

// ═══ P3 KPIs & Schedule ═══
function renderP3Kpis() {
  const p = getProject(P3_ID);
  const run = p?.recentRuns?.[0] || {};
  const kpis = [
    { label: 'Ящиков', value: run.accountCount ?? '—', cls: 'accent' },
    { label: 'Получено', value: run.fetchedEmailCount ?? '—', cls: '' },
    { label: 'Разобрано', value: run.totalMessages ?? '—', cls: '' },
    { label: 'Спам', value: run.spamCount ?? '—', cls: 'rose' },
    { label: 'Уточнение', value: run.clarificationCount ?? '—', cls: 'amber' },
    { label: 'CRM-готовых', value: run.readyForCrmCount ?? '—', cls: 'green' }
  ];
  $('#p3-kpi-grid').innerHTML = kpis.map((k) => `<div class="kpi-card"><div class="kpi-label">${esc(k.label)}</div><div class="kpi-value ${k.cls}">${esc(k.value)}</div></div>`).join('');
}

function renderP3Schedule() {
  const p = getProject(P3_ID);
  if (!p?.schedule) return;
  const sf = $('#p3-schedule-form');
  sf.elements.enabled.checked = Boolean(p.schedule.enabled);
  sf.elements.time.value = p.schedule.time || '12:00';
  sf.elements.timezone.value = p.schedule.timezone || 'Europe/Moscow';
  sf.elements.days.value = String(p.schedule.days || 1);
}

// ═══ INBOX ═══
function renderInbox() {
  // Re-filter based on current tab
  runnerMessages = filterInboxMessages(inboxTab);
  if (!runnerMessages.some((m) => mid(m) === selectedMessageId)) {
    selectedMessageId = runnerMessages[0] ? mid(runnerMessages[0]) : null;
  }
  updateInboxTabCounts();

  const listEl = $('#runner-messages-list');
  const viewEl = $('#email-view');
  const detailEl = $('#detail-panel');

  const emptyLabels = { all: 'Нет писем', requests: 'Нет заявок', moderation: 'Нет писем на модерации', spam: 'Нет спама' };
  if (runnerMessages.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><h4>${emptyLabels[inboxTab] || 'Нет писем'}</h4><p>Нажмите «Получить письма»</p></div>`;
    viewEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📬</div><h4>Выберите письмо</h4></div>';
    detailEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h4>Данные разбора</h4></div>';
    return;
  }

  listEl.innerHTML = runnerMessages.map((m) => {
    const id = mid(m);
    const active = id === selectedMessageId ? 'active' : '';
    const a = m.analysis || {};
    const conf = a.classification?.confidence;
    return `<button class="message-item ${active}" data-mid="${esc(id)}">
      <div class="message-from">
        <span>${esc(m.from || a.sender?.email || 'Неизвестный')}</span>
        <span class="message-time">${fmtDate(m.createdAt)}</span>
      </div>
      <div class="message-subject">${esc(m.subject || 'Без темы')}</div>
      <div class="message-meta">
        ${statusBadge(m.pipelineStatus)}
        ${conf != null ? confidenceBadge(conf) : ''}
        <span class="message-mailbox">${esc((m.mailbox || '').split('@')[0])}</span>
      </div>
    </button>`;
  }).join('');

  listEl.querySelectorAll('.message-item').forEach((item) => {
    item.addEventListener('click', () => {
      selectedMessageId = item.dataset.mid;
      renderInbox();
    });
  });

  const msg = runnerMessages.find((m) => mid(m) === selectedMessageId) || runnerMessages[0];
  if (msg) renderEmailView(msg, viewEl, detailEl);
}

function renderEmailView(msg, viewEl, detailEl) {
  const a = msg.analysis || {};
  const sender = a.sender || {};
  const lead = a.lead || {};
  const crm = a.crm || {};
  const cls = a.classification || {};
  const rules = cls.signals?.matchedRules || [];
  const msgKey = mid(msg);

  viewEl.innerHTML = `
    <div class="email-view-header">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <h3>${esc(msg.subject || 'Без темы')}</h3>
        <button class="btn btn-danger btn-sm" onclick="window.__deleteMsg('${esc(msgKey)}')" title="Удалить письмо" style="flex-shrink:0;">Удалить</button>
      </div>
      <div class="email-view-meta">
        <span><strong>От:</strong> ${esc(msg.from || sender.email)}</span>
        <span><strong>Ящик:</strong> ${esc(msg.mailbox)}</span>
        <span><strong>Дата:</strong> ${fmtDate(msg.createdAt)}</span>
      </div>
    </div>
    <div class="email-body-content">${esc(msg.bodyPreview || lead.freeText || 'Нет текста')}</div>
    ${msg.attachments?.length ? `<div class="attachment-list">${msg.attachments.map((att) => `<span class="attachment-chip"><span class="att-icon">📎</span> ${esc(att)}</span>`).join('')}</div>` : ''}
  `;

  const fields = [['Email', sender.email], ['ФИО', sender.fullName], ['Должность', sender.position], ['Компания', sender.companyName], ['Сайт', sender.website], ['Гор. телефон', sender.cityPhone], ['Моб. телефон', sender.mobilePhone], ['ИНН', sender.inn], ['Реквизиты', sender.legalCardAttached ? 'Приложены' : null]];
  const leadFields = [['Тип запроса', lead.requestType], ['Бренды', formatArr(a.detectedBrands || lead.detectedBrands)], ['Артикулы', formatArr(lead.articles)], ['Позиций', lead.totalPositions], ['Фото шильдика', lead.hasNameplatePhotos ? 'Да' : null], ['Фото артикула', lead.hasArticlePhotos ? 'Да' : null]];
  const crmFields = [['Юрлицо найдено', crm.isExistingCompany ? 'Да' : 'Нет'], ['Компания CRM', crm.company?.legalName], ['МОП', crm.curatorMop], ['МОЗ', crm.curatorMoz], ['Уточнение', crm.needsClarification ? 'Требуется' : 'Нет']];

  detailEl.innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title">Классификация</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        ${classificationBadge(cls.label)}
        ${cls.confidence != null ? `<div class="confidence-bar" style="flex:1">${renderConfBar(cls.confidence)}</div>` : ''}
      </div>
      ${statusBadge(msg.pipelineStatus)}
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Отправитель</div>
      ${fields.filter(([,v]) => v).map(([l,v]) => detailField(l, v)).join('')}
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Заявка</div>
      ${leadFields.filter(([,v]) => v).map(([l,v]) => detailField(l, v)).join('')}
      ${lead.lineItems?.length ? `<div style="margin-top:8px;"><table class="data-table" style="font-size:11px;"><thead><tr><th>Артикул</th><th>Кол-во</th><th>Ед.</th></tr></thead><tbody>${lead.lineItems.map((li) => `<tr><td>${esc(li.article)}</td><td>${li.quantity}</td><td>${esc(li.unit)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>
    <div class="detail-section">
      <div class="detail-section-title">CRM</div>
      ${crmFields.filter(([,v]) => v).map(([l,v]) => detailField(l, v)).join('')}
      ${crm.actions?.length ? `<div style="margin-top:8px;">${crm.actions.map((ac) => `<div style="font-size:11px;color:var(--text-secondary);padding:3px 0;">→ ${esc(ac)}</div>`).join('')}</div>` : ''}
    </div>
    ${rules.length ? `<div class="detail-section"><div class="detail-section-title">Правила</div>${rules.map((r) => `<div style="font-size:11px;padding:3px 0;display:flex;gap:6px;align-items:center;"><span class="badge ${r.classifier === 'spam' ? 'badge-spam' : r.classifier === 'client' ? 'badge-client' : 'badge-vendor'}" style="font-size:9px;">${esc(r.classifier)}</span><span style="color:var(--text-muted);font-family:'JetBrains Mono',monospace;font-size:10px;">${esc(truncate(r.pattern, 30))}</span><span style="color:var(--green);font-weight:600;margin-left:auto;">+${r.weight}</span></div>`).join('')}</div>` : ''}
    <div class="detail-actions">
      ${crm.isExistingCompany === false ? '<button class="btn btn-primary btn-sm" style="width:100%">Создать клиента в CRM</button>' : ''}
      ${cls.label === 'Клиент' ? '<button class="btn btn-success btn-sm" style="width:100%">Создать запрос в CRM</button>' : ''}
      ${crm.needsClarification ? '<button class="btn btn-ghost btn-sm" style="width:100%">Запросить реквизиты</button>' : ''}
      <button class="btn btn-danger btn-sm" style="width:100%" onclick="window.__deleteMsg('${esc(msgKey)}')">Удалить письмо</button>
    </div>
  `;
}

// Global delete handler
window.__deleteMsg = async (key) => {
  if (!confirm('Удалить это письмо?')) return;
  await deleteMessage(key);
};

function showAnalysisResult(data) {
  const container = $('#analysis-result');
  if (!data || data.error) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h4>${esc(data?.error || 'Ошибка')}</h4></div>`;
    return;
  }
  const sender = data.sender || {};
  const lead = data.lead || {};
  const crm = data.crm || {};
  const cls = data.classification || {};
  const rules = cls.signals?.matchedRules || [];

  container.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">${classificationBadge(cls.label)}${cls.confidence != null ? `<div class="confidence-bar" style="width:120px">${renderConfBar(cls.confidence)}</div>` : ''}${statusBadge(data.intakeFlow?.requestType || '')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div><div class="detail-section-title" style="margin-bottom:8px;">Отправитель</div>${[['Email', sender.email],['ФИО', sender.fullName],['Должность', sender.position],['Компания', sender.companyName],['Сайт', sender.website],['Гор.', sender.cityPhone],['Моб.', sender.mobilePhone],['ИНН', sender.inn]].filter(([,v]) => v).map(([l,v]) => detailField(l, v)).join('')}</div>
      <div><div class="detail-section-title" style="margin-bottom:8px;">CRM</div>${[['Юрлицо', crm.isExistingCompany ? crm.company?.legalName || 'Найдено' : 'Не найдено'],['МОП', crm.curatorMop],['МОЗ', crm.curatorMoz],['Уточнение', crm.needsClarification ? 'Да' : 'Нет']].filter(([,v]) => v).map(([l,v]) => detailField(l, v)).join('')}${crm.actions?.length ? crm.actions.map((a) => `<div style="font-size:11px;color:var(--text-secondary);padding:2px 0;">→ ${esc(a)}</div>`).join('') : ''}</div>
    </div>
    ${lead.lineItems?.length ? `<div style="margin-top:16px;"><div class="detail-section-title" style="margin-bottom:8px;">Позиции</div><table class="data-table" style="font-size:12px;"><thead><tr><th>Артикул</th><th>Кол-во</th><th>Ед.</th><th>Описание</th></tr></thead><tbody>${lead.lineItems.map((li) => `<tr><td><strong>${esc(li.article)}</strong></td><td>${li.quantity}</td><td>${esc(li.unit)}</td><td style="color:var(--text-muted);font-size:11px;">${esc(truncate(li.descriptionRu, 60))}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${rules.length ? `<div style="margin-top:16px;"><div class="detail-section-title" style="margin-bottom:8px;">Правила</div>${rules.map((r) => `<div style="font-size:11px;padding:3px 0;display:flex;gap:6px;align-items:center;"><span class="badge ${r.classifier === 'spam' ? 'badge-spam' : r.classifier === 'client' ? 'badge-client' : 'badge-vendor'}" style="font-size:9px;">${esc(r.classifier)}</span><span style="color:var(--text-muted);font-family:'JetBrains Mono',monospace;font-size:10px;">${esc(truncate(r.pattern, 40))}</span><span style="color:var(--green);font-weight:600;margin-left:auto;">+${r.weight}</span></div>`).join('')}</div>` : ''}
    ${crm.suggestedReply ? `<div style="margin-top:16px;"><div class="detail-section-title" style="margin-bottom:8px;">Предложенный ответ</div><div style="background:var(--surface-0);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;font-size:12px;white-space:pre-wrap;color:var(--text-secondary);">${esc(crm.suggestedReply)}</div></div>` : ''}
  `;
}

function renderKb() {
  const container = $('#kb-content');
  if (!kbData) { container.innerHTML = '<div class="empty-state"><div class="empty-icon">📚</div><h4>Загрузка...</h4></div>'; return; }

  if (kbTab === 'stats') {
    const s = kbData.stats || {};
    container.innerHTML = `<div style="padding:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">${[['Правил', s.ruleCount],['Brand aliases', s.brandAliasCount],['Профилей', s.senderProfileCount],['Паттернов', s.fieldPatternCount],['Корпус', s.corpusCount]].map(([l,v]) => `<div class="kpi-card"><div class="kpi-label">${esc(l)}</div><div class="kpi-value accent">${v ?? '—'}</div></div>`).join('')}</div>`;
    return;
  }
  if (kbTab === 'rules') {
    const rules = kbData.rules || [];
    container.innerHTML = `<table class="data-table"><thead><tr><th>ID</th><th>Scope</th><th>Classifier</th><th>Тип</th><th>Паттерн</th><th>Вес</th><th>Заметки</th></tr></thead><tbody>${rules.map((r) => `<tr><td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${r.id}</td><td><span class="badge badge-unknown">${esc(r.scope)}</span></td><td>${classificationBadge(r.classifier === 'client' ? 'Клиент' : r.classifier === 'spam' ? 'СПАМ' : 'Поставщик услуг')}</td><td style="font-size:11px;">${esc(r.match_type)}</td><td style="font-family:'JetBrains Mono',monospace;font-size:10px;max-width:300px;overflow:hidden;text-overflow:ellipsis;" title="${esc(r.pattern)}">${esc(truncate(r.pattern, 50))}</td><td><strong>${r.weight}</strong></td><td style="font-size:11px;color:var(--text-muted);">${esc(r.notes || '')}</td></tr>`).join('')}</tbody></table>`;
    return;
  }
  if (kbTab === 'brands') {
    container.innerHTML = `<table class="data-table"><thead><tr><th>Бренд</th><th>Alias</th><th>ID</th></tr></thead><tbody>${(kbData.brandAliases || []).map((b) => `<tr><td><strong>${esc(b.canonical_brand)}</strong></td><td style="font-family:'JetBrains Mono',monospace;font-size:12px;">${esc(b.alias)}</td><td style="color:var(--text-muted);font-size:11px;">${b.id}</td></tr>`).join('')}</tbody></table>`;
    return;
  }
  if (kbTab === 'senders') {
    const senders = kbData.senderProfiles || [];
    container.innerHTML = senders.length ? `<table class="data-table"><thead><tr><th>Email</th><th>Домен</th><th>Класс</th><th>Компания</th><th>Бренд</th></tr></thead><tbody>${senders.map((s) => `<tr><td>${esc(s.sender_email || '—')}</td><td>${esc(s.sender_domain || '—')}</td><td>${classificationBadge(s.classification)}</td><td>${esc(s.company_hint || '—')}</td><td>${esc(s.brand_hint || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state" style="padding:32px"><h4>Нет профилей</h4></div>';
  }
}

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════

function findProjectName(run) {
  for (const p of projects) { if ((p.recentRuns || []).some((r) => r.id === run.id)) return p.name; }
  return '—';
}

function mid(m) { return m.messageKey || m.id; }

function classificationBadge(label) {
  const map = { 'Клиент': 'badge-client', 'client': 'badge-client', 'СПАМ': 'badge-spam', 'spam': 'badge-spam', 'Поставщик услуг': 'badge-vendor', 'vendor': 'badge-vendor' };
  return `<span class="badge ${map[label] || 'badge-unknown'}">${esc(label || 'Не определено')}</span>`;
}

function statusBadge(status) {
  const labels = { ready_for_crm: 'CRM-готово', needs_clarification: 'Уточнение', review: 'Проверка', ignored_spam: 'Спам', fetch_error: 'Ошибка', 'Монобрендовая': 'Монобренд', 'Мультибрендовая': 'Мультибренд' };
  const cls = { ready_for_crm: 'badge-ready', needs_clarification: 'badge-review', review: 'badge-review', ignored_spam: 'badge-spam', fetch_error: 'badge-error' };
  return `<span class="badge ${cls[status] || 'badge-unknown'}">${esc(labels[status] || status || '')}</span>`;
}

function confidenceBadge(conf) {
  const pct = Math.round((conf || 0) * 100);
  return `<span class="confidence-value" style="font-size:10px;color:${pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--amber)' : 'var(--rose)'}">${pct}%</span>`;
}

function renderConfBar(conf) {
  const pct = Math.round((conf || 0) * 100);
  const cls = pct >= 70 ? 'high' : pct >= 40 ? 'medium' : 'low';
  return `<div class="confidence-track"><div class="confidence-fill ${cls}" style="width:${pct}%"></div></div><span class="confidence-value">${pct}%</span>`;
}

function detailField(label, value) {
  return `<div class="detail-field"><span class="detail-field-label">${esc(label)}</span><span class="detail-field-value">${esc(value || '—')}</span></div>`;
}

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatArr(items) { return Array.isArray(items) && items.length ? items.join(', ') : null; }
function truncate(s, n) { return !s ? '' : s.length > n ? s.slice(0, n) + '...' : s; }
function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
