// ═══════════════════════════════════════════════════════════════
//  UI ENHANCEMENTS — loaded AFTER app.js
//  Toasts · Tooltips · Keyboard shortcuts · Command palette ⌘K
//  View transitions · Drag-and-drop reclassify · Hover-card
// ═══════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // ─────────────────────────────────────────────────────────────
  //  1. TOASTS (stacked, 4 types, auto-dismiss)
  // ─────────────────────────────────────────────────────────────
  function ensureToastContainer() {
    let c = $('#toast-stack');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toast-stack';
      document.body.appendChild(c);
    }
    return c;
  }

  function toast(message, opts = {}) {
    const type = opts.type || 'info'; // 'success' | 'error' | 'info' | 'warning'
    const duration = opts.duration ?? (type === 'error' ? 5000 : 3000);
    const container = ensureToastContainer();
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    el.innerHTML = `
      <span class="toast-icon">${icons[type] || ''}</span>
      <span class="toast-msg">${esc(message)}</span>
      ${opts.action ? `<button class="toast-action" type="button">${esc(opts.action.label)}</button>` : ''}
      <button class="toast-close" type="button" aria-label="Закрыть">×</button>
    `;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    const dismiss = () => {
      el.classList.remove('show');
      el.classList.add('hide');
      setTimeout(() => el.remove(), 220);
    };
    const timer = duration > 0 ? setTimeout(dismiss, duration) : null;

    el.querySelector('.toast-close').addEventListener('click', () => { if (timer) clearTimeout(timer); dismiss(); });
    if (opts.action) {
      el.querySelector('.toast-action').addEventListener('click', () => {
        try { opts.action.onClick(); } catch (e) { console.error(e); }
        if (timer) clearTimeout(timer); dismiss();
      });
    }
    return { dismiss };
  }

  window.toast = toast;
  window.toast.success = (m, o) => toast(m, { ...o, type: 'success' });
  window.toast.error   = (m, o) => toast(m, { ...o, type: 'error' });
  window.toast.info    = (m, o) => toast(m, { ...o, type: 'info' });
  window.toast.warning = (m, o) => toast(m, { ...o, type: 'warning' });

  // Override native alert to route through toasts (non-blocking, no OS dialog)
  const nativeAlert = window.alert.bind(window);
  window.alert = function (msg) {
    const text = String(msg ?? '');
    const isErr = /ошибк|error|fail|не удалось|отменё|отменен/i.test(text);
    toast(text, { type: isErr ? 'error' : 'info', duration: 4000 });
  };

  // ─────────────────────────────────────────────────────────────
  //  2. TOOLTIPS ([data-tooltip="text"])
  // ─────────────────────────────────────────────────────────────
  let tooltipEl;
  let tooltipTarget;
  let tooltipTimer;

  function ensureTooltipEl() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'ui-tooltip';
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function positionTooltip(target) {
    const tip = ensureTooltipEl();
    const r = target.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const gap = 6;
    let top = r.top - tr.height - gap;
    let left = r.left + r.width / 2 - tr.width / 2;
    if (top < 4) top = r.bottom + gap;
    if (left < 4) left = 4;
    if (left + tr.width > window.innerWidth - 4) left = window.innerWidth - tr.width - 4;
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
  }

  function showTooltip(target) {
    const text = target.dataset.tooltip;
    if (!text) return;
    const tip = ensureTooltipEl();
    tip.textContent = text;
    tip.classList.add('show');
    positionTooltip(target);
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.remove('show');
    tooltipTarget = null;
  }

  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('[data-tooltip]');
    if (!t || t === tooltipTarget) return;
    tooltipTarget = t;
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => { if (tooltipTarget === t) showTooltip(t); }, 350);
  });
  document.addEventListener('mouseout', (e) => {
    if (!e.target.closest?.('[data-tooltip]')) return;
    clearTimeout(tooltipTimer);
    hideTooltip();
  });
  document.addEventListener('scroll', hideTooltip, true);

  // ─────────────────────────────────────────────────────────────
  //  3. KEYBOARD SHORTCUTS
  //     g i  → Входящие         g d  → Дашборд
  //     g k  → База знаний      g p  → Проекты
  //     /    → фокус в поиск    esc  → закрыть модалку
  //     ⌘K   → открыть палитру
  // ─────────────────────────────────────────────────────────────
  const NAV_TARGETS = { i: 'inbox', d: 'dashboard', k: 'kb', p: 'projects', a: 'analyze' };
  let gSeq = false; let gSeqTimer;

  function isEditable(el) {
    if (!el) return false;
    const t = (el.tagName || '').toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select' || el.isContentEditable;
  }

  function goTo(page) {
    const btn = $(`.nav-item[data-page="${page}"]`);
    if (btn) btn.click();
  }

  function focusSearch() {
    // prefer visible search input on current page
    const candidates = [
      $('#page-inbox.active input[type="search"]'),
      $('#page-inbox.active input[placeholder*="оиск" i]'),
      $('.page.active input[type="search"]'),
      $('.page.active input[placeholder*="оиск" i]'),
      $('input[type="search"]'),
      $('input[placeholder*="оиск" i]')
    ].filter(Boolean);
    const t = candidates[0];
    if (t) { t.focus(); t.select?.(); return true; }
    return false;
  }

  function closeTopmostOverlay() {
    // Command palette first
    if ($('#cmd-palette')?.classList.contains('show')) { closeCmdPalette(); return true; }
    // Integration JSON modal (app.js creates a backdrop with z-index 9998)
    const backdrops = $$('div').filter((d) => /position:\s*fixed/.test(d.style.cssText) && /z-index:\s*9998/.test(d.style.cssText));
    if (backdrops.length) { backdrops[backdrops.length - 1].remove(); return true; }
    return false;
  }

  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl+K → command palette
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openCmdPalette();
      return;
    }

    if (e.key === 'Escape') {
      if (closeTopmostOverlay()) { e.preventDefault(); return; }
    }

    if (isEditable(document.activeElement)) return;

    // "/" → focus search
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (focusSearch()) e.preventDefault();
      return;
    }

    // g then [i,d,k,p,a]
    if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
      gSeq = true;
      clearTimeout(gSeqTimer);
      gSeqTimer = setTimeout(() => { gSeq = false; }, 900);
      return;
    }
    if (gSeq && NAV_TARGETS[e.key]) {
      e.preventDefault();
      gSeq = false; clearTimeout(gSeqTimer);
      goTo(NAV_TARGETS[e.key]);
      return;
    }
    gSeq = false;
  });

  // ─────────────────────────────────────────────────────────────
  //  4. COMMAND PALETTE ⌘K
  // ─────────────────────────────────────────────────────────────
  let cmdPaletteEl; let cmdPaletteIdx = 0; let cmdPaletteItems = [];

  function ensureCmdPalette() {
    if (cmdPaletteEl) return cmdPaletteEl;
    const el = document.createElement('div');
    el.id = 'cmd-palette';
    el.innerHTML = `
      <div class="cmd-palette-backdrop"></div>
      <div class="cmd-palette-card" role="dialog" aria-label="Командная палитра">
        <div class="cmd-palette-input-wrap">
          <span class="cmd-palette-kbd">⌘K</span>
          <input class="cmd-palette-input" type="text" placeholder="Введите команду или номер страницы…" autocomplete="off" spellcheck="false" />
        </div>
        <div class="cmd-palette-list" role="listbox"></div>
        <div class="cmd-palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> навигация</span>
          <span><kbd>↵</kbd> выбрать</span>
          <span><kbd>esc</kbd> закрыть</span>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelector('.cmd-palette-backdrop').addEventListener('click', closeCmdPalette);
    const input = el.querySelector('.cmd-palette-input');
    input.addEventListener('input', () => renderCmdPalette(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); cmdPaletteIdx = Math.min(cmdPaletteItems.length - 1, cmdPaletteIdx + 1); updateCmdHighlight(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cmdPaletteIdx = Math.max(0, cmdPaletteIdx - 1); updateCmdHighlight(); }
      else if (e.key === 'Enter') { e.preventDefault(); runCmdSelected(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeCmdPalette(); }
    });
    cmdPaletteEl = el;
    return el;
  }

  function buildCmdRegistry() {
    const items = [];

    // Pages (discovered from sidebar)
    const pageLabels = {
      dashboard: { label: 'Дашборд', hint: 'g d', icon: '📊' },
      inbox: { label: 'Входящие', hint: 'g i', icon: '📥' },
      analyze: { label: 'Тест разбора письма', hint: 'g a', icon: '🔬' },
      project2: { label: 'Project 2 · Tender Parser', hint: '', icon: '📑' },
      project3: { label: 'Project 3 · Mailbox Parser', hint: '', icon: '📬' },
      project4: { label: 'Project 4 · Klvrt Mail', hint: '', icon: '✉️' },
      projects: { label: 'Все проекты', hint: 'g p', icon: '🗂️' },
      kb: { label: 'База знаний', hint: 'g k', icon: '🧠' },
      'api-docs': { label: 'API Documentation', hint: '', icon: '📘' }
    };
    $$('.nav-item[data-page]').forEach((btn) => {
      const page = btn.dataset.page;
      const meta = pageLabels[page] || { label: page, hint: '', icon: '›' };
      items.push({
        group: 'Навигация',
        icon: meta.icon,
        label: `Перейти: ${meta.label}`,
        hint: meta.hint,
        keywords: `${page} ${meta.label} go open перейти`,
        action: () => goTo(page)
      });
    });

    // Actions
    items.push({
      group: 'Действия',
      icon: '🔄',
      label: 'Переанализировать входящие',
      hint: '',
      keywords: 'reanalyze переанализ обновить анализ',
      action: () => { goTo('inbox'); setTimeout(() => $('#reanalyze-btn')?.click(), 120); }
    });
    items.push({
      group: 'Действия',
      icon: '🤖',
      label: 'Переанализировать через LLM',
      hint: '',
      keywords: 'llm ai reanalyze переанализ',
      action: () => { goTo('inbox'); setTimeout(() => $('#reanalyze-llm-btn')?.click(), 120); }
    });
    items.push({
      group: 'Действия',
      icon: '⬇️',
      label: 'Экспорт XLSX из входящих',
      hint: '',
      keywords: 'xlsx excel export экспорт скачать',
      action: () => { goTo('inbox'); setTimeout(() => $('#inbox-export-xlsx-btn')?.click() || $('[data-action="export-xlsx"]')?.click(), 120); }
    });
    items.push({
      group: 'Действия',
      icon: '🔍',
      label: 'Сфокусироваться на поиске',
      hint: '/',
      keywords: 'search поиск искать фокус',
      action: () => focusSearch()
    });
    items.push({
      group: 'Действия',
      icon: '🚪',
      label: 'Выйти из системы',
      hint: '',
      keywords: 'logout sign out выйти logout',
      action: () => {
        try { localStorage.removeItem('pochta_token'); } catch {}
        location.href = '/';
      }
    });

    // Filters (inbox classification quick filters)
    [
      { label: 'Клиент', status: 'ready_for_crm' },
      { label: 'Требует внимания', status: 'review' },
      { label: 'Спам', status: 'ignored_spam' }
    ].forEach((f) => {
      items.push({
        group: 'Фильтры входящих',
        icon: '🎯',
        label: `Фильтр: ${f.label}`,
        hint: '',
        keywords: `filter filter фильтр ${f.label} ${f.status}`,
        action: () => {
          goTo('inbox');
          setTimeout(() => {
            const sel = $('#inbox-status-filter') || $('[data-filter="pipelineStatus"]');
            if (sel) { sel.value = f.status; sel.dispatchEvent(new Event('change')); }
            else { toast('Фильтр применён вручную через интерфейс входящих', { type: 'info' }); }
          }, 150);
        }
      });
    });

    return items;
  }

  function score(str, query) {
    const s = String(str || '').toLowerCase();
    const q = query.toLowerCase().trim();
    if (!q) return 1;
    if (s.startsWith(q)) return 4;
    if (s.includes(' ' + q)) return 3;
    if (s.includes(q)) return 2;
    // fuzzy: all chars in order
    let si = 0;
    for (let qi = 0; qi < q.length; qi++) {
      si = s.indexOf(q[qi], si);
      if (si === -1) return 0;
      si++;
    }
    return 1;
  }

  function renderCmdPalette(query = '') {
    const list = cmdPaletteEl.querySelector('.cmd-palette-list');
    const all = buildCmdRegistry();
    const ranked = all
      .map((it) => ({ it, sc: Math.max(score(it.label, query), score(it.keywords, query) * 0.9) }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc);
    cmdPaletteItems = ranked.map((x) => x.it);
    cmdPaletteIdx = 0;

    if (!cmdPaletteItems.length) {
      list.innerHTML = `<div class="cmd-palette-empty">Ничего не найдено</div>`;
      return;
    }

    let html = '';
    let prevGroup = null;
    cmdPaletteItems.forEach((it, i) => {
      if (it.group !== prevGroup) {
        html += `<div class="cmd-palette-group">${esc(it.group)}</div>`;
        prevGroup = it.group;
      }
      html += `
        <div class="cmd-palette-item" role="option" data-idx="${i}">
          <span class="cmd-palette-icon">${it.icon || '›'}</span>
          <span class="cmd-palette-label">${esc(it.label)}</span>
          ${it.hint ? `<kbd class="cmd-palette-hint">${esc(it.hint)}</kbd>` : ''}
        </div>
      `;
    });
    list.innerHTML = html;
    updateCmdHighlight();

    list.querySelectorAll('.cmd-palette-item').forEach((el) => {
      el.addEventListener('click', () => { cmdPaletteIdx = Number(el.dataset.idx); runCmdSelected(); });
      el.addEventListener('mouseenter', () => { cmdPaletteIdx = Number(el.dataset.idx); updateCmdHighlight(); });
    });
  }

  function updateCmdHighlight() {
    const items = cmdPaletteEl?.querySelectorAll('.cmd-palette-item') || [];
    items.forEach((el, i) => el.classList.toggle('active', i === cmdPaletteIdx));
    const active = items[cmdPaletteIdx];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function runCmdSelected() {
    const it = cmdPaletteItems[cmdPaletteIdx];
    if (!it) return;
    closeCmdPalette();
    try { it.action(); } catch (e) { console.error(e); toast('Ошибка выполнения команды', { type: 'error' }); }
  }

  function openCmdPalette() {
    const el = ensureCmdPalette();
    el.classList.add('show');
    const input = el.querySelector('.cmd-palette-input');
    input.value = '';
    renderCmdPalette('');
    setTimeout(() => input.focus(), 30);
  }

  function closeCmdPalette() {
    if (cmdPaletteEl) cmdPaletteEl.classList.remove('show');
  }

  window.openCommandPalette = openCmdPalette;

  // ─────────────────────────────────────────────────────────────
  //  5. VIEW TRANSITIONS (on .nav-item click)
  //     Wrap existing click flow via startViewTransition when available.
  // ─────────────────────────────────────────────────────────────
  let vtSkipOnce = false;
  if (document.startViewTransition) {
    document.addEventListener('click', (e) => {
      if (vtSkipOnce) { vtSkipOnce = false; return; }
      const nav = e.target.closest?.('.nav-item[data-page]');
      if (!nav) return;
      const page = nav.dataset.page;
      const current = $('.page.active')?.id?.replace('page-', '');
      if (page === current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      document.startViewTransition(() => {
        vtSkipOnce = true;
        nav.click();
      });
    }, true); // capture, runs before app.js click handler
  }

  // ─────────────────────────────────────────────────────────────
  //  6. DRAG-AND-DROP RECLASSIFY (inbox messages → Клиент/Спам/Поставщик)
  // ─────────────────────────────────────────────────────────────
  const DND_STATUS = {
    client: { label: 'Клиент', status: 'ready_for_crm', color: '#10b981', icon: '✓' },
    spam: { label: 'Спам', status: 'ignored_spam', color: '#ef4444', icon: '✕' },
    vendor: { label: 'Поставщик', status: 'review', color: '#f59e0b', icon: '⚠' }
  };

  let dndPanel;
  function ensureDndPanel() {
    if (dndPanel) return dndPanel;
    const el = document.createElement('div');
    el.id = 'dnd-reclassify-panel';
    el.innerHTML = Object.entries(DND_STATUS).map(([key, v]) => `
      <div class="dnd-dropzone" data-reclass="${key}">
        <span class="dnd-icon" style="background:${v.color}">${v.icon}</span>
        <span class="dnd-label">${v.label}</span>
      </div>
    `).join('');
    document.body.appendChild(el);

    el.querySelectorAll('.dnd-dropzone').forEach((zone) => {
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', async (e) => {
        e.preventDefault();
        zone.classList.remove('over');
        const payload = e.dataTransfer.getData('application/x-pochta-msg');
        if (!payload) return;
        const data = JSON.parse(payload);
        const cfg = DND_STATUS[zone.dataset.reclass];
        await reclassifyMessage(data, cfg);
      });
    });
    return el;
  }

  async function reclassifyMessage(data, cfg) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(data.pid)}/messages/${encodeURIComponent(data.key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineStatus: cfg.status })
      });
      if (!res.ok) throw new Error(await res.text());
      // optimistic UI update
      const row = $(`.message-item[data-mid="${data.key}"]`);
      if (row) { row.dataset.pipelineStatus = cfg.status; row.classList.add('dnd-reclassified'); }
      toast(`Перенесено в «${cfg.label}»`, { type: 'success' });
    } catch (err) {
      toast(`Не удалось перенести: ${err.message || err}`, { type: 'error' });
    }
  }

  // Enable HTML5 drag on inbox message rows (delegated observer)
  const dragMo = new MutationObserver(enableMessageDrag);
  dragMo.observe(document.body, { subtree: true, childList: true });
  enableMessageDrag();

  function enableMessageDrag() {
    $$('.message-item').forEach((row) => {
      if (row.dataset.dndReady) return;
      row.dataset.dndReady = '1';
      row.setAttribute('draggable', 'true');
      row.addEventListener('dragstart', (e) => {
        const key = row.dataset.mid || row.dataset.msgKey || row.dataset.key;
        const pid = row.dataset.pid || row.dataset.projectId;
        if (!key || !pid) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-pochta-msg', JSON.stringify({ key, pid }));
        ensureDndPanel().classList.add('show');
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        if (dndPanel) dndPanel.classList.remove('show');
      });
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  7. HOVER-CARD preview (inbox message rows)
  // ─────────────────────────────────────────────────────────────
  let hoverCardEl; let hoverCardTimer; let hoverCardTarget;

  function ensureHoverCard() {
    if (hoverCardEl) return hoverCardEl;
    const el = document.createElement('div');
    el.id = 'ui-hover-card';
    document.body.appendChild(el);
    hoverCardEl = el;
    return el;
  }

  function positionHoverCard(target) {
    const card = hoverCardEl;
    const r = target.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const gap = 12;
    let top = r.top;
    let left = r.right + gap;
    if (left + cr.width > window.innerWidth - 12) left = r.left - cr.width - gap;
    if (left < 12) left = 12;
    if (top + cr.height > window.innerHeight - 12) top = window.innerHeight - cr.height - 12;
    if (top < 12) top = 12;
    card.style.top = top + 'px';
    card.style.left = left + 'px';
  }

  function showHoverCard(row) {
    const subject = row.dataset.subject || row.querySelector('.message-subject, .msg-subject, .subject')?.textContent || '';
    const from = row.dataset.from || row.querySelector('.message-from, .msg-from, .from')?.textContent || '';
    const snippet = row.dataset.snippet || row.querySelector('.message-snippet, .msg-snippet, .snippet, .message-preview')?.textContent || '';
    const status = row.dataset.pipelineStatus || '';
    const brands = row.dataset.brands || '';
    const articles = row.dataset.articles || '';

    if (!subject && !from && !snippet) return; // nothing useful to show

    const card = ensureHoverCard();
    card.innerHTML = `
      ${from ? `<div class="hc-from">${esc(from.trim())}</div>` : ''}
      ${subject ? `<div class="hc-subject">${esc(subject.trim())}</div>` : ''}
      ${snippet ? `<div class="hc-snippet">${esc(snippet.trim().slice(0, 280))}</div>` : ''}
      ${(brands || articles || status) ? `<div class="hc-meta">
        ${status ? `<span class="hc-badge hc-status-${esc(status)}">${esc(status)}</span>` : ''}
        ${brands ? `<span class="hc-pill">бренды: ${esc(brands.slice(0, 80))}</span>` : ''}
        ${articles ? `<span class="hc-pill">артикулы: ${esc(articles.slice(0, 80))}</span>` : ''}
      </div>` : ''}
    `;
    card.classList.add('show');
    positionHoverCard(row);
  }

  function hideHoverCard() {
    if (hoverCardEl) hoverCardEl.classList.remove('show');
    hoverCardTarget = null;
  }

  document.addEventListener('mouseover', (e) => {
    const row = e.target.closest?.('.message-item');
    if (!row || row === hoverCardTarget) return;
    if (row.classList.contains('dragging')) return;
    hoverCardTarget = row;
    clearTimeout(hoverCardTimer);
    hoverCardTimer = setTimeout(() => { if (hoverCardTarget === row) showHoverCard(row); }, 600);
  });
  document.addEventListener('mouseout', (e) => {
    if (!e.target.closest?.('.message-item')) return;
    clearTimeout(hoverCardTimer);
    hideHoverCard();
  });
  document.addEventListener('scroll', hideHoverCard, true);

  // ─────────────────────────────────────────────────────────────
  //  8. Seed data-tooltip onto common top-bar buttons (progressive enhancement)
  // ─────────────────────────────────────────────────────────────
  function seedTooltips() {
    const seeds = [
      ['#reanalyze-btn', 'Переанализировать входящие письма'],
      ['#reanalyze-llm-btn', 'Повторный анализ через LLM (AI)'],
      ['#sidebar-toggle', 'Свернуть / развернуть сайдбар'],
      ['#logout-btn', 'Выйти из системы'],
      ['#inbox-export-xlsx-btn', 'Экспорт всех писем в XLSX']
    ];
    seeds.forEach(([sel, text]) => {
      const el = $(sel);
      if (el && !el.dataset.tooltip) el.dataset.tooltip = text;
    });
  }
  const tipMo = new MutationObserver(seedTooltips);
  tipMo.observe(document.body, { subtree: true, childList: true });
  seedTooltips();

  // Boot log (visible once in console)
  console.log('[ui-enhancements] loaded · ⌘K command palette · / search · g i/d/k/p/a nav · drag-drop reclassify · hover preview');
})();
