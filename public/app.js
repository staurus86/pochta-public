// ═══════════════════════════════════════════════════════
//  Pochta Platform — Premium Dashboard SPA
// ═══════════════════════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const FREE_DOMAINS = new Set(['gmail.com','mail.ru','bk.ru','list.ru','inbox.ru','yandex.ru','ya.ru','hotmail.com','outlook.com','icloud.com','me.com','live.com','yahoo.com','rambler.ru','ro.ru','autorambler.ru','myrambler.ru','lenta.ru','aol.com','protonmail.com','proton.me','zoho.com']);
function isFreeDomain(domain) { return FREE_DOMAINS.has((domain || '').toLowerCase()); }

const projectSelect = $('#project-select');
const pageTitle = $('#page-title');
const inboxBadge = $('#inbox-badge');

// IDs проектов (из projects.json defaults)
const P2_ID = 'project-2-tender-parser';
const P3_ID = 'project-3-mailbox-file';
const P4_ID = 'project-4-klvrt-mail';
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
let selectedMsgKeys = new Set();
let inboxSearch = '';
let inboxSort = 'date-desc';
let inboxMailboxFilter = '';
let inboxAttachmentFilter = '';
let inboxPage = 0;
const INBOX_PAGE_SIZE = 50;
let autoRefreshInterval = null;
let autoRefreshSec = 0;
let readMessages = new Set(JSON.parse(localStorage.getItem('pochta_read') || '[]'));

await init();

async function init() {
  setupNavigation();
  setupForms();
  await refreshProjects();
  await Promise.all([refreshKb(), refreshAllMailboxMessages()]);
  // Re-render dashboard now that messages are loaded
  renderDashboard();
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
    project4: 'Project 4 — Klvrt Mail',
    projects: 'Все проекты',
    kb: 'База знаний',
    'api-docs': 'API Documentation'
  };
  pageTitle.textContent = titles[page] || 'Pochta';

  if (page === 'inbox') refreshAllMailboxMessages();
  if (page === 'project2') refreshP2();
  if (page === 'project3') refreshP3();
  if (page === 'project4') refreshP4();
  if (page === 'api-docs') refreshApiDocsHealth();
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
    await startMailboxJob(P2_ID, {
      days: Number(fd.get('days') || 1),
      maxEmails: Number(fd.get('maxEmails') || 100),
      reset: fd.get('reset') === 'on'
    }, btn, 'Запустить Tender Parser', '#p2-runtime-result', () => renderP2Kpis());
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
    await startMailboxJob(P3_ID, {
      days: Number(fd.get('days') || 1),
      maxEmails: Number(fd.get('maxEmails') || 100)
    }, btn, 'Получить и разобрать письма', '#p3-runtime-result');
    renderP3Kpis();
  });

  $('#p3-reprocess-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = $('#p3-reprocess-btn');
    btn.disabled = true;
    await startMailboxJob(P3_ID, {
      limit: Number(fd.get('limit') || 500),
      status: String(fd.get('status') || ''),
      preserveStatus: fd.get('preserveStatus') === 'on'
    }, btn, 'Переразобрать сохранённые письма', '#p3-runtime-result', null, 'reprocess');
    renderP3Kpis();
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

  // ═══ PROJECT 4 ═══
  $('#p4-run-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = $('#p4-run-btn');
    btn.disabled = true;
    await startMailboxJob(P4_ID, {
      days: Number(fd.get('days') || 1),
      maxEmails: Number(fd.get('maxEmails') || 100)
    }, btn, 'Получить и разобрать письма', '#p4-runtime-result');
  });

  $('#p4-schedule-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await fetch(`/api/projects/${P4_ID}/schedule`, {
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
    renderP4Schedule();
  });

  $('#p4-refresh-runtime')?.addEventListener('click', () => refreshP4Runtime());

  // ═══ INBOX actions ═══
  $('#inbox-fetch-btn').addEventListener('click', async () => {
    const btn = $('#inbox-fetch-btn');
    btn.disabled = true;
    $('#inbox-status-text').textContent = 'Подключение к почтовым ящикам...';
    const resetLabel = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Получить письма';
    let totalFetched = 0, totalCrm = 0, totalSpam = 0;
    // Run P3 and P4 sequentially
    await startMailboxJob(P3_ID, { days: 1, maxEmails: 100 }, null, null, null, (run) => {
      if (run) { totalFetched += run.fetchedEmailCount || 0; totalCrm += run.readyForCrmCount || 0; totalSpam += run.spamCount || 0; }
    });
    await startMailboxJob(P4_ID, { days: 1, maxEmails: 100 }, null, null, null, (run) => {
      if (run) { totalFetched += run.fetchedEmailCount || 0; totalCrm += run.readyForCrmCount || 0; totalSpam += run.spamCount || 0; }
    });
    btn.disabled = false;
    btn.innerHTML = resetLabel;
    $('#inbox-status-text').textContent = `Получено ${totalFetched} писем, CRM-готовых: ${totalCrm}, спам: ${totalSpam}`;
    await refreshAllMailboxMessages();
  });

  $('#inbox-delete-all-btn').addEventListener('click', async () => {
    if (!confirm('Удалить все письма из inbox? Это действие необратимо.')) return;
    await fetch(`/api/projects/${P3_ID}/messages`, { method: 'DELETE' });
    await fetch(`/api/projects/${P4_ID}/messages`, { method: 'DELETE' });
    await refreshAllMailboxMessages();
    await refreshProjects();
    $('#inbox-status-text').textContent = 'Все письма удалены.';
  });

  // ═══ Search & Sort & Filter ═══
  $('#inbox-search').addEventListener('input', (e) => { inboxSearch = e.target.value.toLowerCase(); inboxPage = 0; renderInbox(); });
  $('#inbox-sort').addEventListener('change', (e) => { inboxSort = e.target.value; renderInbox(); });
  $('#inbox-mailbox-filter').addEventListener('change', (e) => { inboxMailboxFilter = e.target.value; inboxPage = 0; renderInbox(); });
  $('#inbox-attachment-filter')?.addEventListener('change', (e) => { inboxAttachmentFilter = e.target.value; inboxPage = 0; renderInbox(); });
  $('#inbox-auto-refresh').addEventListener('change', (e) => {
    const sec = Number(e.target.value);
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    autoRefreshSec = sec;
    if (sec > 0) {
      autoRefreshInterval = setInterval(async () => {
        const oldCount = allRunnerMessages.length;
        await refreshAllMailboxMessages();
        const newCount = allRunnerMessages.length;
        if (newCount > oldCount) showToast(`+${newCount - oldCount} новых писем`);
      }, sec * 1000);
    }
  });

  // ═══ Bulk actions ═══
  $('#bulk-request-btn').addEventListener('click', () => bulkTrain('client'));
  $('#bulk-spam-btn').addEventListener('click', () => bulkTrain('spam'));
  $('#bulk-vendor-btn').addEventListener('click', () => bulkTrain('vendor'));
  $('#bulk-delete-btn').addEventListener('click', async () => {
    if (!confirm(`Удалить ${selectedMsgKeys.size} писем?`)) return;
    for (const key of selectedMsgKeys) {
      const msg = allRunnerMessages.find((m) => m.messageKey === key);
      const pid = msg?._projectId || P3_ID;
      await fetch(`/api/projects/${pid}/messages/${encodeURIComponent(key)}`, { method: 'DELETE' });
    }
    selectedMsgKeys.clear();
    await refreshAllMailboxMessages();
    await refreshProjects();
  });
  $('#bulk-clear-btn').addEventListener('click', () => { selectedMsgKeys.clear(); renderInbox(); });

  // ═══ CSV Export ═══
  $('#inbox-export-csv-btn').addEventListener('click', exportInboxCsv);
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

