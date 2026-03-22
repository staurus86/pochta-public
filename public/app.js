// ═══════════════════════════════════════════════════════
//  Pochta Platform — Premium Dashboard SPA
// ═══════════════════════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const FREE_DOMAINS = new Set(['gmail.com','mail.ru','bk.ru','list.ru','inbox.ru','yandex.ru','ya.ru','hotmail.com','outlook.com','icloud.com','me.com','live.com','yahoo.com','rambler.ru','ro.ru','autorambler.ru','myrambler.ru','lenta.ru','aol.com','protonmail.com','proton.me','zoho.com','tilda.ws','tilda.cc','snipermail.com','mailchimp.com','sendgrid.net','mandrillapp.com','amazonses.com','postmaster.twitter.com','noreply.github.com','mailer-daemon.googlemail.com']);
function isFreeDomain(domain) { return FREE_DOMAINS.has((domain || '').toLowerCase()); }
const OWN_DOMAINS = new Set(['siderus.su','siderus.online','siderus.ru','klvrt.ru','ersab2b.ru','itec-rus.ru','paulvahle.ru','petersime-rus.ru','rstahl.ru','schimpfdrive.ru','schischekrus.ru','sera-rus.ru','serfilco-ru.ru','vega-automation.ru','waldner-ru.ru','kiesel-rus.ru','maximator-ru.ru','stromag-ru.ru','endress-hauser.pro']);
function isOwnDomain(domain) { return OWN_DOMAINS.has((domain || '').toLowerCase()); }

// Own company filter — never show in dashboard as customers
const __OWN_COMPANY_RE = /сидерус|siderus|коловрат|kolovrat|klvrt|ersa\s*b2b|ersab2b/i;
function __isOwnCompany(name) { return __OWN_COMPANY_RE.test(name); }
// Only show real companies with legal forms (ООО, АО, GmbH, etc.)
// If name has no legal form — it's likely a domain or noise, not a real customer
function __isDomainLike(name) {
  if (!name) return true;
  const n = name.trim();
  // Russian legal forms: ООО, АО, ОАО, ЗАО, ПАО, ФГУП, МУП, ГУП, НПО, НПП, ИП
  if (/(?:^|\s)(ООО|АО|ОАО|ЗАО|ПАО|ФГУП|МУП|ГУП|НПО|НПП|ИП)\s/i.test(n)) return false;
  // International legal forms
  if (/\b(GmbH|AG|Ltd\.?|LLC|Inc\.?|SE|S\.A\.|B\.V\.|Co\.|Corp\.?|PLC|Pty)\b/i.test(n)) return false;
  // Factory/plant patterns (Russian)
  if (/завод|фабрика|комбинат|предприятие/i.test(n)) return false;
  // Everything else without legal form is not a real company name
  return true;
}

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
let inboxRecognitionFilter = '';
let inboxGroupByThread = false;
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
  connectSSE();
}

function connectSSE() {
  let retryDelay = 1000;
  function connect() {
    const es = new EventSource('/api/events');
    es.addEventListener('connected', () => { retryDelay = 1000; });
    es.addEventListener('messages', async (e) => {
      try {
        const data = JSON.parse(e.data);
        const oldCount = allRunnerMessages.length;
        await refreshAllMailboxMessages();
        const diff = allRunnerMessages.length - oldCount;
        if (diff > 0) showToast(`+${diff} новых писем`);
        else if (data.count > 0) showToast('Письма обновлены');
      } catch { /* ignore parse errors */ }
    });
    es.addEventListener('status', (e) => {
      try {
        const data = JSON.parse(e.data);
        const msg = allRunnerMessages.find((m) => (m.messageKey || m.id) === data.messageKey);
        if (msg) {
          msg.pipelineStatus = data.status;
          renderInbox();
        }
      } catch { /* ignore */ }
    });
    es.onerror = () => {
      es.close();
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    };
  }
  connect();
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
  if (page === 'api-docs') { refreshApiDocsHealth(); refreshApiClients(); refreshCrmConfig(); }
}

// ═══════════════════════════════════════════════════════
//  FORMS
// ═══════════════════════════════════════════════════════

