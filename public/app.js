// ═══════════════════════════════════════════════════════
//  Pochta Platform — Premium Dashboard SPA
// ═══════════════════════════════════════════════════════

// ── DOM refs ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const projectSelect = $('#project-select');
const pageTitle = $('#page-title');
const inboxBadge = $('#inbox-badge');

// ── State ──
let projects = [];
let selectedProjectId = null;
let runnerMessages = [];
let allRunnerMessages = [];
let selectedMessageId = null;
let currentPage = 'dashboard';
let kbData = null;
let kbTab = 'rules';

// ── Init ──
await init();

async function init() {
  setupNavigation();
  setupForms();
  await refreshProjects();
  await refreshKb();
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
    runner: 'Runner',
    projects: 'Проекты',
    kb: 'База знаний'
  };
  pageTitle.textContent = titles[page] || 'Pochta';

  if (page === 'inbox') refreshRunnerMessages();
  if (page === 'runner') refreshRuntime();
}

// ═══════════════════════════════════════════════════════
//  FORMS
// ═══════════════════════════════════════════════════════

function setupForms() {
  projectSelect.addEventListener('change', async () => {
    selectedProjectId = projectSelect.value;
    updateWorkspaceForProject();
    await refreshRuntime();
    await refreshRunnerMessages();
  });

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

  $('#analysis-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    const project = getProject();
    if (project?.type !== 'email-parser') {
      showAnalysisResult({ error: 'Этот проект не поддерживает разбор писем.' });
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

  $('#runner-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    const fd = new FormData(e.target);
    const btn = $('#runner-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Выполняется...';

    const res = await fetch(`/api/projects/${selectedProjectId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        days: Number(fd.get('days') || 1),
        maxEmails: Number(fd.get('maxEmails') || 100),
        reset: fd.get('reset') === 'on'
      })
    });
    const data = await res.json();
    $('#runtime-result').textContent = JSON.stringify(data.run || data, null, 2);
    btn.disabled = false;
    btn.textContent = 'Запустить';
    await refreshProjects();
    await refreshRunnerMessages();
  });

  $('#schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    const fd = new FormData(e.target);
    await fetch(`/api/projects/${selectedProjectId}/schedule`, {
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
  });

  $('#refresh-runtime').addEventListener('click', () => refreshRuntime());
}

// ═══════════════════════════════════════════════════════
//  DATA
// ═══════════════════════════════════════════════════════

async function refreshProjects() {
  const res = await fetch('/api/projects');
  const data = await res.json();
  projects = data.projects || [];

  if (!selectedProjectId && projects[0]) selectedProjectId = projects[0].id;
  if (selectedProjectId && !projects.some((p) => p.id === selectedProjectId)) {
    selectedProjectId = projects[0]?.id || null;
  }

  renderProjectSelect();
  renderDashboard();
  renderProjectsTable();
  updateWorkspaceForProject();
}

async function refreshRuntime() {
  const project = getProject();
  if (!project || !isRunner(project)) {
    $('#runtime-result').textContent = 'Выберите runner-проект.';
    return;
  }
  try {
    const res = await fetch(`/api/projects/${selectedProjectId}/runtime`);
    const data = await res.json();
    $('#runtime-result').textContent = JSON.stringify(data.runtime || data, null, 2);
  } catch {
    $('#runtime-result').textContent = 'Ошибка загрузки runtime.';
  }
}

async function refreshRunnerMessages() {
  const project = getProject();
  if (project?.type !== 'mailbox-file-parser') {
    allRunnerMessages = [];
    runnerMessages = [];
    renderInbox();
    return;
  }
  try {
    const res = await fetch(`/api/projects/${selectedProjectId}/messages`);
    const data = await res.json();
    allRunnerMessages = data.messages || [];
    runnerMessages = allRunnerMessages
      .filter((m) => !['ignored_spam', 'fetch_error'].includes(m.pipelineStatus))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (!runnerMessages.some((m) => mid(m) === selectedMessageId)) {
      selectedMessageId = runnerMessages[0] ? mid(runnerMessages[0]) : null;
    }
  } catch {
    allRunnerMessages = [];
    runnerMessages = [];
  }

  inboxBadge.textContent = runnerMessages.length;
  renderInbox();
  renderRunnerKpis();
}

async function refreshKb() {
  try {
    const res = await fetch('/api/detection-kb');
    kbData = await res.json();
  } catch {
    kbData = null;
  }
  renderKb();
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
  // KPIs
  const allAnalyses = projects.flatMap((p) => p.recentAnalyses || []);
  const allRuns = projects.flatMap((p) => p.recentRuns || []);
  const clientCount = allAnalyses.filter((a) => a.category === 'Клиент').length;
  const spamCount = allRunnerMessages.filter((m) => m.pipelineStatus === 'ignored_spam').length;
  const readyCount = allRunnerMessages.filter((m) => m.pipelineStatus === 'ready_for_crm').length;
  const clarifyCount = allRunnerMessages.filter((m) => m.pipelineStatus === 'needs_clarification').length;
  const latestRun = allRuns[0];

  const kpis = [
    { label: 'Проектов', value: projects.length, cls: 'accent' },
    { label: 'Разборов', value: allAnalyses.length, cls: '', sub: 'Всего за историю' },
    { label: 'Клиентских', value: clientCount, cls: 'green', sub: 'Из последних разборов' },
    { label: 'Спам удалено', value: spamCount, cls: 'rose', sub: 'Не попало в inbox' },
    { label: 'Готово к CRM', value: readyCount, cls: 'green', sub: 'Автосоздание' },
    { label: 'Нужно уточнение', value: clarifyCount, cls: 'amber', sub: 'Запрос реквизитов' },
    { label: 'В inbox', value: runnerMessages.length, cls: 'accent', sub: 'Хороших писем' },
    { label: 'Последний запуск', value: latestRun ? formatDuration(latestRun.durationMs) : '—', cls: '', sub: latestRun ? fmtDate(latestRun.createdAt) : 'Нет данных' }
  ];

  $('#kpi-grid').innerHTML = kpis.map((k) => `
    <div class="kpi-card">
      <div class="kpi-label">${esc(k.label)}</div>
      <div class="kpi-value ${k.cls}">${esc(k.value)}</div>
      ${k.sub ? `<div class="kpi-sub">${esc(k.sub)}</div>` : ''}
    </div>
  `).join('');

  // Heatmap
  const mailboxProjects = projects.filter((p) => p.type === 'mailbox-file-parser' || p.recentMessages?.length > 0);
  const inboxAccounts = new Map();
  allRunnerMessages.forEach((m) => {
    const mb = m.mailbox || 'unknown';
    if (!inboxAccounts.has(mb)) inboxAccounts.set(mb, { name: mb, count: 0 });
    inboxAccounts.get(mb).count++;
  });

  if (inboxAccounts.size === 0) {
    projects.forEach((p) => {
      inboxAccounts.set(p.mailbox, { name: p.name || p.mailbox, count: p.recentAnalyses?.length || 0 });
    });
  }

  const maxCount = Math.max(1, ...Array.from(inboxAccounts.values()).map((a) => a.count));
  $('#inbox-count-label').textContent = `${inboxAccounts.size} ящиков`;
  $('#inbox-heatmap').innerHTML = Array.from(inboxAccounts.entries()).map(([mb, data]) => {
    const ratio = data.count / maxCount;
    const cls = ratio > 0.5 ? 'hot' : ratio > 0.15 ? 'warm' : 'cold';
    return `<div class="heatmap-cell ${cls}">
      <div class="cell-name" title="${esc(mb)}">${esc(mb.split('@')[0])}</div>
      <div class="cell-value">${data.count}</div>
    </div>`;
  }).join('');

  // Recent analyses
  $('#recent-analyses-body').innerHTML = allAnalyses.slice(0, 8).map((a) => `
    <tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${esc(a.senderEmail)}</td>
      <td>${classificationBadge(a.category)}</td>
      <td>${esc(a.company || '—')}</td>
      <td style="font-size:11px;color:var(--text-muted)">${fmtDate(a.createdAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">Нет данных</td></tr>';

  // Recent runs
  const allRunsSorted = allRuns.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  $('#recent-runs-body').innerHTML = allRunsSorted.slice(0, 6).map((r) => `
    <tr>
      <td style="font-size:12px;">${esc(findProjectName(r))}</td>
      <td>${r.status === 'ok' ? '<span class="badge badge-ready">OK</span>' : '<span class="badge badge-error">Ошибка</span>'}</td>
      <td>${r.totalMessages ?? r.processed ?? '—'}</td>
      <td>${r.spamCount ?? r.skipped ?? '—'}</td>
      <td>${r.readyForCrmCount ?? '—'}</td>
      <td>${r.clarificationCount ?? '—'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${formatDuration(r.durationMs)}</td>
      <td><span class="badge ${r.trigger === 'schedule' ? 'badge-system' : 'badge-unknown'}">${esc(r.trigger || 'manual')}</span></td>
    </tr>
  `).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;">Нет запусков</td></tr>';
}

function renderProjectsTable() {
  $('#projects-count-label').textContent = projects.length;
  $('#projects-table-body').innerHTML = projects.map((p) => `
    <tr class="${p.id === selectedProjectId ? 'active' : ''}" onclick="document.querySelector('#project-select').value='${esc(p.id)}';document.querySelector('#project-select').dispatchEvent(new Event('change'))">
      <td><strong>${esc(p.name)}</strong></td>
      <td><span class="badge ${p.type === 'email-parser' ? 'badge-client' : p.type === 'tender-importer' ? 'badge-system' : 'badge-vendor'}">${esc(p.type)}</span></td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${esc(p.mailbox)}</td>
      <td>${p.schedule?.enabled ? `<span class="badge badge-ready">${esc(p.schedule.time)} ${esc(p.schedule.timezone)}</span>` : '<span class="badge badge-unknown">Выключено</span>'}</td>
    </tr>
  `).join('');
}

function renderInbox() {
  const listEl = $('#runner-messages-list');
  const viewEl = $('#email-view');
  const detailEl = $('#detail-panel');

  if (runnerMessages.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><h4>Нет писем</h4><p>Запустите runner для получения писем</p></div>';
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

  // Email view
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

  viewEl.innerHTML = `
    <div class="email-view-header">
      <h3>${esc(msg.subject || 'Без темы')}</h3>
      <div class="email-view-meta">
        <span><strong>От:</strong> ${esc(msg.from || sender.email)}</span>
        <span><strong>Ящик:</strong> ${esc(msg.mailbox)}</span>
        <span><strong>Дата:</strong> ${fmtDate(msg.createdAt)}</span>
      </div>
    </div>
    <div class="email-body-content">${esc(msg.bodyPreview || lead.freeText || 'Нет текста')}</div>
    ${msg.attachments?.length ? `
      <div class="attachment-list">
        ${msg.attachments.map((att) => `<span class="attachment-chip"><span class="att-icon">📎</span> ${esc(att)}</span>`).join('')}
      </div>
    ` : ''}
  `;

  // Detail panel
  const fields = [
    ['Email', sender.email],
    ['ФИО', sender.fullName],
    ['Должность', sender.position],
    ['Компания', sender.companyName],
    ['Сайт', sender.website],
    ['Гор. телефон', sender.cityPhone],
    ['Моб. телефон', sender.mobilePhone],
    ['ИНН', sender.inn],
    ['Реквизиты', sender.legalCardAttached ? 'Приложены' : null]
  ];

  const leadFields = [
    ['Тип запроса', lead.requestType],
    ['Бренды', formatArr(a.detectedBrands || lead.detectedBrands)],
    ['Артикулы', formatArr(lead.articles)],
    ['Позиций', lead.totalPositions],
    ['Фото шильдика', lead.hasNameplatePhotos ? 'Да' : null],
    ['Фото артикула', lead.hasArticlePhotos ? 'Да' : null]
  ];

  const crmFields = [
    ['Юрлицо найдено', crm.isExistingCompany ? 'Да' : 'Нет'],
    ['Компания CRM', crm.company?.legalName],
    ['МОП', crm.curatorMop],
    ['МОЗ', crm.curatorMoz],
    ['Уточнение', crm.needsClarification ? 'Требуется' : 'Нет']
  ];

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
      ${lead.lineItems?.length ? `
        <div style="margin-top:8px;">
          <table class="data-table" style="font-size:11px;">
            <thead><tr><th>Артикул</th><th>Кол-во</th><th>Ед.</th></tr></thead>
            <tbody>${lead.lineItems.map((li) => `<tr><td>${esc(li.article)}</td><td>${li.quantity}</td><td>${esc(li.unit)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      ` : ''}
    </div>

    <div class="detail-section">
      <div class="detail-section-title">CRM</div>
      ${crmFields.filter(([,v]) => v).map(([l,v]) => detailField(l, v)).join('')}
      ${crm.actions?.length ? `
        <div style="margin-top:8px;">
          ${crm.actions.map((action) => `<div style="font-size:11px;color:var(--text-secondary);padding:3px 0;">→ ${esc(action)}</div>`).join('')}
        </div>
      ` : ''}
    </div>

    ${rules.length ? `
      <div class="detail-section">
        <div class="detail-section-title">Правила детекции</div>
        ${rules.map((r) => `
          <div style="font-size:11px;padding:3px 0;display:flex;gap:6px;align-items:center;">
            <span class="badge ${r.classifier === 'spam' ? 'badge-spam' : r.classifier === 'client' ? 'badge-client' : 'badge-vendor'}" style="font-size:9px;">${esc(r.classifier)}</span>
            <span style="color:var(--text-muted);font-family:'JetBrains Mono',monospace;font-size:10px;">${esc(r.scope)}: ${esc(truncate(r.pattern, 30))}</span>
            <span style="color:var(--green);font-size:10px;font-weight:600;margin-left:auto;">+${r.weight}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="detail-actions">
      ${crm.isExistingCompany === false ? '<button class="btn btn-primary btn-sm" style="width:100%">Создать клиента в CRM</button>' : ''}
      ${cls.label === 'Клиент' ? '<button class="btn btn-success btn-sm" style="width:100%">Создать запрос в CRM</button>' : ''}
      ${crm.needsClarification ? '<button class="btn btn-ghost btn-sm" style="width:100%">Запросить реквизиты</button>' : ''}
    </div>
  `;
}

function renderRunnerKpis() {
  const project = getProject();
  const latestRun = project?.recentRuns?.[0] || {};
  const kpis = [
    { label: 'Ящиков', value: latestRun.accountCount ?? '—', cls: 'accent' },
    { label: 'Получено', value: latestRun.fetchedEmailCount ?? allRunnerMessages.length, cls: '' },
    { label: 'Разобрано', value: latestRun.totalMessages ?? allRunnerMessages.length, cls: '' },
    { label: 'Спам', value: latestRun.spamCount ?? allRunnerMessages.filter((m) => m.pipelineStatus === 'ignored_spam').length, cls: 'rose' },
    { label: 'Уточнение', value: latestRun.clarificationCount ?? 0, cls: 'amber' },
    { label: 'CRM-готовых', value: latestRun.readyForCrmCount ?? 0, cls: 'green' }
  ];

  $('#runner-kpi-grid').innerHTML = kpis.map((k) => `
    <div class="kpi-card">
      <div class="kpi-label">${esc(k.label)}</div>
      <div class="kpi-value ${k.cls}">${esc(k.value)}</div>
    </div>
  `).join('');
}

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
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
      ${classificationBadge(cls.label)}
      ${cls.confidence != null ? `<div class="confidence-bar" style="width:120px">${renderConfBar(cls.confidence)}</div>` : ''}
      ${statusBadge(data.intakeFlow?.requestType || '')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <div class="detail-section-title" style="margin-bottom:8px;">Отправитель</div>
        ${[['Email', sender.email], ['ФИО', sender.fullName], ['Должность', sender.position], ['Компания', sender.companyName], ['Сайт', sender.website], ['Гор.', sender.cityPhone], ['Моб.', sender.mobilePhone], ['ИНН', sender.inn]].filter(([,v]) => v).map(([l,v]) => detailField(l, v)).join('')}
      </div>
      <div>
        <div class="detail-section-title" style="margin-bottom:8px;">CRM</div>
        ${[['Юрлицо', crm.isExistingCompany ? crm.company?.legalName || 'Найдено' : 'Не найдено'], ['МОП', crm.curatorMop], ['МОЗ', crm.curatorMoz], ['Уточнение', crm.needsClarification ? 'Да' : 'Нет']].filter(([,v]) => v).map(([l,v]) => detailField(l, v)).join('')}
        ${crm.actions?.length ? crm.actions.map((a) => `<div style="font-size:11px;color:var(--text-secondary);padding:2px 0;">→ ${esc(a)}</div>`).join('') : ''}
      </div>
    </div>

    ${lead.lineItems?.length ? `
      <div style="margin-top:16px;">
        <div class="detail-section-title" style="margin-bottom:8px;">Позиции заявки</div>
        <table class="data-table" style="font-size:12px;">
          <thead><tr><th>Артикул</th><th>Кол-во</th><th>Ед.</th><th>Описание</th></tr></thead>
          <tbody>${lead.lineItems.map((li) => `<tr><td><strong>${esc(li.article)}</strong></td><td>${li.quantity}</td><td>${esc(li.unit)}</td><td style="color:var(--text-muted);font-size:11px;">${esc(truncate(li.descriptionRu, 60))}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    ` : ''}

    ${rules.length ? `
      <div style="margin-top:16px;">
        <div class="detail-section-title" style="margin-bottom:8px;">Совпавшие правила</div>
        ${rules.map((r) => `
          <div style="font-size:11px;padding:3px 0;display:flex;gap:6px;align-items:center;">
            <span class="badge ${r.classifier === 'spam' ? 'badge-spam' : r.classifier === 'client' ? 'badge-client' : 'badge-vendor'}" style="font-size:9px;">${esc(r.classifier)}</span>
            <span style="color:var(--text-muted);font-family:'JetBrains Mono',monospace;font-size:10px;">${esc(r.scope)}: ${esc(truncate(r.pattern, 40))}</span>
            <span style="color:var(--green);font-weight:600;margin-left:auto;">+${r.weight}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${crm.suggestedReply ? `
      <div style="margin-top:16px;">
        <div class="detail-section-title" style="margin-bottom:8px;">Предложенный ответ</div>
        <div style="background:var(--surface-0);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;font-size:12px;white-space:pre-wrap;color:var(--text-secondary);">${esc(crm.suggestedReply)}</div>
      </div>
    ` : ''}
  `;
}

function renderKb() {
  const container = $('#kb-content');
  if (!kbData) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📚</div><h4>Загрузка...</h4></div>';
    return;
  }

  if (kbTab === 'stats') {
    const s = kbData.stats || {};
    container.innerHTML = `<div style="padding:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">
      ${[['Правил', s.ruleCount], ['Brand aliases', s.brandAliasCount], ['Профилей', s.senderProfileCount], ['Паттернов полей', s.fieldPatternCount], ['Корпус писем', s.corpusCount]].map(([l,v]) => `
        <div class="kpi-card"><div class="kpi-label">${esc(l)}</div><div class="kpi-value accent">${v ?? '—'}</div></div>
      `).join('')}
    </div>`;
    return;
  }

  if (kbTab === 'rules') {
    const rules = kbData.rules || [];
    container.innerHTML = `<table class="data-table"><thead><tr><th>ID</th><th>Scope</th><th>Classifier</th><th>Тип</th><th>Паттерн</th><th>Вес</th><th>Заметки</th></tr></thead>
      <tbody>${rules.map((r) => `<tr>
        <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${r.id}</td>
        <td><span class="badge badge-unknown">${esc(r.scope)}</span></td>
        <td>${classificationBadge(r.classifier === 'client' ? 'Клиент' : r.classifier === 'spam' ? 'СПАМ' : 'Поставщик услуг')}</td>
        <td style="font-size:11px;">${esc(r.match_type)}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:10px;max-width:300px;overflow:hidden;text-overflow:ellipsis;" title="${esc(r.pattern)}">${esc(truncate(r.pattern, 50))}</td>
        <td><strong>${r.weight}</strong></td>
        <td style="font-size:11px;color:var(--text-muted);">${esc(r.notes || '')}</td>
      </tr>`).join('')}</tbody></table>`;
    return;
  }

  if (kbTab === 'brands') {
    const brands = kbData.brandAliases || [];
    container.innerHTML = `<table class="data-table"><thead><tr><th>Бренд</th><th>Alias</th><th>ID</th></tr></thead>
      <tbody>${brands.map((b) => `<tr>
        <td><strong>${esc(b.canonical_brand)}</strong></td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:12px;">${esc(b.alias)}</td>
        <td style="color:var(--text-muted);font-size:11px;">${b.id}</td>
      </tr>`).join('')}</tbody></table>`;
    return;
  }

  if (kbTab === 'senders') {
    const senders = kbData.senderProfiles || [];
    container.innerHTML = senders.length
      ? `<table class="data-table"><thead><tr><th>Email</th><th>Домен</th><th>Класс</th><th>Компания</th><th>Бренд</th></tr></thead>
        <tbody>${senders.map((s) => `<tr>
          <td style="font-size:12px;">${esc(s.sender_email || '—')}</td>
          <td style="font-size:12px;">${esc(s.sender_domain || '—')}</td>
          <td>${classificationBadge(s.classification)}</td>
          <td>${esc(s.company_hint || '—')}</td>
          <td>${esc(s.brand_hint || '—')}</td>
        </tr>`).join('')}</tbody></table>`
      : '<div class="empty-state" style="padding:32px"><h4>Нет профилей</h4><p>Добавьте через API POST /api/detection-kb/sender-profiles</p></div>';
  }
}

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════

function getProject() {
  return projects.find((p) => p.id === selectedProjectId) || null;
}

function isRunner(p) {
  return ['tender-importer', 'mailbox-file-parser'].includes(p?.type);
}

function updateWorkspaceForProject() {
  const p = getProject();
  const runner = isRunner(p);
  $('#reset-row').style.display = p?.type === 'tender-importer' ? '' : 'none';
  $('#runner-run-btn').textContent = runner ? `Запустить ${p?.name || 'runner'}` : 'Запустить';

  if (p?.schedule) {
    const sf = $('#schedule-form');
    sf.elements.enabled.checked = Boolean(p.schedule.enabled);
    sf.elements.time.value = p.schedule.time || '12:00';
    sf.elements.timezone.value = p.schedule.timezone || 'Europe/Moscow';
    sf.elements.days.value = String(p.schedule.days || 1);
  }
}

function findProjectName(run) {
  for (const p of projects) {
    if ((p.recentRuns || []).some((r) => r.id === run.id)) return p.name;
  }
  return '—';
}

function mid(m) { return m.messageKey || m.id; }

function classificationBadge(label) {
  const map = {
    'Клиент': 'badge-client', 'client': 'badge-client',
    'СПАМ': 'badge-spam', 'spam': 'badge-spam',
    'Поставщик услуг': 'badge-vendor', 'vendor': 'badge-vendor',
  };
  return `<span class="badge ${map[label] || 'badge-unknown'}">${esc(label || 'Не определено')}</span>`;
}

function statusBadge(status) {
  const labels = {
    ready_for_crm: 'CRM-готово', needs_clarification: 'Уточнение',
    review: 'Проверка', ignored_spam: 'Спам', fetch_error: 'Ошибка',
    'Монобрендовая': 'Монобренд', 'Мультибрендовая': 'Мультибренд'
  };
  const cls = {
    ready_for_crm: 'badge-ready', needs_clarification: 'badge-review',
    review: 'badge-review', ignored_spam: 'badge-spam', fetch_error: 'badge-error'
  };
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
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatArr(items) {
  return Array.isArray(items) && items.length ? items.join(', ') : null;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '...' : s;
}

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