async function refreshAllMailboxMessages() {
  showProgress(true);
  try {
    const [r3, r4] = await Promise.all([
      fetch(`/api/projects/${P3_ID}/messages`).then((r) => r.json()).catch(() => ({ messages: [] })),
      fetch(`/api/projects/${P4_ID}/messages`).then((r) => r.json()).catch(() => ({ messages: [] }))
    ]);
    const p3msgs = (r3.messages || []).map((m) => ({ ...m, _projectId: P3_ID }));
    const p4msgs = (r4.messages || []).map((m) => ({ ...m, _projectId: P4_ID }));
    allRunnerMessages = [...p3msgs, ...p4msgs].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } catch {
    allRunnerMessages = [];
  }
  showProgress(false);

  // Compute filtered lists
  runnerMessages = filterInboxMessages(inboxTab);

  if (!runnerMessages.some((m) => mid(m) === selectedMessageId)) {
    selectedMessageId = runnerMessages[0] ? mid(runnerMessages[0]) : null;
  }

  // Update badge with non-spam count
  const nonSpam = allRunnerMessages.filter((m) => m.pipelineStatus !== 'ignored_spam' && m.pipelineStatus !== 'fetch_error');
  inboxBadge.textContent = nonSpam.length;
  updateInboxTabCounts();
  updateMailboxFilter();
  renderSidebarStats();
  renderInbox();
}

// Alias for backward compatibility
async function refreshP3Messages() {
  await refreshAllMailboxMessages();
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
  let msgs;
  if (tab === 'requests') msgs = allRunnerMessages.filter(isRequest);
  else if (tab === 'moderation') msgs = allRunnerMessages.filter(isModeration);
  else if (tab === 'spam') msgs = allRunnerMessages.filter(isSpam);
  else msgs = allRunnerMessages.filter((m) => m.pipelineStatus !== 'fetch_error');

  // Mailbox filter
  if (inboxMailboxFilter) {
    msgs = msgs.filter((m) => m.mailbox === inboxMailboxFilter);
  }

  // Attachment filter
  if (inboxAttachmentFilter) {
    const af = inboxAttachmentFilter;
    if (af === 'has') msgs = msgs.filter((m) => m.attachments?.length > 0);
    else if (af === 'none') msgs = msgs.filter((m) => !m.attachments?.length);
    else if (af === 'pdf') msgs = msgs.filter((m) => m.attachments?.some((a) => /\.pdf$/i.test(a)));
    else if (af === 'xls') msgs = msgs.filter((m) => m.attachments?.some((a) => /\.xlsx?$/i.test(a)));
    else if (af === 'doc') msgs = msgs.filter((m) => m.attachments?.some((a) => /\.docx?$/i.test(a)));
    else if (af === 'img') msgs = msgs.filter((m) => m.attachments?.some((a) => /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i.test(a)));
  }

  // Search
  if (inboxSearch) {
    msgs = msgs.filter((m) => {
      const haystack = [m.subject, m.from, m.mailbox, m.analysis?.sender?.email, m.analysis?.sender?.companyName, m.bodyPreview].join(' ').toLowerCase();
      return haystack.includes(inboxSearch);
    });
  }

  // Sort
  msgs = [...msgs];
  if (inboxSort === 'date-asc') msgs.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  else if (inboxSort === 'confidence-asc') msgs.sort((a, b) => (a.analysis?.classification?.confidence || 0) - (b.analysis?.classification?.confidence || 0));
  else if (inboxSort === 'confidence-desc') msgs.sort((a, b) => (b.analysis?.classification?.confidence || 0) - (a.analysis?.classification?.confidence || 0));
  else if (inboxSort === 'mailbox') msgs.sort((a, b) => (a.mailbox || '').localeCompare(b.mailbox || ''));
  else msgs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  return msgs;
}

function updateInboxTabCounts() {
  const all = allRunnerMessages.filter((m) => m.pipelineStatus !== 'fetch_error');
  $('#tab-count-all').textContent = all.length;
  $('#tab-count-requests').textContent = allRunnerMessages.filter(isRequest).length;
  $('#tab-count-moderation').textContent = allRunnerMessages.filter(isModeration).length;
  $('#tab-count-spam').textContent = allRunnerMessages.filter(isSpam).length;
}

function updateMailboxFilter() {
  const mailboxes = [...new Set(allRunnerMessages.map((m) => m.mailbox).filter(Boolean))].sort();
  const sel = $('#inbox-mailbox-filter');
  const prev = sel.value;
  sel.innerHTML = '<option value="">Все ящики (' + mailboxes.length + ')</option>' +
    mailboxes.map((mb) => {
      const count = allRunnerMessages.filter((m) => m.mailbox === mb).length;
      return `<option value="${esc(mb)}" ${mb === prev ? 'selected' : ''}>${esc(mb.split('@')[0])} (${count})</option>`;
    }).join('');
  inboxMailboxFilter = sel.value;
}

function markAsRead(msgId) {
  if (!readMessages.has(msgId)) {
    readMessages.add(msgId);
    try { localStorage.setItem('pochta_read', JSON.stringify([...readMessages].slice(-500))); } catch {}
  }
}

async function refreshP2() {
  renderP2Kpis();
  renderP2Schedule();
  await refreshP2Runtime();
}

async function refreshP3() {
  await refreshAllMailboxMessages();
  renderP3Kpis();
  renderP3Schedule();
  await refreshP3Runtime();
}