function setupForms() {
  projectSelect.addEventListener('change', async () => {
    selectedProjectId = projectSelect.value;
  });

  $('#create-api-client-btn').addEventListener('click', async () => {
    const name = prompt('Имя клиента (например: CRM Bot, 1C Integration):');
    if (!name) return;
    const webhookUrl = prompt('Webhook URL (оставьте пустым если не нужен):', '') || '';
    await fetch('/api/detection-kb/api-clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, webhookUrl })
    });
    refreshApiClients();
  });

  $('#reanalyze-btn').addEventListener('click', async () => {
    const pid = selectedProjectId;
    if (!pid) return alert('Выберите проект');
    if (!confirm('Переанализировать все письма проекта? Это обновит бренды, артикулы и телефоны.')) return;
    const btn = $('#reanalyze-btn');
    btn.disabled = true;
    const origText = btn.textContent;
    let dots = 0;
    const pulse = setInterval(() => {
      dots = (dots + 1) % 4;
      btn.textContent = 'Анализирую' + '.'.repeat(dots);
      btn.style.opacity = 0.6 + 0.4 * Math.abs(Math.sin(Date.now() / 400));
    }, 300);
    // Show progress bar
    const bar = $('#progress-bar');
    const fill = bar?.querySelector('.progress-fill');
    if (bar) { bar.style.display = 'block'; }
    if (fill) { fill.style.width = '20%'; fill.style.transition = 'width 8s ease-out'; setTimeout(() => { fill.style.width = '90%'; }, 50); }
    try {
      const res = await fetch(`/api/projects/${pid}/reanalyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      clearInterval(pulse);
      btn.style.opacity = 1;
      if (fill) { fill.style.transition = 'width 0.3s'; fill.style.width = '100%'; }
      btn.textContent = `Готово: ${data.updated}/${data.total} (${((data.durationMs || 0) / 1000).toFixed(1)}s)`;
      btn.style.color = 'var(--green)';
      setTimeout(() => { if (bar) bar.style.display = 'none'; if (fill) fill.style.width = '0'; }, 1500);
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; btn.style.color = ''; }, 5000);
      refreshDashboard();
    } catch (err) {
      clearInterval(pulse);
      btn.style.opacity = 1;
      if (bar) bar.style.display = 'none';
      if (fill) fill.style.width = '0';
      btn.textContent = 'Ошибка: ' + (err.message || 'timeout');
      btn.style.color = 'var(--rose)';
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; btn.style.color = ''; }, 5000);
    }
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
  $('#inbox-group-threads').addEventListener('change', (e) => { inboxGroupByThread = e.target.checked; inboxPage = 0; renderInbox(); });
  $('#inbox-mailbox-filter').addEventListener('change', (e) => { inboxMailboxFilter = e.target.value; inboxPage = 0; renderInbox(); });
  $('#inbox-attachment-filter')?.addEventListener('change', (e) => { inboxAttachmentFilter = e.target.value; inboxPage = 0; renderInbox(); });
  $('#inbox-recognition-filter')?.addEventListener('change', (e) => { inboxRecognitionFilter = e.target.value; inboxPage = 0; renderInbox(); });
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
  $('#inbox-export-xlsx-btn').addEventListener('click', exportInboxXlsx);
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

  // Recognition quality filter
  if (inboxRecognitionFilter) {
    msgs = msgs.filter((m) => matchesRecognitionFilter(m, inboxRecognitionFilter));
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

function matchesRecognitionFilter(message, filterValue) {
  const summary = getRecognitionSummary(message.analysis || {});
  const diagnostics = getRecognitionDiagnostics(message.analysis || {});
  const hasAttachments = (message.attachments || message.attachmentFiles || []).length > 0;

  if (filterValue === 'missing_article') return !summary.article;
  if (filterValue === 'missing_brand') return !summary.brand;
  if (filterValue === 'missing_name') return !summary.name;
  if (filterValue === 'missing_phone') return !summary.phone;
  if (filterValue === 'missing_company') return !summary.company;
  if (filterValue === 'missing_inn') return !summary.inn;
  if (filterValue === 'attachments_unparsed') return hasAttachments && !summary.parsedAttachment;
  if (filterValue === 'weak_detection') return diagnostics.riskLevel === 'high' || (diagnostics.completenessScore || 0) < 70 || (diagnostics.overallConfidence || 0) < 0.72;
  if (filterValue === 'has_conflicts') return (diagnostics.conflicts || []).length > 0;
  if (filterValue === 'all_key_fields') return summary.article && summary.brand && summary.name && summary.phone;
  if (filterValue === 'fully_parsed') {
    return summary.article
      && summary.brand
      && summary.name
      && summary.phone
      && summary.company
      && summary.inn
      && (!hasAttachments || summary.parsedAttachment);
  }
  return true;
}

function getRecognitionSummary(analysis = {}) {
  const lead = analysis.lead || {};
  const sender = analysis.sender || {};
  const summary = lead.recognitionSummary || {};
  return {
    article: summary.article ?? ((lead.articles || []).length > 0),
    brand: summary.brand ?? (((analysis.detectedBrands || []).length + (lead.detectedBrands || []).length) > 0),
    name: summary.name ?? (getLeadProductNameList(lead).length > 0),
    phone: summary.phone ?? Boolean(sender.cityPhone || sender.mobilePhone),
    company: summary.company ?? Boolean(sender.companyName),
    inn: summary.inn ?? Boolean(sender.inn),
    parsedAttachment: summary.parsedAttachment ?? ((analysis.attachmentAnalysis?.files || []).some((file) => file.status === 'processed')),
    missing: summary.missing || []
  };
}

function getRecognitionDiagnostics(analysis = {}) {
  const lead = analysis.lead || {};
  const summary = getRecognitionSummary(analysis);
  const stored = lead.recognitionDiagnostics || {};
  const presentCount = ['article', 'brand', 'name', 'phone', 'company', 'inn'].filter((field) => summary[field]).length;
  return {
    completenessScore: stored.completenessScore ?? Math.round((presentCount / 6) * 100),
    overallConfidence: stored.overallConfidence ?? 0,
    riskLevel: stored.riskLevel || (summary.missing?.length > 2 ? 'high' : summary.missing?.length > 0 ? 'medium' : 'low'),
    primaryIssue: stored.primaryIssue || summary.missing?.[0] || null,
    fields: stored.fields || {},
    conflicts: stored.conflicts || [],
    issues: stored.issues || []
  };
}

function renderRecognitionBadges(analysis = {}) {
  const summary = getRecognitionSummary(analysis);
  const diagnostics = getRecognitionDiagnostics(analysis);
  const badges = [];
  if (!summary.article) badges.push('<span class="badge badge-unknown" title="Не найден артикул">нет артикула</span>');
  if (!summary.brand) badges.push('<span class="badge badge-unknown" title="Не найден бренд">нет бренда</span>');
  if (!summary.name) badges.push('<span class="badge badge-unknown" title="Не найдено наименование">нет имени</span>');
  if (!summary.phone) badges.push('<span class="badge badge-unknown" title="Не найден телефон">нет телефона</span>');
  if (summary.parsedAttachment) badges.push('<span class="badge badge-client" title="Есть обработанные вложения">вложения ок</span>');
  if ((diagnostics.conflicts || []).length) badges.push('<span class="badge badge-spam" title="Есть конфликтующие данные по полям">есть конфликт</span>');
  if (diagnostics.riskLevel === 'high') badges.push('<span class="badge badge-vendor" title="Нужна ручная проверка">слабый детект</span>');
  return badges.join('');
}

function renderRecognitionSummary(summary) {
  const rows = [
    ['Артикул', summary.article],
    ['Бренд', summary.brand],
    ['Наименование', summary.name],
    ['Телефон', summary.phone],
    ['Компания', summary.company],
    ['ИНН', summary.inn],
    ['Вложения', summary.parsedAttachment]
  ];
  return rows.map(([label, ok]) =>
    `<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;padding:3px 0;">
      <span style="color:var(--text-muted);">${esc(label)}</span>
      <span class="badge ${ok ? 'badge-client' : 'badge-unknown'}">${ok ? 'найдено' : 'нет'}</span>
    </div>`
  ).join('');
}

function renderRecognitionDiagnostics(analysis = {}) {
  const diagnostics = getRecognitionDiagnostics(analysis);
  const fieldDiagnostics = diagnostics.fields || {};
  const fieldRows = [
    ['Артикул', fieldDiagnostics.article],
    ['Бренд', fieldDiagnostics.brand],
    ['Наименование', fieldDiagnostics.name],
    ['Телефон', fieldDiagnostics.phone],
    ['Компания', fieldDiagnostics.company],
    ['ИНН', fieldDiagnostics.inn]
  ];
  const issues = diagnostics.issues || [];
  const conflicts = diagnostics.conflicts || [];
  const riskColor = diagnostics.riskLevel === 'low' ? 'var(--green)' : diagnostics.riskLevel === 'medium' ? 'var(--amber)' : 'var(--rose)';

  return `
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px;">
      <div class="kpi-card" style="padding:10px;">
        <div class="kpi-label">Покрытие</div>
        <div class="kpi-value" style="color:${riskColor};">${diagnostics.completenessScore || 0}%</div>
      </div>
      <div class="kpi-card" style="padding:10px;">
        <div class="kpi-label">Уверенность</div>
        <div class="kpi-value accent">${Math.round((diagnostics.overallConfidence || 0) * 100)}%</div>
      </div>
      <div class="kpi-card" style="padding:10px;">
        <div class="kpi-label">Риск</div>
        <div class="kpi-value" style="color:${riskColor};text-transform:uppercase;">${esc(diagnostics.riskLevel || 'low')}</div>
      </div>
    </div>
    <div style="display:grid;gap:6px;margin-bottom:10px;">
      ${fieldRows.map(([label, field]) => `
        <div style="display:grid;grid-template-columns:92px 1fr 58px;align-items:center;gap:8px;font-size:11px;">
          <span style="color:var(--text-muted);">${esc(label)}</span>
          <div class="confidence-bar">${renderConfBar(field?.confidence || 0)}</div>
          <span style="color:var(--text-secondary);text-align:right;">${esc(field?.source || '—')}</span>
        </div>
      `).join('')}
    </div>
    ${issues.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:${conflicts.length ? '8px' : '0'};">
      ${issues.slice(0, 6).map((issue) => `<span class="badge ${issue.severity === 'high' ? 'badge-spam' : issue.severity === 'medium' ? 'badge-vendor' : 'badge-unknown'}" title="${esc(issue.code)}">${esc(issueLabel(issue.code))}</span>`).join('')}
    </div>` : ''}
    ${conflicts.length ? `<div style="display:grid;gap:6px;">
      ${conflicts.slice(0, 4).map((conflict) => `<div style="font-size:11px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-0);">
        <div style="font-weight:600;color:var(--rose);margin-bottom:4px;">${esc(issueLabel(conflict.code))}</div>
        <div style="color:var(--text-secondary);">${esc((conflict.values || []).join(' / ') || '—')}</div>
        ${conflict.article ? `<div style="margin-top:2px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;">${esc(conflict.article)}</div>` : ''}
      </div>`).join('')}
    </div>` : ''}
  `;
}

function issueLabel(code) {
  return {
    missing_article: 'нет артикула',
    missing_brand: 'нет бренда',
    missing_name: 'нет наименования',
    missing_phone: 'нет телефона',
    missing_company: 'нет компании',
    missing_inn: 'нет ИНН',
    attachment_parse_gap: 'вложения не разобраны',
    low_confidence_article: 'слабый артикул',
    low_confidence_brand: 'слабый бренд',
    low_confidence_name: 'слабое наименование',
    low_confidence_phone: 'слабый телефон',
    low_confidence_company: 'слабая компания',
    low_confidence_inn: 'слабый ИНН',
    low_classification_confidence: 'слабая классификация',
    multiple_brands_detected: 'несколько брендов',
    detection_conflicts_present: 'есть конфликты',
    article_quantity_conflict: 'конфликт количества',
    article_name_conflict: 'конфликт названия',
    multiple_inn_candidates: 'несколько ИНН'
  }[code] || code;
}

function renderDetectionSources(analysis = {}) {
  const lead = analysis.lead || {};
  const sender = analysis.sender || {};
  const sources = lead.sources || {};
  const senderSources = sender.sources || {};
  const rows = [
    ['Компания', senderSources.company],
    ['Телефон', senderSources.phone],
    ['ИНН', senderSources.inn],
    ['Артикулы', (sources.articles || []).join(', ')],
    ['Наименования', (sources.names || []).join(', ')],
    ['Бренды', (sources.brands || []).join(', ')],
    ['Обработанные вложения', (sources.attachmentsProcessed || []).join(', ')]
  ].filter(([, value]) => value);

  if (!rows.length) {
    return '<div style="font-size:11px;color:var(--text-muted);">Нет данных об источниках</div>';
  }

  return rows.map(([label, value]) =>
    `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;font-size:11px;padding:3px 0;">
      <span style="color:var(--text-muted);">${esc(label)}</span>
      <span style="text-align:right;color:var(--text);max-width:65%;">${esc(value)}</span>
    </div>`
  ).join('');
}

function normalizeSubjectForThread(subject) {
  return String(subject || '')
    .replace(/^(re|fwd?|ответ|переслано)\s*[:]\s*/gi, '')
    .replace(/^(re|fwd?|ответ|переслано)\s*[:]\s*/gi, '')  // second pass for nested Re: Re:
    .trim()
    .toLowerCase();
}

function getSenderDomain(msg) {
  const email = msg.analysis?.sender?.email || msg.from || '';
  const match = email.match(/@([^>]+)/);
  return match ? match[1].toLowerCase() : email.toLowerCase();
}

function getThreadKey(msg) {
  // Prefer server-side threadId (from In-Reply-To/References headers)
  if (msg.threadId) return msg.threadId;
  // Fallback to normalized subject + sender domain
  return normalizeSubjectForThread(msg.subject) + '|' + getSenderDomain(msg);
}

function groupByThreads(messages) {
  const threads = new Map();
  for (const msg of messages) {
    const key = getThreadKey(msg);
    if (!threads.has(key)) {
      threads.set(key, []);
    }
    threads.get(key).push(msg);
  }
  // Sort threads by latest message date (descending)
  const sortedThreads = [...threads.values()].sort((a, b) => {
    const latestA = Math.max(...a.map((m) => new Date(m.createdAt || 0).getTime()));
    const latestB = Math.max(...b.map((m) => new Date(m.createdAt || 0).getTime()));
    return latestB - latestA;
  });
  // Sort messages within each thread chronologically (oldest first)
  for (const thread of sortedThreads) {
    thread.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  }
  return sortedThreads;
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

function exportInboxXlsx() {
  if (typeof XLSX === 'undefined') {
    showToast('Загрузка библиотеки XLSX...');
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => exportInboxXlsx();
    s.onerror = () => showToast('Не удалось загрузить XLSX библиотеку');
    document.head.appendChild(s);
    return;
  }

  const headers = ['Дата', 'От', 'Ящик', 'Тема', 'Статус', 'Категория', 'Confidence', 'Компания', 'ИНН', 'Телефон', 'Бренды', 'Артикулы'];
  const data = runnerMessages.map((m) => {
    const a = m.analysis || {};
    const s = a.sender || {};
    const l = a.lead || {};
    return [
      m.createdAt || '', m.from || s.email || '', m.mailbox || '', m.subject || '',
      m.pipelineStatus || '', a.classification?.label || '', a.classification?.confidence || '',
      s.companyName || '', s.inn || '', s.cityPhone || s.mobilePhone || '',
      (a.detectedBrands || []).join('; '), (l.articles || []).join('; ')
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  // Column widths
  ws['!cols'] = [
    { wch: 20 }, { wch: 25 }, { wch: 25 }, { wch: 40 }, { wch: 16 }, { wch: 14 },
    { wch: 10 }, { wch: 25 }, { wch: 14 }, { wch: 18 }, { wch: 25 }, { wch: 30 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Заявки');
  XLSX.writeFile(wb, `pochta-inbox-${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast(`Экспортировано ${runnerMessages.length} писем в XLSX`);
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

  // ═══ Top senders (real company domains only, no free mail / own domains) ═══
  const senderMap = new Map();
  allRunnerMessages.filter((m) => m.pipelineStatus !== 'ignored_spam').forEach((m) => {
    const email = m.analysis?.sender?.email || m.from || 'unknown';
    const domain = (email.split('@')[1] || '').toLowerCase();
    if (!domain || isFreeDomain(domain) || isOwnDomain(domain)) return;
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

  renderRequestAnalytics();
  renderAccuracyMetrics();
  renderWeeklyTrends();
  renderFieldCoverage();
  renderProblemQueue();
  renderQualityAuditTable();
}

function renderQualityAuditTable() {
  const rows = allRunnerMessages
    .filter((m) => m.pipelineStatus !== 'ignored_spam' && m.pipelineStatus !== 'fetch_error')
    .map((message) => {
      const summary = getRecognitionSummary(message.analysis || {});
      const diagnostics = getRecognitionDiagnostics(message.analysis || {});
      const primaryProblem = diagnostics.primaryIssue || (summary.missing || [])[0] || null;
      if (!primaryProblem) return null;
      return {
        message,
        primaryProblem,
        confidence: message.analysis?.classification?.confidence || 0,
        parsedAttachment: summary.parsedAttachment,
        diagnostics
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const riskWeight = { high: 0, medium: 1, low: 2 };
      if ((a.diagnostics.riskLevel || '') !== (b.diagnostics.riskLevel || '')) return (riskWeight[a.diagnostics.riskLevel] ?? 99) - (riskWeight[b.diagnostics.riskLevel] ?? 99);
      if (a.primaryProblem !== b.primaryProblem) return a.primaryProblem.localeCompare(b.primaryProblem);
      return (a.diagnostics.overallConfidence || a.confidence) - (b.diagnostics.overallConfidence || b.confidence);
    })
    .slice(0, 20);

  $('#quality-audit-body').innerHTML = rows.length ? rows.map(({ message, primaryProblem, confidence, parsedAttachment, diagnostics }) => `
    <tr>
      <td><span class="badge badge-unknown">${esc(problemLabel(primaryProblem))}</span></td>
      <td style="max-width:320px;"><button onclick="window.__openProblemMessage('${escAttr(mid(message))}')" style="background:none;border:none;padding:0;color:var(--text);cursor:pointer;text-align:left;">${esc(truncate(message.subject || 'Без темы', 70))}</button></td>
      <td style="font-size:11px;color:var(--text-secondary);">${esc(truncate(message.from || message.analysis?.sender?.email || '', 36))}</td>
      <td>${confidenceBadge(diagnostics.overallConfidence || confidence)}</td>
      <td>${parsedAttachment ? '<span class="badge badge-client">ok</span>' : '<span class="badge badge-unknown">нет</span>'}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="window.__openRecognitionFilter('${escAttr(problemToFilter(primaryProblem))}')">Открыть</button></td>
    </tr>
  `).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px;">Проблемных писем нет</td></tr>';
}

function problemLabel(problem) {
  return {
    article: 'Нет артикула',
    brand: 'Нет бренда',
    name: 'Нет наименования',
    phone: 'Нет телефона',
    company: 'Нет компании',
    inn: 'Нет ИНН',
    attachments: 'Вложения не разобраны',
    attachment_parse_gap: 'Вложения не разобраны',
    low_confidence_article: 'Слабый артикул',
    low_confidence_brand: 'Слабый бренд',
    low_confidence_name: 'Слабое наименование',
    low_confidence_phone: 'Слабый телефон',
    low_confidence_company: 'Слабая компания',
    low_confidence_inn: 'Слабый ИНН',
    low_classification_confidence: 'Слабая классификация',
    article_quantity_conflict: 'Конфликт количества',
    article_name_conflict: 'Конфликт названия',
    multiple_inn_candidates: 'Несколько ИНН',
    multiple_brands_detected: 'Несколько брендов',
    detection_conflicts_present: 'Есть конфликты'
  }[problem] || problem;
}

function problemToFilter(problem) {
  return {
    article: 'missing_article',
    brand: 'missing_brand',
    name: 'missing_name',
    phone: 'missing_phone',
    company: 'missing_company',
    inn: 'missing_inn',
    attachments: 'attachments_unparsed',
    attachment_parse_gap: 'attachments_unparsed',
    low_confidence_article: 'weak_detection',
    low_confidence_brand: 'weak_detection',
    low_confidence_name: 'weak_detection',
    low_confidence_phone: 'weak_detection',
    low_confidence_company: 'weak_detection',
    low_confidence_inn: 'weak_detection',
    low_classification_confidence: 'weak_detection',
    article_quantity_conflict: 'has_conflicts',
    article_name_conflict: 'has_conflicts',
    multiple_inn_candidates: 'has_conflicts',
    detection_conflicts_present: 'has_conflicts',
    multiple_brands_detected: 'weak_detection'
  }[problem] || '';
}

function renderProblemQueue() {
  const nonSpamMessages = allRunnerMessages.filter((m) => m.pipelineStatus !== 'ignored_spam' && m.pipelineStatus !== 'fetch_error');
  const problemDefs = [
    { key: 'missing_article', label: 'Нет артикула' },
    { key: 'missing_brand', label: 'Нет бренда' },
    { key: 'missing_name', label: 'Нет наименования' },
    { key: 'missing_phone', label: 'Нет телефона' },
    { key: 'missing_company', label: 'Нет компании' },
    { key: 'missing_inn', label: 'Нет ИНН' },
    { key: 'attachments_unparsed', label: 'Вложения не разобраны' },
    { key: 'weak_detection', label: 'Слабый детект' },
    { key: 'has_conflicts', label: 'Есть конфликты' }
  ];

  const stats = problemDefs.map((item) => ({
    ...item,
    count: nonSpamMessages.filter((message) => matchesRecognitionFilter(message, item.key)).length
  })).sort((a, b) => b.count - a.count);

  const totalProblemMessages = nonSpamMessages.filter((message) => {
    const summary = getRecognitionSummary(message.analysis || {});
    return summary.missing?.length > 0 || ((message.attachments || message.attachmentFiles || []).length > 0 && !summary.parsedAttachment);
  }).length;

  const topExamples = nonSpamMessages
    .map((message) => ({ message, summary: getRecognitionSummary(message.analysis || {}) }))
    .filter(({ summary, message }) => summary.missing?.length > 0 || ((message.attachments || message.attachmentFiles || []).length > 0 && !summary.parsedAttachment))
    .slice(0, 6);

  $('#problem-queue').innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
      <div class="kpi-card" style="min-width:180px;">
        <div class="kpi-label">Проблемных писем</div>
        <div class="kpi-value amber">${totalProblemMessages}</div>
      </div>
      ${stats.slice(0, 4).map((item) => `
        <button class="kpi-card" onclick="window.__openRecognitionFilter('${item.key}')" style="min-width:180px;text-align:left;cursor:pointer;">
          <div class="kpi-label">${esc(item.label)}</div>
          <div class="kpi-value rose">${item.count}</div>
        </button>
      `).join('')}
    </div>
    <div style="display:grid;gap:8px;">
      ${topExamples.map(({ message, summary }) => `
        <button onclick="window.__openProblemMessage('${escAttr(mid(message))}', '${escAttr(message._projectId || '')}')" style="text-align:left;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-0);cursor:pointer;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="font-size:12px;font-weight:600;color:var(--text);">${esc(truncate(message.subject || 'Без темы', 90))}</div>
            <span style="font-size:10px;color:var(--text-muted);">${fmtDate(message.createdAt)}</span>
          </div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">${esc(message.from || message.analysis?.sender?.email || '')}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${renderRecognitionBadges(message.analysis || {})}</div>
        </button>
      `).join('') || '<div style="color:var(--text-muted);font-size:12px;">Проблемных писем сейчас нет</div>'}
    </div>
  `;
}

window.__openRecognitionFilter = (filterValue) => {
  inboxRecognitionFilter = filterValue;
  const select = $('#inbox-recognition-filter');
  if (select) select.value = filterValue;
  inboxPage = 0;
  navigateTo('inbox');
  renderInbox();
};

window.__openProblemMessage = (messageId) => {
  selectedMessageId = messageId;
  navigateTo('inbox');
  renderInbox();
};

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

    // Company — only real legal entities, not domains; filter own companies
    const company = a.sender?.companyName || a.crm?.company?.legalName;
    if (company && !__isOwnCompany(company) && !__isDomainLike(company)) {
      companyCount.set(company, (companyCount.get(company) || 0) + 1);
    }

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

function renderAccuracyMetrics() {
  const el = $('#accuracy-metrics');
  if (!el) return;

  const total = allRunnerMessages.length;
  if (total === 0) { el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">Нет данных</div>'; return; }

  // Count messages with manual status corrections
  let corrected = 0;
  let feedbackCount = 0;
  const correctionsByType = { client: 0, spam: 0, vendor: 0 };
  for (const m of allRunnerMessages) {
    const logs = m.auditLog || [];
    const hasStatusChange = logs.some((l) => l.action === 'status_change');
    const hasFeedback = logs.some((l) => l.action === 'manual_feedback');
    if (hasStatusChange) {
      corrected++;
      // Track what the correction was TO
      const lastChange = [...logs].reverse().find((l) => l.action === 'status_change');
      if (lastChange?.to === 'ignored_spam') correctionsByType.spam++;
      else if (lastChange?.to === 'ready_for_crm') correctionsByType.client++;
      else if (lastChange?.to === 'review') correctionsByType.vendor++;
    }
    if (hasFeedback) feedbackCount++;
  }

  const accuracy = total > 0 ? ((total - corrected) / total * 100).toFixed(1) : 100;
  const accuracyColor = accuracy >= 90 ? 'var(--green)' : accuracy >= 70 ? 'var(--amber)' : 'var(--rose)';

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:12px;margin-bottom:12px;">
      <div class="kpi-card"><div class="kpi-label">Точность</div><div class="kpi-value" style="color:${accuracyColor}">${accuracy}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Всего писем</div><div class="kpi-value">${total}</div></div>
      <div class="kpi-card"><div class="kpi-label">Скорректировано</div><div class="kpi-value rose">${corrected}</div></div>
      <div class="kpi-card"><div class="kpi-label">Feedback писем</div><div class="kpi-value accent">${feedbackCount}</div></div>
    </div>
    ${corrected > 0 ? `<div style="font-size:11px;color:var(--text-muted);">
      Коррекции: → Клиент: ${correctionsByType.client}, → Спам: ${correctionsByType.spam}, → Поставщик: ${correctionsByType.vendor}
    </div>` : '<div style="font-size:11px;color:var(--green);">Все классификации корректны</div>'}
  `;
}

function renderFieldCoverage() {
  const el = $('#field-coverage');
  if (!el) return;

  const total = allRunnerMessages.length;
  if (total === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">Нет данных</div>';
    return;
  }

  const fields = [
    { label: 'Артикул', filter: 'missing_article', ok: (a) => (a.lead?.articles || []).length > 0 || (a.lead?.lineItems || []).some((item) => item.article) },
    { label: 'Бренд', filter: 'missing_brand', ok: (a) => (a.detectedBrands || a.lead?.detectedBrands || []).length > 0 },
    { label: 'Наименование', filter: 'missing_name', ok: (a) => getLeadProductNameList(a.lead || {}).length > 0 || (a.lead?.lineItems || []).some((item) => getLineItemName(item, a.lead || {})) },
    { label: 'Компания', filter: 'missing_company', ok: (a) => Boolean(a.sender?.companyName || a.crm?.company?.legalName) },
    { label: 'Телефон', filter: 'missing_phone', ok: (a) => Boolean(a.sender?.mobilePhone || a.sender?.cityPhone) },
    { label: 'ИНН', filter: 'missing_inn', ok: (a) => Boolean(a.sender?.inn) },
    { label: 'Разбор вложений', filter: 'attachments_unparsed', ok: (a, msg) => {
      const attachments = msg.attachments || [];
      if (!attachments.length) return true;
      const files = a.attachmentAnalysis?.files || [];
      return files.some((file) => file.status === 'processed');
    } }
  ];

  const stats = fields.map((field) => {
    const found = allRunnerMessages.filter((msg) => field.ok(msg.analysis || {}, msg)).length;
    const missing = total - found;
    const pct = Math.round(found / total * 100);
    return { ...field, found, missing, pct };
  });

  const strongest = [...stats].sort((a, b) => b.pct - a.pct)[0];
  const weakest = [...stats].sort((a, b) => a.pct - b.pct)[0];
  const weakDetectionCount = allRunnerMessages.filter((msg) => matchesRecognitionFilter(msg, 'weak_detection')).length;
  const conflictCount = allRunnerMessages.filter((msg) => matchesRecognitionFilter(msg, 'has_conflicts')).length;
  const keyFieldGaps = allRunnerMessages.filter((msg) => {
    const a = msg.analysis || {};
    const hasArticle = (a.lead?.articles || []).length > 0;
    const hasName = getLeadProductNameList(a.lead || {}).length > 0;
    const hasBrand = (a.detectedBrands || []).length > 0;
    return !(hasArticle && (hasName || hasBrand));
  }).length;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:12px;">
      <div class="kpi-card"><div class="kpi-label">Лучшее покрытие</div><div class="kpi-value green">${strongest?.pct || 0}%</div><div style="font-size:11px;color:var(--text-muted);">${esc(strongest?.label || '—')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Слабое место</div><div class="kpi-value rose">${weakest?.pct || 0}%</div><div style="font-size:11px;color:var(--text-muted);">${esc(weakest?.label || '—')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Слабый детект</div><div class="kpi-value amber">${weakDetectionCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Конфликты</div><div class="kpi-value rose">${conflictCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Писем с влож.</div><div class="kpi-value accent">${allRunnerMessages.filter((msg) => (msg.attachments || []).length > 0).length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Без ключ. полей</div><div class="kpi-value amber">${keyFieldGaps}</div></div>
    </div>
    <div style="display:grid;gap:8px;">
      ${stats.map((item) => `
        <button onclick="window.__openRecognitionFilter('${item.filter}')" style="display:grid;grid-template-columns:140px 1fr 72px 58px;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-0);cursor:pointer;text-align:left;">
          <span style="font-size:12px;font-weight:600;color:var(--text);">${esc(item.label)}</span>
          <span style="height:10px;background:var(--surface-2);border-radius:999px;overflow:hidden;">
            <span style="display:block;height:100%;width:${item.pct}%;background:${item.pct >= 80 ? 'var(--green)' : item.pct >= 50 ? 'var(--amber)' : 'var(--rose)'};"></span>
          </span>
          <span style="font-size:12px;font-weight:700;color:${item.pct >= 80 ? 'var(--green)' : item.pct >= 50 ? 'var(--amber)' : 'var(--rose)'};">${item.pct}%</span>
          <span style="font-size:11px;color:var(--text-muted);">нет ${item.missing}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function renderWeeklyTrends() {
  const el = $('#weekly-trends');
  if (!el) return;

  if (allRunnerMessages.length === 0) { el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">Нет данных</div>'; return; }

  // Group messages by ISO week
  const weekMap = new Map();
  for (const m of allRunnerMessages) {
    const d = new Date(m.createdAt || 0);
    if (isNaN(d.getTime())) continue;
    // Week key: YYYY-Www
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    const weekKey = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    if (!weekMap.has(weekKey)) weekMap.set(weekKey, { total: 0, client: 0, spam: 0, brands: new Set() });
    const w = weekMap.get(weekKey);
    w.total++;
    if (m.pipelineStatus === 'ready_for_crm' || m.pipelineStatus === 'needs_clarification') w.client++;
    if (m.pipelineStatus === 'ignored_spam') w.spam++;
    (m.analysis?.detectedBrands || []).forEach((b) => w.brands.add(b));
  }

  const weeks = [...weekMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8);
  if (weeks.length < 2) { el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">Недостаточно данных для трендов (нужно 2+ недели)</div>'; return; }

  const maxTotal = Math.max(1, ...weeks.map(([, w]) => w.total));

  el.innerHTML = `
    <div style="display:flex;align-items:flex-end;gap:6px;height:120px;">
      ${weeks.map(([key, w]) => {
        const totalH = Math.round(w.total / maxTotal * 100);
        const clientH = Math.round(w.client / maxTotal * 100);
        const spamH = Math.round(w.spam / maxTotal * 100);
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">
          <div style="width:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100px;">
            <div title="Заявки: ${w.client}" style="width:80%;background:var(--green);border-radius:3px 3px 0 0;height:${clientH}px;min-height:${w.client ? 2 : 0}px;"></div>
            <div title="Спам: ${w.spam}" style="width:80%;background:var(--rose);height:${spamH}px;min-height:${w.spam ? 2 : 0}px;"></div>
            <div title="Прочие: ${w.total - w.client - w.spam}" style="width:80%;background:var(--border);border-radius:0 0 3px 3px;height:${totalH - clientH - spamH}px;min-height:${(w.total - w.client - w.spam) ? 2 : 0}px;"></div>
          </div>
          <div style="font-size:9px;color:var(--text-muted);white-space:nowrap;">${key.slice(5)}</div>
          <div style="font-size:10px;font-weight:600;">${w.total}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:12px;margin-top:8px;font-size:10px;color:var(--text-muted);justify-content:center;">
      <span><span style="display:inline-block;width:8px;height:8px;background:var(--green);border-radius:2px;margin-right:3px;"></span>Заявки</span>
      <span><span style="display:inline-block;width:8px;height:8px;background:var(--rose);border-radius:2px;margin-right:3px;"></span>Спам</span>
      <span><span style="display:inline-block;width:8px;height:8px;background:var(--border);border-radius:2px;margin-right:3px;"></span>Прочие</span>
    </div>
  `;
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

  const renderMessageItem = (m, indent = false) => {
    const id = mid(m);
    const active = id === selectedMessageId ? 'active' : '';
    const checked = selectedMsgKeys.has(id) ? 'checked' : '';
    const isRead = readMessages.has(id);
    const a = m.analysis || {};
    const conf = a.classification?.confidence;
    const recognitionBadges = renderRecognitionBadges(a);
    const indentStyle = indent ? 'padding-left:24px;border-left:2px solid var(--border);' : '';
    return `<div class="message-item-wrap ${active}" data-mid="${esc(id)}" style="${indentStyle}">
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
        ${recognitionBadges ? `<div class="message-meta" style="margin-top:4px;flex-wrap:wrap;">${recognitionBadges}</div>` : ''}
        <div class="message-meta" style="margin-top:4px;">
          <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted);" title="${esc(id)}">ID: ${esc(truncate(id, 22))}</span>
        </div>
      </button>
    </div>`;
  };

  let listHtml;
  if (inboxGroupByThread) {
    const threads = groupByThreads(pageMessages);
    listHtml = threads.map((thread) => {
      if (thread.length === 1) {
        return renderMessageItem(thread[0]);
      }
      const latest = thread[thread.length - 1];
      const threadKey = 'thread-' + mid(latest);
      return `<div class="thread-group" data-thread="${esc(threadKey)}">
        <div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--surface);border-bottom:1px solid var(--border);cursor:pointer;font-size:11px;color:var(--text-muted);" data-toggle-thread="${esc(threadKey)}">
          <span style="font-size:9px;">&#9654;</span>
          <span style="font-weight:600;color:var(--text);">${esc(normalizeSubjectForThread(latest.subject) || 'Без темы')}</span>
          <span class="badge badge-unknown" style="font-size:9px;">${thread.length}</span>
          <span>${esc(getSenderDomain(latest))}</span>
        </div>
        ${thread.map((m, i) => renderMessageItem(m, i < thread.length - 1)).join('')}
      </div>`;
    }).join('');
  } else {
    listHtml = pageMessages.map((m) => renderMessageItem(m)).join('');
  }

  listEl.innerHTML = `<div class="select-all-wrap"><input type="checkbox" id="select-all-cb" ${allChecked ? 'checked' : ''} /><span>${pageMessages.length} на странице</span></div>` + listHtml;

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
        <span onclick="window.__copyField('${escAttr(msgKey)}')" title="Скопировать ID письма" style="cursor:pointer;font-family:'JetBrains Mono',monospace;"><strong>ID:</strong> ${esc(truncate(msgKey, 34))}</span>
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
  const productNameList = getLeadProductNameList(lead);
  const leadFields = [['Тип запроса', lead.requestType], ['Бренды', formatArr(a.detectedBrands || lead.detectedBrands)], ['Артикулы', formatArr(lead.articles)], ['Названия товара', formatArr(productNameList)], ['Позиций', lead.totalPositions], ['Фото шильдика', lead.hasNameplatePhotos ? 'Да' : null], ['Фото артикула', lead.hasArticlePhotos ? 'Да' : null]];
  const crmFields = [['Юрлицо найдено', crm.isExistingCompany ? 'Да' : 'Нет'], ['Компания CRM', crm.company?.legalName], ['МОП', crm.curatorMop], ['МОЗ', crm.curatorMoz], ['Уточнение', crm.needsClarification ? 'Требуется' : 'Нет']];
  const attachmentFiles = a.attachmentAnalysis?.files || [];
  const recognitionSummary = getRecognitionSummary(a);
  const primaryArticle = (lead.articles || [])[0] || lead.lineItems?.find((item) => item.article)?.article || '';
  const primaryProductName = getLeadProductNameList(lead)[0] || getLineItemName(lead.lineItems?.[0] || {}, lead) || '';
  const primaryPhone = sender.mobilePhone || sender.cityPhone || '';

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
      ${lead.lineItems?.length ? `<div style="margin-top:8px;"><table class="data-table" style="font-size:11px;"><thead><tr><th>Артикул</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th></tr></thead><tbody>${lead.lineItems.map((li) => `<tr><td>${esc(li.article)}</td><td style="min-width:180px;color:var(--text-secondary);">${esc(truncate(getLineItemName(li, lead), 90) || '—')}</td><td>${li.quantity}</td><td>${esc(li.unit)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Качество распознавания</div>
      ${renderRecognitionSummary(recognitionSummary)}
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Диагностика детекта</div>
      ${renderRecognitionDiagnostics(a)}
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Источники детекта</div>
      ${renderDetectionSources(a)}
    </div>
    ${attachmentFiles.length ? `<div class="detail-section">
      <div class="detail-section-title">Вложения</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${attachmentFiles.map((file) => renderAttachmentAnalysisCard(file)).join('')}
      </div>
    </div>` : ''}
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
      <div style="margin-bottom:8px;">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Коррекция брендов:</div>
        <div style="display:flex;gap:4px;">
          <input id="feedback-brand-${esc(msgKey)}" class="form-input" placeholder="Название бренда..." style="flex:1;font-size:11px;padding:4px 8px;" />
          <button class="btn btn-sm" style="font-size:10px;padding:2px 8px;background:var(--green-dim);color:var(--green);border:1px solid var(--green);" onclick="window.__feedbackBrand('${escAttr(msgKey)}','add')">+</button>
          <button class="btn btn-sm" style="font-size:10px;padding:2px 8px;background:var(--rose-dim);color:var(--rose);border:1px solid var(--rose);" onclick="window.__feedbackBrand('${escAttr(msgKey)}','remove')">−</button>
        </div>
      </div>
      <div style="margin-bottom:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-0);">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Быстрая коррекция полей:</div>
        <div style="display:grid;gap:6px;">
          <input id="feedback-company-${esc(msgKey)}" class="form-input" placeholder="Компания" value="${esc(sender.companyName || '')}" style="font-size:11px;padding:6px 8px;" />
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <input id="feedback-inn-${esc(msgKey)}" class="form-input" placeholder="ИНН" value="${esc(sender.inn || '')}" style="font-size:11px;padding:6px 8px;" />
            <input id="feedback-phone-${esc(msgKey)}" class="form-input" placeholder="Телефон" value="${esc(primaryPhone)}" style="font-size:11px;padding:6px 8px;" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <input id="feedback-article-${esc(msgKey)}" class="form-input" placeholder="Артикул" value="${esc(primaryArticle)}" style="font-size:11px;padding:6px 8px;font-family:'JetBrains Mono',monospace;" />
            <input id="feedback-name-${esc(msgKey)}" class="form-input" placeholder="Наименование" value="${esc(primaryProductName)}" style="font-size:11px;padding:6px 8px;" />
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-primary btn-sm" style="flex:1;" onclick="window.__saveFieldFeedback('${escAttr(msgKey)}')">Сохранить коррекцию</button>
            <button class="btn btn-ghost btn-sm" style="flex:1;" onclick="window.__clearFieldFeedback('${escAttr(msgKey)}')">Очистить форму</button>
          </div>
        </div>
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
      ${msg.auditLog.slice(-8).map((log) => `<div style="font-size:10px;color:var(--text-muted);padding:2px 0;display:flex;gap:6px;">
        <span style="color:var(--text-secondary);">${fmtDate(log.at)}</span>
        <span>${log.action === 'manual_feedback' ? esc((log.changes || []).join(', ')) : log.action === 'integration_ack' ? 'ACK: ' + esc(log.consumer || '') : esc((log.from || '?') + ' → ' + (log.to || '?'))}</span>
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
    const currentMsg = allRunnerMessages.find((m) => mid(m) === msgKey);
    const msgBrands = (currentMsg?.analysis?.detectedBrands || []).join(', ');
    const res = await fetch('/api/detection-kb/sender-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderEmail: byEmail ? email : '',
        senderDomain: byEmail ? '' : domain,
        classification,
        companyHint: companyHint || '',
        brandHint: msgBrands,
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

window.__feedbackBrand = async (msgKey, action) => {
  const input = $(`#feedback-brand-${msgKey}`);
  const brand = input?.value?.trim();
  if (!brand) { showToast('Введите название бренда'); return; }
  const currentMsg = allRunnerMessages.find((m) => mid(m) === msgKey);
  const pid = currentMsg?._projectId || P3_ID;
  const payload = action === 'add' ? { addBrands: [brand] } : { removeBrands: [brand] };
  try {
    const res = await fetch(`/api/projects/${pid}/messages/${encodeURIComponent(msgKey)}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) { showToast('Ошибка', true); return; }
    const data = await res.json();
    if (currentMsg && data.analysis) currentMsg.analysis = data.analysis;
    input.value = '';
    showToast(`${action === 'add' ? '+' : '−'} ${brand}`);
    renderInbox();
  } catch (e) { showToast('Ошибка: ' + e.message, true); }
};

window.__clearFieldFeedback = (msgKey) => {
  ['company', 'inn', 'phone', 'article', 'name'].forEach((field) => {
    const input = $(`#feedback-${field}-${msgKey}`);
    if (input) input.value = '';
  });
};

window.__saveFieldFeedback = async (msgKey) => {
  const currentMsg = allRunnerMessages.find((m) => mid(m) === msgKey);
  const pid = currentMsg?._projectId || P3_ID;
  const companyName = $(`#feedback-company-${msgKey}`)?.value?.trim() || '';
  const inn = $(`#feedback-inn-${msgKey}`)?.value?.trim() || '';
  const phone = $(`#feedback-phone-${msgKey}`)?.value?.trim() || '';
  const article = $(`#feedback-article-${msgKey}`)?.value?.trim() || '';
  const name = $(`#feedback-name-${msgKey}`)?.value?.trim() || '';

  if (!companyName && !inn && !phone && !article && !name) {
    showToast('Заполните хотя бы одно поле');
    return;
  }

  const payload = {
    companyName,
    inn,
    phone,
    addArticles: article ? [article] : [],
    productNames: article && name ? [{ article, name }] : []
  };

  try {
    const res = await fetch(`/api/projects/${pid}/messages/${encodeURIComponent(msgKey)}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      showToast('Ошибка сохранения', true);
      return;
    }
    const data = await res.json();
    if (currentMsg && data.analysis) currentMsg.analysis = data.analysis;
    showToast('Коррекция сохранена');
    renderDashboard();
    renderInbox();
  } catch (e) {
    showToast('Ошибка: ' + e.message, true);
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
    ${lead.lineItems?.length ? `<div style="margin-top:16px;"><div class="detail-section-title" style="margin-bottom:8px;">Позиции</div><table class="data-table" style="font-size:12px;"><thead><tr><th>Артикул</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Описание</th></tr></thead><tbody>${lead.lineItems.map((li) => `<tr><td><strong>${esc(li.article)}</strong></td><td>${esc(truncate(getLineItemName(li, lead), 70) || '—')}</td><td>${li.quantity}</td><td>${esc(li.unit)}</td><td style="color:var(--text-muted);font-size:11px;">${esc(truncate(li.descriptionRu, 60))}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${rules.length ? `<div style="margin-top:16px;"><div class="detail-section-title" style="margin-bottom:8px;">Правила</div>${rules.map((r) => `<div style="font-size:11px;padding:3px 0;display:flex;gap:6px;align-items:center;"><span class="badge ${r.classifier === 'spam' ? 'badge-spam' : r.classifier === 'client' ? 'badge-client' : 'badge-vendor'}" style="font-size:9px;">${esc(r.classifier)}</span><span style="color:var(--text-muted);font-family:'JetBrains Mono',monospace;font-size:10px;">${esc(truncate(r.pattern, 40))}</span><span style="color:var(--green);font-weight:600;margin-left:auto;">+${r.weight}</span></div>`).join('')}</div>` : ''}
    ${data.suggestedReply || crm.suggestedReply ? `<div style="margin-top:16px;"><div class="detail-section-title" style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;">Шаблон ответа <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;" onclick="window.__copyField(\`${escAttr(data.suggestedReply || crm.suggestedReply)}\`);this.textContent='Скопировано';setTimeout(()=>this.textContent='Копировать',1500)">Копировать</button></div><div style="background:var(--surface-0);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;font-size:12px;white-space:pre-wrap;color:var(--text-secondary);">${esc(data.suggestedReply || crm.suggestedReply)}</div></div>` : ''}
  `;
}

function renderKb() {
  const container = $('#kb-content');
  if (!kbData) { container.innerHTML = '<div class="empty-state"><div class="empty-icon">📚</div><h4>Загрузка...</h4></div>'; return; }

  if (kbTab === 'stats') {
    const s = kbData.stats || {};
    container.innerHTML = `<div style="padding:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">${[['Правил', s.ruleCount],['Brand aliases', s.brandAliasCount],['Профилей', s.senderProfileCount],['Паттернов', s.fieldPatternCount],['Корпус', s.corpusCount],['Номенклатура', s.nomenclatureCount],['Own brands', s.ownBrandCount]].map(([l,v]) => `<div class="kpi-card"><div class="kpi-label">${esc(l)}</div><div class="kpi-value accent">${v ?? '—'}</div></div>`).join('')}</div>`;
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
        <table class="data-table"><thead><tr><th>Email / Домен</th><th>Компания</th><th>Brand hint</th><th>Заметки</th><th></th></tr></thead>
        <tbody>${profiles.map((s) => `<tr>
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${esc(s.sender_email || `@${s.sender_domain}` || '—')}</td>
          <td>${esc(s.company_hint || '—')}</td>
          <td style="font-size:11px;color:var(--text-secondary);">${esc(s.brand_hint || '—')}</td>
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
    return;
  }
  if (kbTab === 'autolearn') {
    const senderProfiles = kbData.autoLearnedSenderProfiles || [];
    const learnedNomenclature = kbData.learnedNomenclature || [];

    container.innerHTML = `
      <div style="padding:16px;display:grid;gap:16px;">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-size:13px;font-weight:700;color:var(--text);">Автообученные профили отправителей</div>
            <span class="badge badge-client" style="font-size:10px;">${senderProfiles.length}</span>
          </div>
          ${senderProfiles.length ? `
            <table class="data-table"><thead><tr><th>Email / Домен</th><th>Компания</th><th>Brand hint</th><th>Заметки</th><th></th></tr></thead>
            <tbody>${senderProfiles.map((s) => `<tr>
              <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${esc(s.sender_email || `@${s.sender_domain}` || '—')}</td>
              <td>${esc(s.company_hint || '—')}</td>
              <td style="font-size:11px;color:var(--text-secondary);">${esc(s.brand_hint || '—')}</td>
              <td style="font-size:11px;color:var(--text-muted);">${esc(s.notes || '')}</td>
              <td><button class="btn btn-danger btn-sm" style="padding:2px 6px;font-size:10px;" data-del-autosender="${s.id}">×</button></td>
            </tr>`).join('')}</tbody></table>
          ` : '<div class="empty-state" style="padding:24px"><h4>Пока пусто</h4><p>Появится после ручных коррекций писем</p></div>'}
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-size:13px;font-weight:700;color:var(--text);">Номенклатура из manual feedback</div>
            <span class="badge badge-unknown" style="font-size:10px;">${learnedNomenclature.length}</span>
          </div>
          ${learnedNomenclature.length ? `
            <table class="data-table"><thead><tr><th>Артикул</th><th>Бренд</th><th>Наименование</th><th>Источник</th><th></th></tr></thead>
            <tbody>${learnedNomenclature.map((item) => `<tr>
              <td style="font-family:'JetBrains Mono',monospace;font-size:11px;"><strong>${esc(item.article)}</strong></td>
              <td>${esc(item.brand || '—')}</td>
              <td style="font-size:11px;color:var(--text-secondary);">${esc(truncate(item.product_name || item.description || '—', 80))}</td>
              <td style="font-size:11px;color:var(--text-muted);">${esc(item.source_file || 'manual_feedback')}</td>
              <td><button class="btn btn-danger btn-sm" style="padding:2px 6px;font-size:10px;" data-del-nlearn="${item.id}">×</button></td>
            </tr>`).join('')}</tbody></table>
          ` : '<div class="empty-state" style="padding:24px"><h4>Пока пусто</h4><p>Появится после ручных коррекций артикула и наименования</p></div>'}
        </div>
      </div>`;

    container.querySelectorAll('[data-del-autosender]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Отключить этот автообученный профиль?')) return;
        await fetch(`/api/detection-kb/sender-profiles/${btn.dataset.delAutosender}`, { method: 'DELETE' });
        await refreshKb();
        showToast('Автообученный профиль отключён');
      });
    });
    container.querySelectorAll('[data-del-nlearn]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить эту номенклатурную подсказку?')) return;
        await fetch(`/api/detection-kb/nomenclature/${btn.dataset.delNlearn}`, { method: 'DELETE' });
        await refreshKb();
        showToast('Номенклатурная подсказка удалена');
      });
    });
    return;
  }
  if (kbTab === 'search') {
    container.innerHTML = `
      <div style="padding:16px;">
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <input type="text" id="kb-search-input" placeholder="Поиск по теме, телу, отправителю, брендам..." style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-size:13px;">
          <button class="btn btn-primary btn-sm" id="kb-search-btn">Найти</button>
        </div>
        <div id="kb-search-results"><div class="empty-state" style="padding:24px"><h4>Введите запрос для поиска по корпусу</h4><p>FTS5 полнотекстовый поиск с поддержкой русского и латинского текста</p></div></div>
      </div>`;
    const input = $('#kb-search-input');
    const resultsDiv = $('#kb-search-results');
    const doSearch = async () => {
      const q = input.value.trim();
      if (!q) return;
      resultsDiv.innerHTML = '<div style="padding:16px;color:var(--text-muted)">Поиск...</div>';
      try {
        const resp = await fetch('/api/detection-kb/corpus/search?q=' + encodeURIComponent(q) + '&limit=50');
        const data = await resp.json();
        if (!data.results || !data.results.length) {
          resultsDiv.innerHTML = '<div class="empty-state" style="padding:24px"><h4>Ничего не найдено</h4></div>';
          return;
        }
        resultsDiv.innerHTML = '<div style="margin-bottom:8px;font-size:12px;color:var(--text-muted)">Найдено: ' + data.results.length + '</div>' +
          '<table class="data-table"><thead><tr><th>Тема</th><th>Отправитель</th><th>Классификация</th><th>Бренды</th><th>Компания</th></tr></thead><tbody>' +
          data.results.map((r) => '<tr>' +
            '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(r.subject) + '">' + esc(truncate(r.subject, 60)) + '</td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace;font-size:11px;">' + esc(r.sender_email) + '</td>' +
            '<td>' + classificationBadge(r.classification) + '</td>' +
            '<td style="font-size:11px;">' + esc(truncate(r.brand_names, 40)) + '</td>' +
            '<td style="font-size:11px;">' + esc(r.company_name || '') + '</td>' +
          '</tr>').join('') +
          '</tbody></table>';
      } catch (e) {
        resultsDiv.innerHTML = '<div style="padding:16px;color:var(--red)">Ошибка: ' + esc(e.message) + '</div>';
      }
    };
    $('#kb-search-btn').addEventListener('click', doSearch);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
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

function getLeadProductNameList(lead = {}) {
  const names = [
    ...(lead.productNames || []).map((item) => item?.name),
    ...(lead.nomenclatureMatches || []).map((item) => item?.productName || item?.description),
    ...(lead.lineItems || []).map((item) => item?.descriptionRu)
  ];
  return [...new Set(names.map((value) => cleanupProductName(value)).filter(Boolean))];
}

function getLineItemName(lineItem = {}, lead = {}) {
  const article = normalizeUiArticle(lineItem.article);
  if (!article) return cleanupProductName(lineItem.descriptionRu) || '';

  const productNameMatch = (lead.productNames || []).find((item) => normalizeUiArticle(item.article) === article);
  const nomenclatureMatch = (lead.nomenclatureMatches || []).find((item) => normalizeUiArticle(item.article) === article);
  return cleanupProductName(
    productNameMatch?.name ||
    nomenclatureMatch?.productName ||
    nomenclatureMatch?.description ||
    lineItem.descriptionRu
  ) || '';
}

function normalizeUiArticle(value) {
  return String(value || '').trim().toUpperCase();
}

function cleanupProductName(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/^арт\.?\s*:/i.test(text)) return '';
  if (/^(шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?)\.?$/i.test(text)) return '';
  if (/^\d+(?:[.,]\d+)?$/.test(text)) return '';
  return text;
}

function renderAttachmentAnalysisCard(file) {
  const status = file.status === 'processed'
    ? '<span class="badge badge-client">обработан</span>'
    : '<span class="badge badge-unknown">пропущен</span>';
  const reason = file.reason ? `<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Причина: ${esc(file.reason)}</div>` : '';
  const detected = [
    file.detectedArticles?.length ? `Артикулы: ${file.detectedArticles.slice(0, 5).join(', ')}` : '',
    file.detectedInn?.length ? `ИНН: ${file.detectedInn.slice(0, 3).join(', ')}` : '',
    file.detectedKpp?.length ? `КПП: ${file.detectedKpp.slice(0, 3).join(', ')}` : '',
    file.detectedOgrn?.length ? `ОГРН: ${file.detectedOgrn.slice(0, 3).join(', ')}` : ''
  ].filter(Boolean);

  return `<div style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-0);">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
      <div style="min-width:0;">
        <div style="font-size:11px;font-weight:600;color:var(--text);word-break:break-word;">${esc(file.filename || 'Без имени')}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${esc(file.category || 'other')}${file.extractedChars ? `, текст ${file.extractedChars} симв.` : ''}</div>
      </div>
      ${status}
    </div>
    ${detected.length ? `<div style="font-size:10px;color:var(--text-secondary);margin-top:6px;">${esc(detected.join(' | '))}</div>` : ''}
    ${reason}
  </div>`;
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

async function refreshApiClients() {
  const el = $('#api-clients-list');
  if (!el) return;
  try {
    const data = await fetch('/api/detection-kb/api-clients').then((r) => r.json());
    const clients = data.clients || [];
    if (clients.length === 0) {
      el.innerHTML = '<div style="padding:16px;color:var(--text-tertiary);font-size:13px;">Нет API-клиентов. Нажмите «+ Создать клиента» чтобы сгенерировать ключ.</div>';
      return;
    }
    el.innerHTML = `<table class="data-table"><thead><tr>
      <th>Name</th><th>API Key</th><th>Projects</th><th>Webhook</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody>${clients.map((c) => `<tr>
      <td><strong>${esc(c.name)}</strong><div style="font-size:10px;color:var(--text-tertiary);">${esc(c.id)}</div></td>
      <td><code style="font-size:11px;background:var(--bg-tertiary);padding:2px 6px;border-radius:4px;user-select:all;">${esc(c.apiKey)}</code></td>
      <td style="font-size:11px;">${c.projectIds.length ? c.projectIds.map((p) => `<span class="badge" style="font-size:10px;">${esc(p)}</span>`).join(' ') : '<span style="color:var(--text-tertiary);">all</span>'}</td>
      <td style="font-size:11px;">${c.webhookUrl ? `<span style="color:var(--green);">${esc(truncate(c.webhookUrl, 30))}</span>` : '<span style="color:var(--text-tertiary);">-</span>'}</td>
      <td>${c.enabled ? '<span style="color:var(--green);">Active</span>' : '<span style="color:var(--rose);">Disabled</span>'}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-ghost btn-sm" onclick="regenerateClientKey('${escAttr(c.id)}')" title="Перегенерировать ключ">Regen</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleClient('${escAttr(c.id)}', ${!c.enabled})">${c.enabled ? 'Off' : 'On'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteClient('${escAttr(c.id)}')">Del</button>
      </td>
    </tr>`).join('')}</tbody></table>`;
  } catch {
    el.innerHTML = '<div style="padding:16px;color:var(--rose);">Failed to load clients</div>';
  }
}

window.regenerateClientKey = async function(id) {
  if (!confirm('Перегенерировать API-ключ? Старый ключ перестанет работать.')) return;
  await fetch(`/api/detection-kb/api-clients/${id}/regenerate`, { method: 'POST' });
  refreshApiClients();
};

window.toggleClient = async function(id, enabled) {
  await fetch(`/api/detection-kb/api-clients/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
  refreshApiClients();
};

window.deleteClient = async function(id) {
  if (!confirm('Удалить API-клиента?')) return;
  await fetch(`/api/detection-kb/api-clients/${id}`, { method: 'DELETE' });
  refreshApiClients();
};

async function refreshApiDocsHealth() {
  const el = $('#api-health-status');
  const extraEl = $('#api-ops-health-extra');
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
        <div style="padding:10px 16px;border-radius:8px;background:var(--bg-tertiary);flex:1;min-width:140px;">
          <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;">AI Classification</div>
          <div style="font-size:18px;font-weight:700;color:${health.ai?.enabled ? 'var(--green)' : 'var(--text-muted)'};">${health.ai?.enabled ? 'ON' : 'OFF'}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">${health.ai?.enabled ? health.ai.model : 'AI_ENABLED=false'}</div>
        </div>
        <div style="padding:10px 16px;border-radius:8px;background:var(--bg-tertiary);flex:1;min-width:140px;">
          <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;">SSE / Rate Limit</div>
          <div style="font-size:18px;font-weight:700;color:var(--accent);">${health.sse?.clients || 0} / ${health.rateLimit?.max || '-'}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">Clients / req/min</div>
        </div>
      </div>`;
    if (extraEl) {
      extraEl.innerHTML = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <span>Running jobs: <strong>${health.background?.runningJobs || 0}</strong></span>
          <span>Failed jobs: <strong>${health.background?.failedJobs || 0}</strong></span>
          <span>Retained jobs: <strong>${health.background?.retainedJobs || 0}</strong></span>
        </div>`;
    }
  } catch {
    el.innerHTML = '<span style="color:var(--rose);">Failed to load API health</span>';
    if (extraEl) extraEl.textContent = '';
  }
}

$('#api-refresh-health-btn')?.addEventListener('click', async () => {
  $('#api-ops-status').textContent = 'Обновляю...';
  await refreshApiDocsHealth();
  $('#api-ops-status').textContent = 'Health обновлён';
  setTimeout(() => { $('#api-ops-status').textContent = ''; }, 2000);
});

$('#api-cleanup-jobs-btn')?.addEventListener('click', async () => {
  $('#api-ops-status').textContent = 'Очищаю...';
  try {
    const res = await fetch('/api/admin/background-jobs/cleanup', { method: 'POST' });
    const data = await res.json();
    await refreshApiDocsHealth();
    $('#api-ops-status').textContent = `Удалено jobs: ${data.removed ?? 0}`;
  } catch (e) {
    $('#api-ops-status').textContent = 'Ошибка очистки';
  }
  setTimeout(() => { $('#api-ops-status').textContent = ''; }, 2500);
});

// ═══ CRM Config ═══
async function refreshCrmConfig() {
  const el = $('#crm-config-panel');
  if (!el) return;
  try {
    const res = await fetch(`/api/projects/${P3_ID}/crm-config`);
    const data = await res.json();
    const c = data.config || {};
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:600px;">
        <label style="font-size:11px;color:var(--text-muted);">
          <span>Enabled</span>
          <select id="crm-enabled" class="form-select" style="font-size:11px;padding:4px 8px;margin-top:2px;width:100%;">
            <option value="false" ${!c.enabled ? 'selected' : ''}>OFF</option>
            <option value="true" ${c.enabled ? 'selected' : ''}>ON</option>
          </select>
        </label>
        <label style="font-size:11px;color:var(--text-muted);">
          <span>CRM Type</span>
          <select id="crm-type" class="form-select" style="font-size:11px;padding:4px 8px;margin-top:2px;width:100%;">
            <option value="generic" ${c.type === 'generic' ? 'selected' : ''}>Generic Webhook</option>
            <option value="amocrm" ${c.type === 'amocrm' ? 'selected' : ''}>amoCRM</option>
            <option value="bitrix24" ${c.type === 'bitrix24' ? 'selected' : ''}>Bitrix24</option>
            <option value="1c" ${c.type === '1c' ? 'selected' : ''}>1С</option>
          </select>
        </label>
        <label style="font-size:11px;color:var(--text-muted);">
          <span>Base URL</span>
          <input id="crm-base-url" class="form-input" value="${esc(c.baseUrl || '')}" placeholder="https://crm.example.com" style="font-size:11px;padding:4px 8px;margin-top:2px;width:100%;" />
        </label>
        <label style="font-size:11px;color:var(--text-muted);">
          <span>API Key</span>
          <input id="crm-api-key" class="form-input" type="password" value="${esc(c.apiKey || '')}" placeholder="API key or token" style="font-size:11px;padding:4px 8px;margin-top:2px;width:100%;" />
        </label>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" id="crm-save-btn">Сохранить</button>
        <span id="crm-save-status" style="font-size:11px;color:var(--text-muted);line-height:30px;"></span>
      </div>`;

    $('#crm-save-btn').addEventListener('click', async () => {
      const body = {
        enabled: $('#crm-enabled').value === 'true',
        type: $('#crm-type').value,
        baseUrl: $('#crm-base-url').value,
        apiKey: $('#crm-api-key').value
      };
      const r = await fetch('/api/projects/' + P3_ID + '/crm-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      $('#crm-save-status').textContent = r.ok ? 'Сохранено' : 'Ошибка';
      setTimeout(() => $('#crm-save-status').textContent = '', 2000);
    });

    $('#crm-sync-btn')?.addEventListener('click', async () => {
      const btn = $('#crm-sync-btn');
      btn.disabled = true;
      btn.textContent = 'Syncing...';
      try {
        const r = await fetch('/api/projects/' + P3_ID + '/crm-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 50 })
        });
        const data = await r.json();
        showToast(`CRM Sync: ${data.synced} synced, ${data.failed} failed, ${data.skipped} skipped`);
      } catch (e) {
        showToast('CRM Sync error: ' + e.message, true);
      }
      btn.disabled = false;
      btn.textContent = 'Sync Now';
    });
  } catch {
    el.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">CRM config unavailable</span>';
  }
}