async function refreshP4() {
  await refreshAllMailboxMessages();
  renderP4Kpis();
  renderP4Schedule();
  await refreshP4Runtime();
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

async function refreshP4Runtime() {
  try {
    const res = await fetch(`/api/projects/${P4_ID}/runtime`);
    const data = await res.json();
    $('#p4-runtime-result').textContent = JSON.stringify(data.runtime || data, null, 2);
  } catch { $('#p4-runtime-result').textContent = 'Ошибка загрузки.'; }
}

async function refreshKb() {
  try {
    const res = await fetch('/api/detection-kb');
    kbData = await res.json();
  } catch { kbData = null; }
  renderKb();
}

// ═══ Generic async job launcher with polling & timer ═══
async function startMailboxJob(projectId, payload, btn, resetLabel, runtimeEl, onDone, action = 'run') {
  let timerEl = null;
  let timerInterval = null;
  if (btn) {
    timerEl = createJobTimerFor(projectId);
    let elapsed = 0;
    timerInterval = setInterval(() => {
      elapsed++;
      timerEl.textContent = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
      timerEl.style.display = 'inline-block';
      if (btn) btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;"></div> Выполняется... ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
    }, 1000);
  }

  try {
    const res = await fetch(`/api/projects/${projectId}/${action}`, {
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
          const jr = await fetch(`/api/projects/${projectId}/job/${jobId}`);
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
      if (runtimeEl) $(runtimeEl).textContent = JSON.stringify(data.run || data, null, 2);
      if (onDone) onDone(data.run);
    }
  } catch (err) {
    if (runtimeEl) $(runtimeEl).textContent = 'Ошибка: ' + err.message;
    if (onDone) onDone(null);
  }

  if (timerInterval) clearInterval(timerInterval);
  if (timerEl) timerEl.style.display = 'none';
  if (btn) { btn.disabled = false; btn.innerHTML = resetLabel; }
  await refreshProjects();
  await refreshAllMailboxMessages();
}

// Backward-compat wrapper
async function startP3Job(payload, btn, resetLabel, runtimeEl, onDone) {
  await startMailboxJob(P3_ID, payload, btn, resetLabel, runtimeEl, onDone);
  renderP3Kpis();
}

function createJobTimerFor(projectId) {
  const suffix = projectId === P2_ID ? 'p2' : projectId === P4_ID ? 'p4' : 'p3';
  const existing = $(`#${suffix}-job-timer`);
  if (existing) return existing;
  const el = document.createElement('span');
  el.id = `${suffix}-job-timer`;
  el.className = 'badge badge-system';
  el.style.cssText = 'display:none;margin-left:8px;font-family:"JetBrains Mono",monospace;font-size:12px;';
  const pageId = projectId === P2_ID ? '#page-project2' : projectId === P4_ID ? '#page-project4' : '#page-project3';
  const header = document.querySelector(`${pageId} .panel-header`) || document.body;
  header.appendChild(el);
  return el;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function deleteMessage(messageKey) {
  const msg = allRunnerMessages.find((m) => m.messageKey === messageKey);
  const pid = msg?._projectId || P3_ID;
  await fetch(`/api/projects/${pid}/messages/${encodeURIComponent(messageKey)}`, { method: 'DELETE' });
  await refreshAllMailboxMessages();
  await refreshProjects();
}

// ═══ Bulk actions ═══
function updateBulkBar() {
  const bar = $('#bulk-actions');
  if (selectedMsgKeys.size > 0) {
    bar.style.display = 'flex';
    bar.style.alignItems = 'center';
    bar.style.gap = '6px';
    $('#bulk-count').textContent = `${selectedMsgKeys.size} выбрано`;
  } else {
    bar.style.display = 'none';
  }
}

async function bulkTrain(classification) {
  const statusMap = { client: 'ready_for_crm', spam: 'ignored_spam', vendor: 'review' };
  const label = { client: 'заявка', spam: 'спам', vendor: 'поставщик' }[classification];
  if (!confirm(`Пометить ${selectedMsgKeys.size} писем как "${label}"?`)) return;

  for (const key of selectedMsgKeys) {
    const m = allRunnerMessages.find((msg) => mid(msg) === key);
    if (m) {
      m.pipelineStatus = statusMap[classification];
      const pid = m._projectId || P3_ID;
      fetch(`/api/projects/${pid}/messages/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineStatus: statusMap[classification] })
      });
    }
  }
  selectedMsgKeys.clear();
  showToast(`${label}: готово`);
  renderInbox();
}

// ═══ CSV Export ═══
function exportInboxCsv() {
  const rows = [['Дата', 'От', 'Ящик', 'Тема', 'Статус', 'Категория', 'Confidence', 'Компания', 'ИНН', 'Телефон', 'Бренды', 'Артикулы']];
  for (const m of runnerMessages) {
    const a = m.analysis || {};
    const s = a.sender || {};
    const l = a.lead || {};
    rows.push([
      m.createdAt || '', m.from || s.email || '', m.mailbox || '', m.subject || '',
      m.pipelineStatus || '', a.classification?.label || '', a.classification?.confidence || '',
      s.companyName || '', s.inn || '', s.cityPhone || s.mobilePhone || '',
      (a.detectedBrands || []).join('; '), (l.articles || []).join('; ')
    ]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pochta-inbox-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Экспортировано ${runnerMessages.length} писем`);
}

// ═══ Copy to clipboard ═══
window.__copyField = (text) => {
  navigator.clipboard.writeText(text).then(() => showToast('Скопировано')).catch(() => {});
};

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
    const shortName = mb.includes('@') ? mb.split('@')[1].split('.')[0] : mb;
    return `<div class="heatmap-cell ${cls}"><div class="cell-name" title="${esc(mb)}">${esc(shortName)}</div><div class="cell-value">${data.count}</div></div>`;
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

  // ═══ Funnel chart ═══
  const totalMsg = allRunnerMessages.length;
  const nonSpamMsg = allRunnerMessages.filter((m) => m.pipelineStatus !== 'ignored_spam' && m.pipelineStatus !== 'fetch_error').length;
  const funnelData = [
    { label: 'Получено', value: totalMsg, color: 'var(--accent)' },
    { label: 'Не спам', value: nonSpamMsg, color: 'var(--text)' },
    { label: 'Заявки', value: readyCount, color: 'var(--green)' },
    { label: 'Уточнение', value: clarifyCount, color: 'var(--amber)' },
    { label: 'Спам', value: spamCount, color: 'var(--rose)' }
  ];
  const funnelMax = Math.max(1, totalMsg);
  $('#funnel-chart').innerHTML = funnelData.map((f) => {
    const pct = Math.round(f.value / funnelMax * 100);
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <span style="width:80px;font-size:11px;color:var(--text-secondary);text-align:right;">${f.label}</span>
      <div style="flex:1;height:24px;background:var(--surface-0);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${f.color};border-radius:4px;transition:width 0.3s;min-width:${f.value > 0 ? '2px' : '0'};display:flex;align-items:center;justify-content:flex-end;padding-right:6px;">
          ${pct > 15 ? `<span style="font-size:10px;font-weight:700;color:#fff;">${f.value}</span>` : ''}
        </div>
      </div>
      ${pct <= 15 ? `<span style="font-size:11px;font-weight:600;color:${f.color};">${f.value}</span>` : ''}
    </div>`;
  }).join('');

  // ═══ Bar chart by day ═══
  const dayMap = new Map();
  allRunnerMessages.forEach((m) => {
    const day = (m.createdAt || '').slice(0, 10);
    if (day) dayMap.set(day, (dayMap.get(day) || 0) + 1);
  });
  const days = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const maxDay = Math.max(1, ...days.map((d) => d[1]));
  if (days.length === 0) {
    $('#day-chart').innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;width:100%;">Нет данных</div>';
  } else {
    $('#day-chart').innerHTML = days.map(([day, count]) => {
      const h = Math.max(4, Math.round(count / maxDay * 120));
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
        <span style="font-size:10px;font-weight:600;color:var(--accent);">${count}</span>
        <div style="width:100%;max-width:32px;height:${h}px;background:var(--accent);border-radius:4px 4px 0 0;opacity:${0.4 + count / maxDay * 0.6};"></div>
        <span style="font-size:9px;color:var(--text-muted);writing-mode:vertical-lr;transform:rotate(180deg);max-height:50px;overflow:hidden;">${day.slice(5)}</span>
      </div>`;
    }).join('');
  }

  // ═══ Top senders ═══
  const senderMap = new Map();
  allRunnerMessages.filter((m) => m.pipelineStatus !== 'ignored_spam').forEach((m) => {
    const email = m.analysis?.sender?.email || m.from || 'unknown';
    const domain = email.split('@')[1] || email;
    senderMap.set(domain, (senderMap.get(domain) || 0) + 1);
  });
  const topSenders = [...senderMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  $('#top-senders').innerHTML = topSenders.length ? `<table class="data-table"><tbody>${topSenders.map(([domain, count]) =>
    `<tr><td style="font-family:'JetBrains Mono',monospace;font-size:11px;">@${esc(domain)}</td><td style="text-align:right;font-weight:700;color:var(--accent);">${count}</td></tr>`
  ).join('')}</tbody></table>` : '<div style="padding:20px;color:var(--text-muted);font-size:12px;text-align:center;">Нет данных</div>';

  // ═══ Brand stats ═══
  const brandMap = new Map();
  allRunnerMessages.forEach((m) => {
    (m.analysis?.detectedBrands || []).forEach((b) => brandMap.set(b, (brandMap.get(b) || 0) + 1));
  });
  const topBrands = [...brandMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  $('#brand-stats').innerHTML = topBrands.length ? topBrands.map(([brand, count]) =>
    `<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:8px 14px;display:flex;gap:8px;align-items:center;">
      <span style="font-weight:600;font-size:12px;">${esc(brand)}</span>
      <span style="font-size:11px;color:var(--accent);font-weight:700;">${count}</span>
    </div>`
  ).join('') : '<div style="color:var(--text-muted);font-size:12px;">Нет данных о брендах</div>';

  // ═══ Request Analytics ═══
  renderRequestAnalytics();
}

function renderRequestAnalytics() {
  const requests = allRunnerMessages.filter((m) => m.pipelineStatus === 'ready_for_crm' || m.pipelineStatus === 'needs_clarification');

  // Collect brands
  const brandCount = new Map();
  // Collect articles
  const articleCount = new Map();
  // Collect companies (customers)
  const companyCount = new Map();
  // Collect request types
  const typeCount = new Map();
  // Collect attachment types
  const attTypeCount = new Map();
  // Totals
  let totalPositions = 0;

  requests.forEach((m) => {
    const a = m.analysis;
    if (!a) return;

    // Brands
    (a.detectedBrands || a.lead?.detectedBrands || []).forEach((b) => {
      brandCount.set(b, (brandCount.get(b) || 0) + 1);
    });

    // Articles
    const arts = a.lead?.articles || [];
    const items = a.lead?.lineItems || [];
    arts.forEach((art) => articleCount.set(art, (articleCount.get(art) || 0) + 1));
    items.forEach((item) => {
      if (item.article && !arts.includes(item.article)) {
        articleCount.set(item.article, (articleCount.get(item.article) || 0) + 1);
      }
    });

    // Positions count
    totalPositions += a.lead?.totalPositions || items.length || arts.length || 0;

    // Company
    const company = a.sender?.companyName || a.crm?.company?.legalName;
    if (company) companyCount.set(company, (companyCount.get(company) || 0) + 1);

    // Request type
    const rtype = a.lead?.requestType || a.intakeFlow?.requestType || 'Не определено';
    typeCount.set(rtype, (typeCount.get(rtype) || 0) + 1);

    // Attachment types
    (a.lead?.attachmentHints || []).forEach((h) => {
      attTypeCount.set(h.type, (attTypeCount.get(h.type) || 0) + 1);
    });
  });

  // ═══ KPI cards ═══
  const reqKpis = [
    { label: 'Заявок', value: requests.length, cls: 'green' },
    { label: 'Уник. брендов', value: brandCount.size, cls: 'accent' },
    { label: 'Уник. артикулов', value: articleCount.size, cls: 'accent' },
    { label: 'Всего позиций', value: totalPositions, cls: '' },
    { label: 'Заказчиков', value: companyCount.size, cls: 'green' },
    { label: 'С вложениями', value: requests.filter((m) => m.attachments?.length > 0).length, cls: '' }
  ];
  $('#request-kpi-grid').innerHTML = reqKpis.map((k) => `
    <div class="kpi-card">
      <div class="kpi-label">${esc(k.label)}</div>
      <div class="kpi-value ${k.cls}">${esc(String(k.value))}</div>
    </div>
  `).join('');

  // ═══ Top customers ═══
  const topCustomers = [...companyCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const custMax = Math.max(1, topCustomers[0]?.[1] || 1);
  $('#top-customers').innerHTML = topCustomers.length ? `<table class="data-table"><tbody>${topCustomers.map(([name, count]) => {
    const pct = Math.round(count / custMax * 100);
    return `<tr><td style="font-size:11px;position:relative;">
      <div style="position:absolute;inset:0;background:var(--green);opacity:0.08;width:${pct}%;border-radius:3px;"></div>
      <span style="position:relative;">${esc(name)}</span>
    </td><td style="text-align:right;font-weight:700;color:var(--green);width:40px;">${count}</td></tr>`;
  }).join('')}</tbody></table>` : noData();

  // ═══ Top articles ═══
  const topArticles = [...articleCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const artMax = Math.max(1, topArticles[0]?.[1] || 1);
  $('#top-articles').innerHTML = topArticles.length ? `<table class="data-table"><tbody>${topArticles.map(([art, count]) => {
    const pct = Math.round(count / artMax * 100);
    return `<tr><td style="font-family:'JetBrains Mono',monospace;font-size:11px;position:relative;">
      <div style="position:absolute;inset:0;background:var(--accent);opacity:0.08;width:${pct}%;border-radius:3px;"></div>
      <span style="position:relative;">${esc(art)}</span>
    </td><td style="text-align:right;font-weight:700;color:var(--accent);width:40px;">${count}</td></tr>`;
  }).join('')}</tbody></table>` : noData();

  // ═══ Request types ═══
  const typeEntries = [...typeCount.entries()].sort((a, b) => b[1] - a[1]);
  const typeMax = Math.max(1, requests.length);
  const typeColors = { 'Монобрендовая': 'var(--green)', 'Мультибрендовая': 'var(--accent)', 'Не определено': 'var(--text-muted)' };
  $('#request-types-chart').innerHTML = typeEntries.length ? typeEntries.map(([type, count]) => {
    const pct = Math.round(count / typeMax * 100);
    const color = typeColors[type] || 'var(--text-secondary)';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <span style="width:110px;font-size:11px;color:var(--text-secondary);text-align:right;">${esc(type)}</span>
      <div style="flex:1;height:22px;background:var(--surface-0);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;min-width:${count > 0 ? '2px' : '0'};display:flex;align-items:center;justify-content:flex-end;padding-right:6px;">
          ${pct > 20 ? `<span style="font-size:10px;font-weight:700;color:#fff;">${count}</span>` : ''}
        </div>
      </div>
      ${pct <= 20 ? `<span style="font-size:11px;font-weight:600;color:${color};">${count}</span>` : ''}
    </div>`;
  }).join('') : noData();

  // ═══ Attachment types ═══
  const attEntries = [...attTypeCount.entries()].sort((a, b) => b[1] - a[1]);
  const attIcons = { request: '📋', requisites: '📄', pricelist: '💰', photo: '📷', document: '📁', other: '📎' };
  const attLabels = { request: 'Заявка', requisites: 'Реквизиты', pricelist: 'Прайс', photo: 'Фото', document: 'Документ', other: 'Другое' };
  $('#attachment-types-chart').innerHTML = attEntries.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;">${attEntries.map(([type, count]) =>
    `<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:8px 14px;display:flex;gap:8px;align-items:center;">
      <span>${attIcons[type] || '📎'}</span>
      <span style="font-size:12px;">${esc(attLabels[type] || type)}</span>
      <span style="font-size:11px;color:var(--accent);font-weight:700;">${count}</span>
    </div>`
  ).join('')}</div>` : noData();
}

function noData() {
  return '<div style="padding:16px;color:var(--text-muted);font-size:12px;text-align:center;">Нет данных</div>';
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

// ═══ Sidebar stats ═══
function renderSidebarStats() {
  const total = allRunnerMessages.length;
  const spam = allRunnerMessages.filter((m) => m.pipelineStatus === 'ignored_spam').length;
  const ready = allRunnerMessages.filter((m) => m.pipelineStatus === 'ready_for_crm').length;
  const clarify = allRunnerMessages.filter((m) => m.pipelineStatus === 'needs_clarification').length;
  const unread = allRunnerMessages.filter((m) => !readMessages.has(mid(m))).length;

  const el = $('#sidebar-stats');
  if (el) {
    el.innerHTML = `
      <div class="sidebar-stat"><span>Всего писем</span><span class="sidebar-stat-value">${total}</span></div>
      <div class="sidebar-stat"><span>Непрочитанных</span><span class="sidebar-stat-value" style="color:var(--accent);">${unread}</span></div>
      <div class="sidebar-stat"><span>CRM-готово</span><span class="sidebar-stat-value green">${ready}</span></div>
      <div class="sidebar-stat"><span>Уточнение</span><span class="sidebar-stat-value amber">${clarify}</span></div>
      <div class="sidebar-stat"><span>Спам</span><span class="sidebar-stat-value rose">${spam}</span></div>
    `;
  }
}

// ═══ Progress bar ═══
function showProgress(show) {
  const bar = $('#progress-bar');
  if (bar) bar.classList.toggle('active', show);
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

// ═══ P4 KPIs & Schedule ═══
function renderP4Kpis() {
  const p = getProject(P4_ID);
  const run = p?.recentRuns?.[0] || {};
  const kpis = [
    { label: 'Ящиков', value: run.accountCount ?? '—', cls: 'accent' },
    { label: 'Получено', value: run.fetchedEmailCount ?? '—', cls: '' },
    { label: 'Разобрано', value: run.totalMessages ?? '—', cls: '' },
    { label: 'Спам', value: run.spamCount ?? '—', cls: 'rose' },
    { label: 'Уточнение', value: run.clarificationCount ?? '—', cls: 'amber' },
    { label: 'CRM-готовых', value: run.readyForCrmCount ?? '—', cls: 'green' }
  ];
  $('#p4-kpi-grid').innerHTML = kpis.map((k) => `<div class="kpi-card"><div class="kpi-label">${esc(k.label)}</div><div class="kpi-value ${k.cls}">${esc(k.value)}</div></div>`).join('');
}

function renderP4Schedule() {
  const p = getProject(P4_ID);
  if (!p?.schedule) return;
  const sf = $('#p4-schedule-form');
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

  // Pagination
  const totalPages = Math.max(1, Math.ceil(runnerMessages.length / INBOX_PAGE_SIZE));
  if (inboxPage >= totalPages) inboxPage = totalPages - 1;
  if (inboxPage < 0) inboxPage = 0;
  const pageStart = inboxPage * INBOX_PAGE_SIZE;
  const pageMessages = runnerMessages.slice(pageStart, pageStart + INBOX_PAGE_SIZE);

  const pagEl = $('#inbox-pagination');
  if (runnerMessages.length > INBOX_PAGE_SIZE) {
    pagEl.innerHTML = `<button class="btn btn-ghost btn-sm" ${inboxPage <= 0 ? 'disabled' : ''} id="page-prev">&larr;</button>
      <span>${inboxPage + 1} / ${totalPages}</span>
      <span style="color:var(--text-muted);">(${runnerMessages.length} писем)</span>
      <button class="btn btn-ghost btn-sm" ${inboxPage >= totalPages - 1 ? 'disabled' : ''} id="page-next">&rarr;</button>`;
    $('#page-prev')?.addEventListener('click', () => { inboxPage--; renderInbox(); });
    $('#page-next')?.addEventListener('click', () => { inboxPage++; renderInbox(); });
  } else {
    pagEl.innerHTML = runnerMessages.length > 0 ? `<span style="color:var(--text-muted);">${runnerMessages.length} писем</span>` : '';
  }

  const emptyLabels = { all: 'Нет писем', requests: 'Нет заявок', moderation: 'Нет писем на модерации', spam: 'Нет спама' };
  if (runnerMessages.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><h4>${emptyLabels[inboxTab] || 'Нет писем'}</h4><p>Нажмите «Получить письма»</p></div>`;
    viewEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📬</div><h4>Выберите письмо</h4></div>';
    detailEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h4>Данные разбора</h4></div>';
    return;
  }

  const allChecked = pageMessages.length > 0 && pageMessages.every((m) => selectedMsgKeys.has(mid(m)));
  listEl.innerHTML = `<div class="select-all-wrap"><input type="checkbox" id="select-all-cb" ${allChecked ? 'checked' : ''} /><span>${pageMessages.length} на странице</span></div>` + pageMessages.map((m) => {
    const id = mid(m);
    const active = id === selectedMessageId ? 'active' : '';
    const checked = selectedMsgKeys.has(id) ? 'checked' : '';
    const isRead = readMessages.has(id);
    const a = m.analysis || {};
    const conf = a.classification?.confidence;
    return `<div class="message-item-wrap ${active}" data-mid="${esc(id)}">
      <label class="msg-checkbox" onclick="event.stopPropagation()"><input type="checkbox" ${checked} data-check-mid="${esc(id)}" /></label>
      <button class="message-item ${active}" data-mid="${esc(id)}">
        <div class="message-from">
          <span style="${isRead ? '' : 'font-weight:700;color:var(--text);'}">${!isRead ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-right:6px;"></span>' : ''}${esc(m.from || a.sender?.email || 'Неизвестный')}</span>
          <span class="message-time">${fmtDate(m.createdAt)}</span>
        </div>
        <div class="message-subject" style="${isRead ? '' : 'font-weight:600;color:var(--text);'}">${esc(m.subject || 'Без темы')}</div>
        <div class="message-meta">
          ${statusBadge(m.pipelineStatus)}
          ${conf != null ? confidenceBadge(conf) : ''}
          <span class="message-mailbox">${esc((m.mailbox || '').split('@')[0])}</span>
        </div>
      </button>
    </div>`;
  }).join('');

  // Select all handler
  const selectAllCb = listEl.querySelector('#select-all-cb');
  if (selectAllCb) {
    selectAllCb.addEventListener('change', () => {
      if (selectAllCb.checked) {
        pageMessages.forEach((m) => selectedMsgKeys.add(mid(m)));
      } else {
        pageMessages.forEach((m) => selectedMsgKeys.delete(mid(m)));
      }
      listEl.querySelectorAll('input[data-check-mid]').forEach((cb) => { cb.checked = selectAllCb.checked; });
      updateBulkBar();
    });
  }

  // Checkbox handlers
  listEl.querySelectorAll('input[data-check-mid]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedMsgKeys.add(cb.dataset.checkMid);
      else selectedMsgKeys.delete(cb.dataset.checkMid);
      updateBulkBar();
    });
  });

  // Click handlers
  listEl.querySelectorAll('.message-item').forEach((item) => {
    item.addEventListener('click', () => {
      selectedMessageId = item.dataset.mid;
      markAsRead(selectedMessageId);
      renderInbox();
    });
  });

  updateBulkBar();

  const msg = pageMessages.find((m) => mid(m) === selectedMessageId) || pageMessages[0];
  if (msg) {
    markAsRead(mid(msg));
    renderEmailView(msg, viewEl, detailEl);
  }
}

// ═══ Keyboard shortcuts for inbox ═══
document.addEventListener('keydown', (e) => {
  if (currentPage !== 'inbox') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  const idx = runnerMessages.findIndex((m) => mid(m) === selectedMessageId);

  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (idx < runnerMessages.length - 1) {
      const nextIdx = idx + 1;
      const nextPage = Math.floor(nextIdx / INBOX_PAGE_SIZE);
      if (nextPage !== inboxPage) inboxPage = nextPage;
      selectedMessageId = mid(runnerMessages[nextIdx]);
      markAsRead(selectedMessageId);
      renderInbox();
    }
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (idx > 0) {
      const prevIdx = idx - 1;
      const prevPage = Math.floor(prevIdx / INBOX_PAGE_SIZE);
      if (prevPage !== inboxPage) inboxPage = prevPage;
      selectedMessageId = mid(runnerMessages[prevIdx]);
      markAsRead(selectedMessageId);
      renderInbox();
    }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedMessageId) {
      window.__deleteMsg(selectedMessageId);
    }
  } else if (e.key === 'r') {
    refreshP3Messages();
  }
});

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
        <button class="btn btn-danger btn-sm" onclick="window.__deleteMsg('${escAttr(msgKey)}')" title="Удалить письмо" style="flex-shrink:0;">Удалить</button>
      </div>
      <div class="email-view-meta">
        <span><strong>От:</strong> ${esc(msg.from || sender.email)}</span>
        <span><strong>Ящик:</strong> ${esc(msg.mailbox)}</span>
        <span><strong>Дата:</strong> ${fmtDate(msg.createdAt)}</span>
      </div>
    </div>
    <div class="email-body-content" id="email-body-text" style="max-height:300px;overflow-y:auto;position:relative;white-space:pre-wrap;word-break:break-word;">${esc(msg.bodyPreview || lead.freeText || 'Нет текста')}</div>
    <button class="btn btn-ghost btn-sm" id="email-body-toggle" style="width:100%;margin-top:4px;">Показать полностью</button>
    ${msg.attachments?.length ? `<div class="attachment-list">${msg.attachments.map((att) => {
      const hints = lead.attachmentHints || [];
      const hint = hints.find((h) => h.name === att);
      const typeIcon = { request: '📋', requisites: '📄', pricelist: '💰', photo: '📷', document: '📁', other: '📎' };
      const attFile = (msg.attachmentFiles || []).find((f) => f.filename === att);
      const hasFile = attFile?.safeName;
      const attUrl = hasFile ? `/api/attachments/${encodeURIComponent(msgKey)}/${encodeURIComponent(att)}` : null;
      const sizeStr = attFile?.size ? ` (${formatFileSize(attFile.size)})` : '';
      if (attUrl) {
        return `<a href="${attUrl}" target="_blank" class="attachment-chip" style="text-decoration:none;cursor:pointer;" title="Открыть ${esc(att)}"><span class="att-icon">${typeIcon[hint?.type] || '📎'}</span> ${esc(att)}${sizeStr}</a>`;
      }
      return `<span class="attachment-chip"><span class="att-icon">${typeIcon[hint?.type] || '📎'}</span> ${esc(att)}${sizeStr}</span>`;
    }).join('')}</div>` : ''}
  `;

  // Toggle body expand/collapse
  const toggleBtn = viewEl.querySelector('#email-body-toggle');
  const bodyEl = viewEl.querySelector('#email-body-text');
  if (toggleBtn && bodyEl) {
    toggleBtn.addEventListener('click', () => {
      if (bodyEl.style.maxHeight === '300px') {
        bodyEl.style.maxHeight = 'none';
        toggleBtn.textContent = 'Свернуть';
      } else {
        bodyEl.style.maxHeight = '300px';
        toggleBtn.textContent = 'Показать полностью';
      }
    });
  }

  const fields = [['Email', sender.email], ['ФИО', sender.fullName], ['Должность', sender.position], ['Компания', sender.companyName], ['Сайт', sender.website], ['Гор. телефон', sender.cityPhone], ['Моб. телефон', sender.mobilePhone], ['ИНН', sender.inn], ['Реквизиты', sender.legalCardAttached ? 'Приложены' : null]];
  const leadFields = [['Тип запроса', lead.requestType], ['Бренды', formatArr(a.detectedBrands || lead.detectedBrands)], ['Артикулы', formatArr(lead.articles)], ['Позиций', lead.totalPositions], ['Фото шильдика', lead.hasNameplatePhotos ? 'Да' : null], ['Фото артикула', lead.hasArticlePhotos ? 'Да' : null]];
  const crmFields = [['Юрлицо найдено', crm.isExistingCompany ? 'Да' : 'Нет'], ['Компания CRM', crm.company?.legalName], ['МОП', crm.curatorMop], ['МОЗ', crm.curatorMoz], ['Уточнение', crm.needsClarification ? 'Требуется' : 'Нет']];

  try {
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
    <div class="detail-section">
      <div class="detail-section-title">Обучение классификатора</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
        <button class="btn btn-sm" style="background:var(--green-dim);color:var(--green);border:1px solid var(--green)" onclick="window.__trainSender('${escAttr(sender.email)}','client','${escAttr(sender.companyName || '')}','${escAttr(msgKey)}')">Это заявка</button>
        <button class="btn btn-sm" style="background:var(--rose-dim);color:var(--rose);border:1px solid var(--rose)" onclick="window.__trainSender('${escAttr(sender.email)}','spam','','${escAttr(msgKey)}')">Это спам</button>
        <button class="btn btn-sm" style="background:var(--purple-dim);color:var(--purple);border:1px solid var(--purple)" onclick="window.__trainSender('${escAttr(sender.email)}','vendor','${escAttr(sender.companyName || '')}','${escAttr(msgKey)}')">Поставщик</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
        <label class="form-check" style="font-size:11px;color:var(--text-muted);margin:0;">
          <input type="radio" name="train-scope-${esc(msgKey)}" value="domain" ${isFreeDomain((sender.email || '').split('@')[1] || '') ? '' : 'checked'} style="margin-right:4px;" />
          <span>Весь домен @${esc((sender.email || '').split('@')[1] || '')}</span>
        </label>
        <label class="form-check" style="font-size:11px;color:var(--text-muted);margin:0;">
          <input type="radio" name="train-scope-${esc(msgKey)}" value="email" ${isFreeDomain((sender.email || '').split('@')[1] || '') ? 'checked' : ''} style="margin-right:4px;" />
          <span>Только ${esc(sender.email || '')}</span>
        </label>
      </div>
      <div style="margin-bottom:8px;">
        <button class="btn btn-ghost btn-sm" style="width:100%" onclick="window.__showRuleForm('${escAttr(msgKey)}')">+ Добавить правило из этого письма</button>
      </div>
      <div id="rule-form-${esc(msgKey)}" style="display:none;">
        <div style="display:flex;gap:6px;margin-bottom:6px;">
          <select id="rule-scope-${esc(msgKey)}" class="form-select" style="font-size:11px;padding:4px 8px;flex:1">
            <option value="body">body</option>
            <option value="subject">subject</option>
            <option value="domain">domain</option>
          </select>
          <select id="rule-cls-${esc(msgKey)}" class="form-select" style="font-size:11px;padding:4px 8px;flex:1">
            <option value="client">client</option>
            <option value="spam">spam</option>
            <option value="vendor">vendor</option>
          </select>
          <input id="rule-weight-${esc(msgKey)}" class="form-input" type="number" min="1" max="10" value="4" style="width:50px;font-size:11px;padding:4px 8px;" />
        </div>
        <input id="rule-pattern-${esc(msgKey)}" class="form-input" placeholder="Regex паттерн..." style="font-size:11px;padding:6px 8px;margin-bottom:6px;width:100%;" value="${esc(suggestPattern(msg))}" />
        <button class="btn btn-primary btn-sm" style="width:100%" onclick="window.__addRule('${escAttr(msgKey)}')">Сохранить правило</button>
      </div>
    </div>
    ${a.suggestedReply ? `<div class="detail-section">
      <div class="detail-section-title" style="display:flex;align-items:center;justify-content:space-between;">
        Шаблон ответа
        <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;" onclick="window.__copyField(\`${escAttr(a.suggestedReply)}\`);this.textContent='Скопировано';setTimeout(()=>this.textContent='Копировать',1500)">Копировать</button>
      </div>
      <div style="background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:12px;white-space:pre-wrap;color:var(--text-secondary);line-height:1.6;max-height:200px;overflow-y:auto;">${esc(a.suggestedReply)}</div>
    </div>` : ''}
    ${msg.auditLog?.length ? `<div class="detail-section">
      <div class="detail-section-title">Аудит</div>
      ${msg.auditLog.slice(-5).map((log) => `<div style="font-size:10px;color:var(--text-muted);padding:2px 0;display:flex;gap:6px;">
        <span style="color:var(--text-secondary);">${fmtDate(log.at)}</span>
        <span>${esc(log.from || '?')} → ${esc(log.to || '?')}</span>
      </div>`).join('')}
    </div>` : ''}
    <div class="detail-actions">
      ${crm.isExistingCompany === false ? '<button class="btn btn-primary btn-sm" style="width:100%">Создать клиента в CRM</button>' : ''}
      ${cls.label === 'Клиент' ? '<button class="btn btn-success btn-sm" style="width:100%">Создать запрос в CRM</button>' : ''}
      ${crm.needsClarification ? '<button class="btn btn-ghost btn-sm" style="width:100%">Запросить реквизиты</button>' : ''}
      <button class="btn btn-danger btn-sm" style="width:100%" onclick="window.__deleteMsg('${escAttr(msgKey)}')">Удалить письмо</button>
    </div>
  `;
  } catch (err) {
    detailEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h4>Ошибка отрисовки</h4><p style="font-size:11px;color:var(--text-muted);">${esc(err.message)}</p></div>`;
    console.error('renderEmailView detail error:', err);
  }
}

// Global delete handler
window.__deleteMsg = async (key) => {
  if (!confirm('Удалить это письмо?')) return;
  await deleteMessage(key);
};

// ═══ TRAINING handlers ═══
window.__trainSender = async (email, classification, companyHint, msgKey) => {
  const domain = email.split('@')[1] || '';
  const label = { client: 'заявка', spam: 'спам', vendor: 'поставщик' }[classification] || classification;
  const statusMap = { client: 'ready_for_crm', spam: 'ignored_spam', vendor: 'review' };

  const scopeRadio = document.querySelector(`input[name="train-scope-${msgKey}"]:checked`);
  const scope = scopeRadio?.value || (isFreeDomain(domain) ? 'email' : 'domain');

  const byEmail = scope === 'email';
  const target = byEmail ? email : `@${domain}`;
  if (!confirm(`Обучить: ${byEmail ? 'письма от' : 'все письма с'} ${target} → ${label}?`)) return;

  try {
    // 1. Save sender profile for future emails
    const res = await fetch('/api/detection-kb/sender-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderEmail: byEmail ? email : '',
        senderDomain: byEmail ? '' : domain,
        classification,
        companyHint: companyHint || '',
        notes: `Обучено из inbox: ${target} → ${classification}`
      })
    });

    if (!res.ok) { showToast('Ошибка сохранения профиля', true); return; }

    // 2. Update current message status so it moves to correct tab
    if (msgKey) {
      const currentMsg = allRunnerMessages.find((m) => mid(m) === msgKey);
      const currentPid = currentMsg?._projectId || P3_ID;
      await fetch(`/api/projects/${currentPid}/messages/${encodeURIComponent(msgKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineStatus: statusMap[classification] || 'review' })
      });

      // Also update matching messages from same sender in local data
      const matchFn = byEmail
        ? (m) => (m.analysis?.sender?.email || m.from || '').toLowerCase() === email.toLowerCase()
        : (m) => (m.analysis?.sender?.email || m.from || '').toLowerCase().endsWith(`@${domain.toLowerCase()}`);

      for (const m of allRunnerMessages.filter(matchFn)) {
        const key = mid(m);
        m.pipelineStatus = statusMap[classification] || 'review';
        if (key !== msgKey) {
          const pid = m._projectId || P3_ID;
          fetch(`/api/projects/${pid}/messages/${encodeURIComponent(key)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pipelineStatus: statusMap[classification] || 'review' })
          });
        }
      }
    }

    showToast(`${target} → "${label}" (${allRunnerMessages.filter((m) => byEmail ? (m.analysis?.sender?.email || '').toLowerCase() === email.toLowerCase() : (m.analysis?.sender?.email || '').toLowerCase().endsWith(`@${domain}`)).length} писем перемещено)`);
    await refreshKb();
    renderInbox();
  } catch (err) {
    showToast('Ошибка: ' + err.message, true);
  }
};

window.__showRuleForm = (msgKey) => {
  const form = $(`#rule-form-${msgKey}`);
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
};

window.__addRule = async (msgKey) => {
  const scope = $(`#rule-scope-${msgKey}`)?.value || 'body';
  const classifier = $(`#rule-cls-${msgKey}`)?.value || 'client';
  const weight = Number($(`#rule-weight-${msgKey}`)?.value || 4);
  const pattern = $(`#rule-pattern-${msgKey}`)?.value?.trim();

  if (!pattern) { showToast('Укажите паттерн', true); return; }

  try {
    const res = await fetch('/api/detection-kb/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, classifier, matchType: 'regex', pattern, weight, notes: `Из inbox: ${msgKey.slice(0, 8)}` })
    });
    if (res.ok) {
      showToast(`Правило добавлено: ${classifier} +${weight}`);
      $(`#rule-form-${msgKey}`).style.display = 'none';
      await refreshKb();
    } else {
      showToast('Ошибка сохранения правила', true);
    }
  } catch (err) {
    showToast('Ошибка: ' + err.message, true);
  }
};

function suggestPattern(msg) {
  // Extract unique meaningful words from subject as a starting pattern
  const subject = (msg.subject || '').toLowerCase();
  const stopWords = new Set(['и', 'в', 'на', 'от', 'по', 'с', 'из', 'для', 'не', 'за', 'к', 'до', 're:', 'fwd:', 'fw:']);
  const words = subject.split(/[\s,.:;!?()\[\]{}]+/).filter((w) => w.length > 2 && !stopWords.has(w));
  return words.slice(0, 4).join('|') || '';
}

function showToast(message, isError = false) {
  let toast = $('#toast-notification');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:9999;transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.style.background = isError ? 'var(--rose)' : 'var(--green)';
  toast.style.color = '#fff';
  toast.textContent = message;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 3000);
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
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">${classificationBadge(cls.label)}${cls.confidence != null ? `<div class="confidence-bar" style="width:120px">${renderConfBar(cls.confidence)}</div>` : ''}${statusBadge(data.intakeFlow?.requestType || '')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div><div class="detail-section-title" style="margin-bottom:8px;">Отправитель</div>${[['Email', sender.email],['ФИО', sender.fullName],['Должность', sender.position],['Компания', sender.companyName],['Сайт', sender.website],['Гор.', sender.cityPhone],['Моб.', sender.mobilePhone],['ИНН', sender.inn]].filter(([,v]) => v).map(([l,v]) => detailField(l, v)).join('')}</div>
      <div><div class="detail-section-title" style="margin-bottom:8px;">CRM</div>${[['Юрлицо', crm.isExistingCompany ? crm.company?.legalName || 'Найдено' : 'Не найдено'],['МОП', crm.curatorMop],['МОЗ', crm.curatorMoz],['Уточнение', crm.needsClarification ? 'Да' : 'Нет']].filter(([,v]) => v).map(([l,v]) => detailField(l, v)).join('')}${crm.actions?.length ? crm.actions.map((a) => `<div style="font-size:11px;color:var(--text-secondary);padding:2px 0;">→ ${esc(a)}</div>`).join('') : ''}</div>
    </div>
    ${lead.lineItems?.length ? `<div style="margin-top:16px;"><div class="detail-section-title" style="margin-bottom:8px;">Позиции</div><table class="data-table" style="font-size:12px;"><thead><tr><th>Артикул</th><th>Кол-во</th><th>Ед.</th><th>Описание</th></tr></thead><tbody>${lead.lineItems.map((li) => `<tr><td><strong>${esc(li.article)}</strong></td><td>${li.quantity}</td><td>${esc(li.unit)}</td><td style="color:var(--text-muted);font-size:11px;">${esc(truncate(li.descriptionRu, 60))}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${rules.length ? `<div style="margin-top:16px;"><div class="detail-section-title" style="margin-bottom:8px;">Правила</div>${rules.map((r) => `<div style="font-size:11px;padding:3px 0;display:flex;gap:6px;align-items:center;"><span class="badge ${r.classifier === 'spam' ? 'badge-spam' : r.classifier === 'client' ? 'badge-client' : 'badge-vendor'}" style="font-size:9px;">${esc(r.classifier)}</span><span style="color:var(--text-muted);font-family:'JetBrains Mono',monospace;font-size:10px;">${esc(truncate(r.pattern, 40))}</span><span style="color:var(--green);font-weight:600;margin-left:auto;">+${r.weight}</span></div>`).join('')}</div>` : ''}
    ${data.suggestedReply || crm.suggestedReply ? `<div style="margin-top:16px;"><div class="detail-section-title" style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;">Шаблон ответа <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;" onclick="window.__copyField(\`${escAttr(data.suggestedReply || crm.suggestedReply)}\`);this.textContent='Скопировано';setTimeout(()=>this.textContent='Копировать',1500)">Копировать</button></div><div style="background:var(--surface-0);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;font-size:12px;white-space:pre-wrap;color:var(--text-secondary);">${esc(data.suggestedReply || crm.suggestedReply)}</div></div>` : ''}
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
    container.innerHTML = `<table class="data-table"><thead><tr><th>ID</th><th>Scope</th><th>Classifier</th><th>Тип</th><th>Паттерн</th><th>Вес</th><th>Заметки</th><th></th></tr></thead><tbody>${rules.map((r) => `<tr><td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${r.id}</td><td><span class="badge badge-unknown">${esc(r.scope)}</span></td><td>${classificationBadge(r.classifier === 'client' ? 'Клиент' : r.classifier === 'spam' ? 'СПАМ' : 'Поставщик услуг')}</td><td style="font-size:11px;">${esc(r.match_type)}</td><td style="font-family:'JetBrains Mono',monospace;font-size:10px;max-width:300px;overflow:hidden;text-overflow:ellipsis;" title="${esc(r.pattern)}">${esc(truncate(r.pattern, 50))}</td><td><strong>${r.weight}</strong></td><td style="font-size:11px;color:var(--text-muted);">${esc(r.notes || '')}</td><td><button class="btn btn-danger btn-sm" style="padding:2px 6px;font-size:10px;" data-del-rule="${r.id}">×</button></td></tr>`).join('')}</tbody></table>`;
    container.querySelectorAll('[data-del-rule]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Деактивировать это правило?')) return;
        await fetch(`/api/detection-kb/rules/${btn.dataset.delRule}`, { method: 'DELETE' });
        await refreshKb();
        showToast('Правило деактивировано');
      });
    });
    return;
  }
  if (kbTab === 'brands') {
    container.innerHTML = `<table class="data-table"><thead><tr><th>Бренд</th><th>Alias</th><th>ID</th></tr></thead><tbody>${(kbData.brandAliases || []).map((b) => `<tr><td><strong>${esc(b.canonical_brand)}</strong></td><td style="font-family:'JetBrains Mono',monospace;font-size:12px;">${esc(b.alias)}</td><td style="color:var(--text-muted);font-size:11px;">${b.id}</td></tr>`).join('')}</tbody></table>`;
    return;
  }
  if (kbTab === 'senders') {
    const senders = kbData.senderProfiles || [];
    const spamProfiles = senders.filter((s) => s.classification === 'spam');
    const clientProfiles = senders.filter((s) => s.classification === 'client');
    const vendorProfiles = senders.filter((s) => s.classification === 'vendor');
    const otherProfiles = senders.filter((s) => !['spam', 'client', 'vendor'].includes(s.classification));

    const renderGroup = (title, profiles, badgeCls) => {
      if (!profiles.length) return '';
      return `<div style="margin-bottom:16px;">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;display:flex;align-items:center;gap:8px;">
          ${title} <span class="badge ${badgeCls}" style="font-size:10px;">${profiles.length}</span>
        </div>
        <table class="data-table"><thead><tr><th>Email / Домен</th><th>Компания</th><th>Заметки</th><th></th></tr></thead>
        <tbody>${profiles.map((s) => `<tr>
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${esc(s.sender_email || `@${s.sender_domain}` || '—')}</td>
          <td>${esc(s.company_hint || '—')}</td>
          <td style="font-size:11px;color:var(--text-muted);">${esc(s.notes || '')}</td>
          <td><button class="btn btn-danger btn-sm" style="padding:2px 6px;font-size:10px;" data-del-sender="${s.id}">×</button></td>
        </tr>`).join('')}</tbody></table>
      </div>`;
    };

    container.innerHTML = senders.length
      ? renderGroup('Спам (чёрный список)', spamProfiles, 'badge-spam')
        + renderGroup('Клиенты (белый список)', clientProfiles, 'badge-client')
        + renderGroup('Поставщики', vendorProfiles, 'badge-vendor')
        + renderGroup('Другие', otherProfiles, 'badge-unknown')
      : '<div class="empty-state" style="padding:32px"><h4>Нет профилей</h4><p>Обучайте систему из вкладки Входящие</p></div>';
    container.querySelectorAll('[data-del-sender]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить этот профиль отправителя?')) return;
        await fetch(`/api/detection-kb/sender-profiles/${btn.dataset.delSender}`, { method: 'DELETE' });
        await refreshKb();
        showToast('Профиль удалён');
      });
    });
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
  const v = value || '—';
  const copyable = v !== '—' ? `onclick="window.__copyField('${escAttr(v)}')" title="Нажмите чтобы скопировать" style="cursor:pointer;"` : '';
  return `<div class="detail-field" ${copyable}><span class="detail-field-label">${esc(label)}</span><span class="detail-field-value">${esc(v)}</span></div>`;
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

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function formatArr(items) { return Array.isArray(items) && items.length ? items.join(', ') : null; }
function truncate(s, n) { return !s ? '' : s.length > n ? s.slice(0, n) + '...' : s; }
function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(v) { return String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/</g, '\\x3c'); }

async function refreshApiDocsHealth() {
  const el = $('#api-health-status');
  if (!el) return;
  try {
    const [health, kb] = await Promise.all([
      fetch('/api/health').then((r) => r.json()),
      fetch('/api/detection-kb').then((r) => r.json())
    ]);
    const stats = kb.stats || {};
    el.innerHTML = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <div style="padding:10px 16px;border-radius:8px;background:var(--bg-tertiary);flex:1;min-width:140px;">
          <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;">Server</div>
          <div style="font-size:18px;font-weight:700;color:var(--green);">${health.ok ? 'Online' : 'Offline'}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">Role: ${health.background?.role || '-'}</div>
        </div>
        <div style="padding:10px 16px;border-radius:8px;background:var(--bg-tertiary);flex:1;min-width:140px;">
          <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;">Brand Aliases</div>
          <div style="font-size:18px;font-weight:700;color:var(--blue);">${stats.brandAliasCount || 0}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">Own brands: ${stats.ownBrandCount || 0}</div>
        </div>
        <div style="padding:10px 16px;border-radius:8px;background:var(--bg-tertiary);flex:1;min-width:140px;">
          <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;">Detection Rules</div>
          <div style="font-size:18px;font-weight:700;color:var(--purple);">${stats.ruleCount || 0}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">Sender profiles: ${stats.senderProfileCount || 0}</div>
        </div>
        <div style="padding:10px 16px;border-radius:8px;background:var(--bg-tertiary);flex:1;min-width:140px;">
          <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;">Message Corpus</div>
          <div style="font-size:18px;font-weight:700;color:var(--orange);">${stats.corpusCount || 0}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">Field patterns: ${stats.fieldPatternCount || 0}</div>
        </div>
      </div>`;
  } catch {
    el.innerHTML = '<span style="color:var(--rose);">Failed to load API health</span>';
  }
}
