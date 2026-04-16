# UX Redesign — Sidebar, Accordion, Filters, Responsive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Улучшить UX дашборда и Входящих для показа инвесторам: сворачиваемый сайдбар, аккордеон в правой панели, двойная строка фильтров, полный адаптив.

**Architecture:** Все изменения — чистый frontend (CSS + HTML + JS). Бизнес-логика не затрагивается. Каждый таск изолирован и коммитируется отдельно. После всех задач — синхронизация с `.railway-deploy/`.

**Tech Stack:** Vanilla JS (ESM), CSS custom properties, localStorage, Node.js dev server (`npm run dev`)

---

## File Map

| Файл | Что меняем |
|---|---|
| `public/styles.css` | Sidebar collapse, accordion CSS, 2-row toolbar, responsive breakpoints, mobile overlay |
| `public/index.html` | Toggle button в sidebar-brand, мобильный hamburger в header, структура detail-panel → аккордеон |
| `public/app.js` | `renderEmailView()` → аккордеон; sidebar toggle JS; мобильный overlay |
| `.railway-deploy/public/styles.css` | Синхронизация |
| `.railway-deploy/public/index.html` | Синхронизация |
| `.railway-deploy/public/app.js` | Синхронизация |

---

## Task 1: Сворачиваемый сайдбар — CSS

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Открыть `public/styles.css`, найти секцию `/* ═══════ SIDEBAR ═══════ */` (строка ~49)**

- [ ] **Step 2: Заменить блок `.app` и `.sidebar` на версию с CSS-переменной и collapsed-состоянием**

Найти:
```css
.app {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
}

/* ═══════ SIDEBAR ═══════ */
.sidebar {
  background: var(--surface-0);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 0;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}
```

Заменить на:
```css
:root {
  --sidebar-width: 240px;
}

.app {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  min-height: 100vh;
  transition: grid-template-columns 0.2s ease;
}

/* ═══════ SIDEBAR ═══════ */
.sidebar {
  background: var(--surface-0);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 0;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
  width: var(--sidebar-width);
  transition: width 0.2s ease;
}

.sidebar.collapsed {
  width: 48px;
}
```

- [ ] **Step 3: Добавить скрытие текстовых элементов в collapsed-состоянии**

После блока `.sidebar.collapsed { width: 48px; }` добавить:
```css
.sidebar.collapsed .nav-text,
.sidebar.collapsed .nav-badge,
.sidebar.collapsed .nav-section-label,
.sidebar.collapsed .version,
.sidebar.collapsed .logo-text,
.sidebar.collapsed .sidebar-stats,
.sidebar.collapsed .sidebar-footer span:not(.status-dot) {
  display: none;
}

.sidebar.collapsed .sidebar-brand {
  padding: 16px 8px;
  justify-content: center;
}

.sidebar.collapsed .sidebar-nav {
  padding: 8px 4px;
}

.sidebar.collapsed .nav-item {
  padding: 10px;
  justify-content: center;
  gap: 0;
}

.sidebar.collapsed .nav-icon {
  opacity: 1;
}

.sidebar.collapsed .sidebar-footer {
  padding: 12px 8px;
  justify-content: center;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-toggle {
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 3px 7px;
  font-size: 12px;
  line-height: 1;
  flex-shrink: 0;
  transition: all var(--transition);
}

.sidebar-toggle:hover {
  background: var(--surface-2);
  color: var(--text);
}

.sidebar.collapsed .sidebar-toggle {
  margin: 0 auto;
}
```

- [ ] **Step 4: Обновить `.progress-bar` чтобы следовал за шириной сайдбара**

Найти:
```css
.progress-bar {
  position: fixed;
  top: 0;
  left: 240px;
  right: 0;
```

Заменить на:
```css
.progress-bar {
  position: fixed;
  top: 0;
  left: var(--sidebar-width);
  right: 0;
```

- [ ] **Step 5: Запустить dev-сервер и убедиться что CSS не ломает текущий вид**

```bash
npm run dev
```

Открыть http://localhost:3000. Сайдбар должен выглядеть как раньше.

- [ ] **Step 6: Commit**

```bash
git add public/styles.css
git commit -m "style: sidebar collapse CSS — collapsed class, CSS var, toggle button styles"
```

---

## Task 2: Сворачиваемый сайдбар — HTML + JS

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

- [ ] **Step 1: Добавить кнопку toggle в `index.html` внутри `.sidebar-brand`**

Найти в `public/index.html`:
```html
      <div class="sidebar-brand">
        <h1><span class="logo-icon">P</span> Pochta</h1>
        <div class="version">CRM Mail Module v2.0</div>
      </div>
```

Заменить на:
```html
      <div class="sidebar-brand">
        <div style="display:flex;align-items:center;gap:10px;overflow:hidden;">
          <h1><span class="logo-icon">P</span> <span class="logo-text">Pochta</span></h1>
        </div>
        <button class="sidebar-toggle" id="sidebar-toggle" title="Свернуть навигацию">‹</button>
        <div class="version">CRM Mail Module v2.0</div>
      </div>
```

- [ ] **Step 2: Добавить мобильный hamburger-кнопку в `main-header`**

Найти в `public/index.html`:
```html
      <header class="main-header">
        <h2 id="page-title">Дашборд</h2>
```

Заменить на:
```html
      <header class="main-header">
        <button class="sidebar-mobile-toggle" id="sidebar-mobile-toggle" title="Открыть меню" style="display:none;background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-muted);cursor:pointer;padding:5px 8px;font-size:14px;line-height:1;margin-right:4px;">☰</button>
        <h2 id="page-title">Дашборд</h2>
```

- [ ] **Step 3: Добавить overlay-backdrop для мобильного сайдбара в `index.html`**

Найти в `public/index.html` строку `<aside class="sidebar">` и добавить перед ней:
```html
    <div class="sidebar-backdrop" id="sidebar-backdrop" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:49;"></div>
```

- [ ] **Step 4: Добавить JS-логику toggle в `public/app.js`**

В конце файла, перед последней закрывающей строкой (или после блока `setupNavigation`), добавить:

```js
// ═══════════════════════════════════════════════════════
//  SIDEBAR TOGGLE
// ═══════════════════════════════════════════════════════

function initSidebarToggle() {
  const sidebar = document.querySelector('.sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');
  const mobileToggleBtn = document.getElementById('sidebar-mobile-toggle');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;

  const STORAGE_KEY = 'pochta_sidebar_collapsed';

  function setCollapsed(collapsed) {
    sidebar.classList.toggle('collapsed', collapsed);
    document.documentElement.style.setProperty('--sidebar-width', collapsed ? '48px' : '240px');
    if (toggleBtn) toggleBtn.textContent = collapsed ? '›' : '‹';
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch (_) {}
  }

  // Restore from localStorage
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === '1') setCollapsed(true);

  // Desktop toggle
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      setCollapsed(!sidebar.classList.contains('collapsed'));
    });
  }

  // Mobile toggle
  function openMobileSidebar() {
    sidebar.classList.add('mobile-open');
    if (backdrop) backdrop.style.display = 'block';
  }
  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    if (backdrop) backdrop.style.display = 'none';
  }
  if (mobileToggleBtn) {
    mobileToggleBtn.addEventListener('click', openMobileSidebar);
  }
  if (backdrop) {
    backdrop.addEventListener('click', closeMobileSidebar);
  }
}
```

- [ ] **Step 5: Вызвать `initSidebarToggle()` при инициализации приложения**

Найти в `public/app.js` функцию `setupNavigation()` или блок инициализации. Найти место где вызывается `setupNavigation()` и добавить после него:

```js
initSidebarToggle();
```

Поиск по файлу: `grep -n "setupNavigation()" public/app.js`

- [ ] **Step 6: Проверить вручную**

```bash
npm run dev
```

- Открыть http://localhost:3000
- Нажать кнопку `‹` — сайдбар должен сжаться до 48px, текст исчезнуть, кнопка стать `›`
- Нажать `›` — развернуться обратно
- Перезагрузить страницу — состояние должно сохраниться
- Progress bar должен начинаться у правого края сайдбара

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: collapsible sidebar with icon-only mode and localStorage persistence"
```

---

## Task 3: Responsive CSS — брейкпоинты

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Найти текущий responsive блок в конце `styles.css`**

Найти:
```css
/* ═══════ RESPONSIVE ═══════ */
@media (max-width: 1100px) {
  .app { grid-template-columns: 1fr; }
  .sidebar { display: none; }
  .grid-3col { grid-template-columns: 1fr; height: auto; }
  .grid-2col { grid-template-columns: 1fr; }
  .progress-bar { left: 0; }
}
```

- [ ] **Step 2: Заменить на полноценные брейкпоинты**

```css
/* ═══════ RESPONSIVE ═══════ */

/* 960–1279px: auto-collapse sidebar to icons */
@media (max-width: 1279px) and (min-width: 960px) {
  :root { --sidebar-width: 48px; }
  .sidebar { width: 48px; }
  .sidebar .nav-text,
  .sidebar .nav-badge,
  .sidebar .nav-section-label,
  .sidebar .version,
  .sidebar .logo-text,
  .sidebar .sidebar-stats,
  .sidebar .sidebar-footer span:not(.status-dot) { display: none; }
  .sidebar .nav-item { padding: 10px; justify-content: center; gap: 0; }
  .sidebar .sidebar-brand { padding: 16px 8px; justify-content: center; }
  .sidebar .sidebar-nav { padding: 8px 4px; }
  .sidebar .sidebar-footer { padding: 12px 8px; justify-content: center; }
  .sidebar-toggle { display: none; }
  .grid-3col { grid-template-columns: 260px 1fr 280px; }
}

/* 768–959px: icons sidebar + 2-column inbox */
@media (max-width: 959px) and (min-width: 768px) {
  :root { --sidebar-width: 48px; }
  .sidebar { width: 48px; }
  .sidebar .nav-text,
  .sidebar .nav-badge,
  .sidebar .nav-section-label,
  .sidebar .version,
  .sidebar .logo-text,
  .sidebar .sidebar-stats,
  .sidebar .sidebar-footer span:not(.status-dot) { display: none; }
  .sidebar .nav-item { padding: 10px; justify-content: center; gap: 0; }
  .sidebar .sidebar-brand { padding: 16px 8px; justify-content: center; }
  .sidebar .sidebar-nav { padding: 8px 4px; }
  .sidebar .sidebar-footer { padding: 12px 8px; justify-content: center; }
  .sidebar-toggle { display: none; }
  .grid-3col { grid-template-columns: 260px 1fr; }
  .detail-panel { display: none; }
  .detail-panel.mobile-visible { display: block; position: fixed; right: 0; top: 0; bottom: 0; width: 300px; z-index: 50; box-shadow: -4px 0 24px rgba(0,0,0,0.4); }
  .toolbar-filters { display: none; }
  .toolbar-filters-toggle { display: flex !important; }
  .toolbar-filters.mobile-visible { display: flex; }
}

/* <768px: mobile — full overlay sidebar, single column */
@media (max-width: 767px) {
  :root { --sidebar-width: 0px; }
  .app { grid-template-columns: 1fr; }
  .sidebar {
    display: none;
    position: fixed;
    left: 0; top: 0; bottom: 0;
    width: 240px !important;
    z-index: 50;
    box-shadow: 4px 0 24px rgba(0,0,0,0.5);
  }
  .sidebar.mobile-open { display: flex; }
  .sidebar-toggle { display: none; }
  .sidebar-mobile-toggle { display: flex !important; }
  .progress-bar { left: 0; }
  .main-content { padding: 12px 14px; }
  .main-header { padding: 10px 14px; }
  .grid-3col {
    grid-template-columns: 1fr;
    height: auto;
  }
  .grid-2col { grid-template-columns: 1fr; }
  .email-view { display: none; }
  .email-view.mobile-visible { display: block; position: fixed; inset: 0; z-index: 40; background: var(--bg); overflow-y: auto; padding: 16px; }
  .detail-panel { display: none; }
  .message-list { height: calc(100vh - 220px); }
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .grid-2 { grid-template-columns: 1fr; }
  .toolbar-filters { display: none; }
  .toolbar-filters-toggle { display: flex !important; }
  .toolbar-filters.mobile-visible { display: flex; flex-wrap: wrap; }
  .main-header .header-actions { gap: 4px; }
  .main-header .header-actions #reanalyze-btn,
  .main-header .header-actions #reanalyze-llm-btn { display: none; }
}
```

- [ ] **Step 3: Проверить на разных размерах окна**

```bash
npm run dev
```

- Открыть DevTools → Toggle device toolbar (Ctrl+Shift+M)
- Проверить: 1400px — полный сайдбар; 1100px — иконки; 800px — иконки + без правой панели; 400px — без сайдбара
- При этом основной контент должен заполнять пространство

- [ ] **Step 4: Commit**

```bash
git add public/styles.css
git commit -m "style: responsive breakpoints — auto-collapse sidebar, mobile overlay, adaptive inbox"
```

---

## Task 4: Двойная строка фильтров — HTML

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Найти текущую панель фильтров во Входящих**

В `public/index.html` найти строку:
```html
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
            <button class="btn btn-primary" id="inbox-fetch-btn">
```

Эта div-секция заканчивается на `<span id="inbox-status-text" ...>`. Заменить всю секцию на двухрядную структуру:

- [ ] **Step 2: Заменить одну строку на две**

```html
          <!-- Toolbar Row 1: Actions -->
          <div class="toolbar-actions" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
            <button class="btn btn-primary" id="inbox-fetch-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              Получить письма
            </button>
            <div class="bulk-actions" id="bulk-actions" style="display:none;">
              <span id="bulk-count" style="font-size:11px;color:var(--text-secondary);font-weight:600;"></span>
              <button class="btn btn-sm" style="background:var(--green-dim);color:var(--green);border:1px solid var(--green)" id="bulk-request-btn">Заявка</button>
              <button class="btn btn-sm" style="background:var(--blue-dim);color:var(--blue);border:1px solid var(--blue)" id="bulk-confirm-btn">Подтвердить</button>
              <button class="btn btn-sm" style="background:var(--rose-dim);color:var(--rose);border:1px solid var(--rose)" id="bulk-spam-btn">Спам</button>
              <button class="btn btn-sm" style="background:var(--purple-dim);color:var(--purple);border:1px solid var(--purple)" id="bulk-vendor-btn">Поставщик</button>
              <button class="btn btn-danger btn-sm" id="bulk-delete-btn">Удалить</button>
              <button class="btn btn-ghost btn-sm" id="bulk-clear-btn">Снять</button>
            </div>
            <button class="btn btn-danger btn-sm" id="inbox-delete-all-btn">Удалить все</button>
            <button class="btn btn-ghost btn-sm" id="inbox-export-csv-btn">CSV</button>
            <button class="btn btn-ghost btn-sm" id="inbox-export-xlsx-btn">XLSX</button>
            <div style="flex:1;min-width:140px;">
              <input class="form-input" id="inbox-search" placeholder="Поиск по теме, email..." style="width:100%;font-size:11px;padding:6px 10px;" />
            </div>
            <span id="inbox-status-text" style="font-size:12px;color:var(--text-muted);"></span>
          </div>
          <!-- Toolbar Row 2: Filters -->
          <div class="toolbar-filters" style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
            <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">Фильтры:</span>
            <select class="form-select" id="inbox-mailbox-filter" style="font-size:11px;padding:5px 8px;width:130px;">
              <option value="">Все ящики</option>
            </select>
            <select class="form-select" id="inbox-attachment-filter" style="font-size:11px;padding:5px 8px;width:120px;">
              <option value="">Вложения: все</option>
              <option value="has">С вложениями</option>
              <option value="none">Без вложений</option>
              <option value="pdf">PDF</option>
              <option value="xls">Excel</option>
              <option value="doc">Word</option>
              <option value="img">Изображения</option>
            </select>
            <select class="form-select" id="inbox-recognition-filter" style="font-size:11px;padding:5px 8px;width:160px;">
              <option value="">Распознание: все</option>
              <option value="missing_article">Нет артикула</option>
              <option value="missing_brand">Нет бренда</option>
              <option value="missing_name">Нет наименования</option>
              <option value="missing_phone">Нет телефона</option>
              <option value="missing_company">Нет компании</option>
              <option value="missing_inn">Нет ИНН</option>
              <option value="attachments_unparsed">Вложения не разобраны</option>
              <option value="weak_detection">Слабый детект</option>
              <option value="has_conflicts">Есть конфликты</option>
              <option value="unconfirmed">Не подтверждены</option>
              <option value="high_priority">Высокий приоритет</option>
              <option value="sla_overdue">Просрочены по SLA</option>
              <option value="all_key_fields">Ключевые поля найдены</option>
              <option value="fully_parsed">Максимально разобранные</option>
            </select>
            <select class="form-select" id="inbox-llm-filter" style="font-size:11px;padding:5px 8px;width:120px;">
              <option value="">LLM: все</option>
              <option value="llm_done">Прошли LLM</option>
              <option value="llm_pending">Не прошли LLM</option>
            </select>
            <div style="margin-left:auto;display:flex;gap:6px;align-items:center;">
              <select class="form-select" id="inbox-sort" style="font-size:11px;padding:5px 8px;width:120px;">
                <option value="date-desc">Новые</option>
                <option value="date-asc">Старые</option>
                <option value="confidence-asc">Низкий conf.</option>
                <option value="confidence-desc">Высокий conf.</option>
                <option value="mailbox">По ящику</option>
              </select>
              <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);cursor:pointer;" title="Группировать по цепочкам">
                <input type="checkbox" id="inbox-group-threads" style="margin:0;">
                Треды
              </label>
              <select class="form-select" id="inbox-auto-refresh" style="font-size:11px;padding:5px 8px;width:95px;" title="Авто-обновление">
                <option value="0">Авто: выкл</option>
                <option value="30">30 сек</option>
                <option value="60">1 мин</option>
                <option value="300">5 мин</option>
              </select>
            </div>
          </div>
          <!-- Keyboard hints row -->
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <div id="inbox-pagination" style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);"></div>
            <div style="margin-left:auto;display:flex;gap:10px;font-size:10px;color:var(--text-muted);">
              <span><kbd style="background:var(--surface-3);border:1px solid var(--border);border-radius:3px;padding:1px 4px;font-family:'JetBrains Mono',monospace;font-size:9px;">j</kbd>/<kbd style="background:var(--surface-3);border:1px solid var(--border);border-radius:3px;padding:1px 4px;font-family:'JetBrains Mono',monospace;font-size:9px;">k</kbd> навигация</span>
              <span><kbd style="background:var(--surface-3);border:1px solid var(--border);border-radius:3px;padding:1px 4px;font-family:'JetBrains Mono',monospace;font-size:9px;">r</kbd> обновить</span>
              <span><kbd style="background:var(--surface-3);border:1px solid var(--border);border-radius:3px;padding:1px 4px;font-family:'JetBrains Mono',monospace;font-size:9px;">Del</kbd> удалить</span>
            </div>
          </div>
```

- [ ] **Step 3: Убедиться что все ID filter-элементов сохранены**

Проверить что в новом HTML присутствуют все эти ID (они используются в app.js):
- `inbox-fetch-btn`, `bulk-actions`, `bulk-count`, `bulk-request-btn`, `bulk-confirm-btn`
- `bulk-spam-btn`, `bulk-vendor-btn`, `bulk-delete-btn`, `bulk-clear-btn`
- `inbox-delete-all-btn`, `inbox-export-csv-btn`, `inbox-export-xlsx-btn`
- `inbox-search`, `inbox-status-text`, `inbox-mailbox-filter`, `inbox-attachment-filter`
- `inbox-recognition-filter`, `inbox-llm-filter`, `inbox-sort`, `inbox-group-threads`
- `inbox-auto-refresh`, `inbox-pagination`

- [ ] **Step 4: Проверить вручную**

```bash
npm run dev
```

Открыть Входящие — должно быть две строки: кнопки + поиск (строка 1), фильтры (строка 2).
Все фильтры должны работать как раньше.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "style: inbox toolbar split into 2 rows — actions/search + filters"
```

---

## Task 5: Правая панель — аккордеон-стили CSS

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Добавить CSS для аккордеона в конец файла `public/styles.css`**

```css
/* ═══════ ACCORDION DETAIL PANEL ═══════ */
.acc-status-block {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}

.acc-status-block.status-ready { background: rgba(52,211,153,0.08); border-bottom-color: rgba(52,211,153,0.15); }
.acc-status-block.status-review { background: var(--amber-dim); border-bottom-color: rgba(251,191,36,0.15); }
.acc-status-block.status-spam { background: var(--rose-dim); border-bottom-color: rgba(248,113,113,0.15); }
.acc-status-block.status-unknown { background: var(--surface-2); }

.acc-status-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.acc-status-label {
  font-weight: 700;
  font-size: 13px;
}

.acc-status-label.green { color: var(--green); }
.acc-status-label.amber { color: var(--amber); }
.acc-status-label.rose { color: var(--rose); }

.acc-status-conf {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 1px;
}

.acc-status-badge {
  margin-left: auto;
  padding: 2px 9px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
}

.acc-section {
  border-bottom: 1px solid var(--border);
}

.acc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px;
  cursor: pointer;
  transition: background var(--transition);
  user-select: none;
}

.acc-header:hover { background: var(--surface-2); }

.acc-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.acc-title.open { color: var(--text); }

.acc-arrow {
  font-size: 10px;
  color: var(--text-muted);
  transition: transform 0.15s;
}

.acc-arrow.open { transform: rotate(0deg); }
.acc-arrow.closed { transform: rotate(-90deg); }

.acc-body {
  padding: 6px 14px 12px;
}

.acc-field {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 4px 0;
  gap: 10px;
  border-radius: 4px;
  transition: background 0.1s;
}

.acc-field:hover { background: var(--surface-2); padding-left: 4px; padding-right: 4px; }

.acc-field-key {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
  padding-top: 1px;
}

.acc-field-val {
  font-size: 11px;
  font-weight: 500;
  text-align: right;
  word-break: break-word;
}

.acc-field-val.green { color: var(--green); }
.acc-field-val.amber { color: var(--amber); }
.acc-field-val.blue { color: var(--accent); }
.acc-field-val.purple { color: var(--purple); }

.acc-crm-info {
  margin-top: 6px;
  padding: 6px 8px;
  background: var(--accent-dim);
  border-radius: 6px;
  font-size: 10px;
  color: var(--accent);
}

.acc-article-chip {
  display: inline-block;
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 10px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text);
  margin: 2px 2px 0 0;
}

.acc-actions {
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.acc-actions .btn-full {
  width: 100%;
  padding: 8px;
  font-size: 12px;
  font-weight: 700;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  transition: all var(--transition);
}

.acc-actions .btn-row {
  display: flex;
  gap: 6px;
}

.acc-actions .btn-row .btn-full { flex: 1; }
```

- [ ] **Step 2: Commit**

```bash
git add public/styles.css
git commit -m "style: accordion styles for detail panel"
```

---

## Task 6: Правая панель — аккордеон JS

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Найти функцию `renderEmailView` в `app.js` (строка ~2699)**

Найти блок начинающийся с:
```js
  try {
  detailEl.innerHTML = `
    <div class="detail-section">
```

Этот блок заканчивается на `} catch(e) {` или закрывающей скобке `try`.

- [ ] **Step 2: Добавить вспомогательную функцию `buildAccordionDetailPanel` перед `renderEmailView`**

Вставить перед строкой `function renderEmailView(msg, viewEl, detailEl) {`:

```js
function buildAccordionDetailPanel(msg, a) {
  const sender = a.sender || {};
  const lead = a.lead || {};
  const crm = a.crm || {};
  const cls = a.classification || {};
  const msgKey = mid(msg);
  const rd = lead.recognitionDecision || {};

  // Status block
  const pipelineStatus = msg.pipelineStatus || '';
  const statusMap = {
    ready_for_crm:      { icon: '✓', label: 'Готово к CRM',  cls: 'status-ready',   textCls: 'green', badge: 'Заявка',    badgeStyle: 'background:var(--green);color:#0f1117;' },
    ignored_spam:       { icon: '✕', label: 'Спам',           cls: 'status-spam',    textCls: 'rose',  badge: 'Спам',      badgeStyle: 'background:var(--rose-dim);color:var(--rose);' },
    needs_clarification:{ icon: '?', label: 'Уточнение',     cls: 'status-review',  textCls: 'amber', badge: 'Уточнение', badgeStyle: 'background:var(--amber-dim);color:var(--amber);' },
    review:             { icon: '⚠', label: 'На модерацию',  cls: 'status-review',  textCls: 'amber', badge: 'Обзор',     badgeStyle: 'background:var(--amber-dim);color:var(--amber);' },
  };
  const sm = statusMap[pipelineStatus] || { icon: '·', label: pipelineStatus || 'Анализ', cls: 'status-unknown', textCls: '', badge: '', badgeStyle: '' };
  const conf = cls.confidence != null ? Math.round(cls.confidence * 100) + '%' : '';
  const category = cls.label || '';

  const statusBlock = `
    <div class="acc-status-block ${esc(sm.cls)}">
      <div class="acc-status-icon">${sm.icon}</div>
      <div>
        <div class="acc-status-label ${esc(sm.textCls)}">${esc(sm.label)}</div>
        <div class="acc-status-conf">${conf ? `Уверенность: ${conf}` : ''}${category ? ` · ${esc(category)}` : ''}</div>
      </div>
      ${sm.badge ? `<span class="acc-status-badge" style="${sm.badgeStyle}">${esc(sm.badge)}</span>` : ''}
    </div>`;

  // Client section fields
  const clientFields = [
    ['Имя', sender.fullName],
    ['Должность', sender.position],
    ['Email', sender.email],
    ['Компания', sender.companyName],
    ['ИНН', sender.inn, 'green'],
    ['Телефон', sender.mobilePhone || sender.cityPhone],
    ['Сайт', sender.website],
  ].filter(([,v]) => v);

  const crmInfo = (crm.isExistingCompany || crm.curatorMop)
    ? `<div class="acc-crm-info">✓ ${crm.isExistingCompany ? 'Известный клиент' : ''}${crm.curatorMop ? ` · МОП: ${esc(crm.curatorMop)}` : ''}${crm.curatorMoz ? ` · МОЗ: ${esc(crm.curatorMoz)}` : ''}</div>`
    : '';

  // Request section fields
  const brands = a.detectedBrands || lead.detectedBrands || [];
  const articles = lead.articles || [];
  const lineItems = lead.lineItems || [];
  const totalQty = lineItems.reduce((s, li) => s + (li.quantity || 0), 0);

  const requestFields = [
    ['Бренд', brands.length ? brands.join(', ') : null, 'purple'],
    ['Тип', lead.requestType],
    ['Позиций', lead.totalPositions || (articles.length || null)],
    ['Кол-во', totalQty > 0 ? totalQty + ' шт' : null],
  ].filter(([,v]) => v);

  const articleChips = articles.length
    ? `<div style="margin-top:8px;"><div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em;">Артикулы</div>${
        articles.slice(0, 8).map((art) => {
          const li = lineItems.find((l) => l.article === art);
          return `<span class="acc-article-chip">${esc(art)}${li?.quantity ? ` ×${li.quantity}` : ''}</span>`;
        }).join('')
      }${articles.length > 8 ? `<span class="acc-article-chip" style="color:var(--text-muted);">+${articles.length - 8} ещё</span>` : ''}</div>`
    : '';

  // Diagnostics section (hidden by default)
  const diagFields = [
    ['Приоритет', rd.priority],
    ['Причина', rd.failureReason],
    ['Уверенность', cls.confidence != null ? Math.round(cls.confidence * 100) + '%' : null],
    ['Completeness', (lead.recognitionSummary?.completenessScore != null) ? lead.recognitionSummary.completenessScore + '%' : null],
    ['Конфликты', lead.recognitionSummary?.hasConflicts ? 'Есть' : 'Нет'],
  ].filter(([,v]) => v);

  function accField(key, val, valCls = '') {
    return `<div class="acc-field"><span class="acc-field-key">${esc(key)}</span><span class="acc-field-val ${esc(valCls)}">${esc(String(val))}</span></div>`;
  }

  function accSection(id, icon, title, fieldsHtml, extra = '', defaultOpen = true) {
    const isOpen = defaultOpen;
    return `
      <div class="acc-section" data-acc-id="${esc(id)}">
        <div class="acc-header" onclick="window.__accToggle(this)">
          <span class="acc-title ${isOpen ? 'open' : ''}">${icon} ${esc(title)}</span>
          <span class="acc-arrow ${isOpen ? 'open' : 'closed'}">${isOpen ? '▾' : '▸'}</span>
        </div>
        <div class="acc-body" style="${isOpen ? '' : 'display:none;'}">
          ${fieldsHtml}
          ${extra}
        </div>
      </div>`;
  }

  // Actions
  const actions = `
    <div class="acc-actions">
      <button class="btn-full" style="background:var(--green);color:#0f1117;" onclick="window.__setStatus('${escAttr(msgKey)}','ready_for_crm')">✓ Передать в CRM</button>
      <div class="btn-row">
        <button class="btn-full" style="background:var(--rose-dim);color:var(--rose);border:1px solid rgba(248,113,113,0.3);" onclick="window.__setStatus('${escAttr(msgKey)}','ignored_spam')">Спам</button>
        <button class="btn-full" style="background:var(--amber-dim);color:var(--amber);border:1px solid rgba(251,191,36,0.3);" onclick="window.__setStatus('${escAttr(msgKey)}','needs_clarification')">Уточнить</button>
      </div>
      <button class="btn-full" style="background:var(--surface-2);color:var(--text-secondary);border:1px solid var(--border);font-size:11px;" onclick="window.__showTrainPanel('${escAttr(msgKey)}')">⚙ Обучить классификатор</button>
    </div>`;

  return statusBlock
    + accSection('client', '👤', 'Клиент',
        clientFields.map(([k,v,c]) => accField(k, v, c||'')).join(''),
        crmInfo, true)
    + accSection('request', '📦', 'Заявка',
        requestFields.map(([k,v,c]) => accField(k, v, c||'')).join(''),
        articleChips, true)
    + accSection('diag', '⚙', 'Диагностика',
        diagFields.map(([k,v,c]) => accField(k, v, c||'')).join(''),
        '', false)
    + actions;
}
```

- [ ] **Step 3: Заменить блок `detailEl.innerHTML = ...` в `renderEmailView`**

Найти:
```js
  try {
  detailEl.innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title">Решение системы</div>
```

Заменить весь блок `try { detailEl.innerHTML = ...` (до соответствующего `} catch`) на:

```js
  try {
    detailEl.innerHTML = buildAccordionDetailPanel(msg, a);
  } catch (e) {
    detailEl.innerHTML = `<div class="detail-section"><div class="detail-section-title" style="color:var(--rose);">Ошибка рендера</div><pre style="font-size:10px;color:var(--text-muted);white-space:pre-wrap;">${esc(String(e))}</pre></div>`;
  }
```

- [ ] **Step 4: Добавить глобальный обработчик аккордеона**

В конце `public/app.js` добавить:

```js
// Accordion toggle handler
window.__accToggle = function(headerEl) {
  const section = headerEl.closest('.acc-section');
  const body = section.querySelector('.acc-body');
  const arrow = headerEl.querySelector('.acc-arrow');
  const title = headerEl.querySelector('.acc-title');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  arrow.className = 'acc-arrow ' + (isOpen ? 'closed' : 'open');
  arrow.textContent = isOpen ? '▸' : '▾';
  title.classList.toggle('open', !isOpen);
};
```

- [ ] **Step 5: Добавить заглушку для `__showTrainPanel` если её ещё нет**

Проверить:
```bash
grep -n "__showTrainPanel\|__trainSender\|__setStatus" public/app.js | head -10
```

Если `__setStatus` не существует (а существует другой механизм смены статуса), нужно найти текущую кнопку смены статуса в app.js. Найти строку:

```bash
grep -n "pipelineStatus\|setStatus\|ready_for_crm" public/app.js | head -20
```

Подключить существующий механизм. Если уже есть `window.__setMsgStatus` или похожий — использовать его имя. Кнопки в `buildAccordionDetailPanel` вызывают `window.__setStatus` — нужно убедиться что такая функция существует или переименовать под существующую.

- [ ] **Step 6: Проверить вручную**

```bash
npm run dev
```

- Открыть Входящие → выбрать письмо
- Правая панель должна показывать: статус-блок → Клиент (открыт) → Заявка (открыт) → Диагностика (закрыта)
- Нажать на заголовок «Диагностика» — открывается
- Нажать ещё раз — закрывается
- Кнопки «В CRM», «Спам», «Уточнить» должны быть видны и работать

- [ ] **Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat: accordion detail panel — status block, client/request/diagnostics sections"
```

---

## Task 7: Синхронизация с .railway-deploy

**Files:**
- Modify: `.railway-deploy/public/styles.css`
- Modify: `.railway-deploy/public/index.html`
- Modify: `.railway-deploy/public/app.js`

- [ ] **Step 1: Скопировать все три файла**

```bash
cp public/styles.css .railway-deploy/public/styles.css
cp public/index.html .railway-deploy/public/index.html
cp public/app.js .railway-deploy/public/app.js
```

- [ ] **Step 2: Убедиться что файлы идентичны**

```bash
diff public/styles.css .railway-deploy/public/styles.css && echo "OK styles"
diff public/index.html .railway-deploy/public/index.html && echo "OK html"
diff public/app.js .railway-deploy/public/app.js && echo "OK app.js"
```

Все три команды должны вывести `OK ...` без разницы.

- [ ] **Step 3: Commit**

```bash
git add .railway-deploy/public/styles.css .railway-deploy/public/index.html .railway-deploy/public/app.js
git commit -m "chore: sync public/ → .railway-deploy/public/ after UX redesign"
```

---

## Self-Review

### Spec coverage
- ✅ Decision 1 (сворачиваемый сайдбар): Task 1 (CSS) + Task 2 (HTML+JS)
- ✅ Responsive breakpoints: Task 3
- ✅ Decision 3 (2-row filters): Task 4
- ✅ Decision 2 (accordion detail): Task 5 (CSS) + Task 6 (JS)
- ✅ Sync .railway-deploy: Task 7
- ✅ Progress bar CSS var: Task 1 Step 4
- ✅ Mobile hamburger: Task 2 Step 2
- ✅ Mobile overlay backdrop: Task 2 Step 3
- ✅ Detail panel width 300px → spec says уменьшить до 300px от 360px: добавлено в Task 3 (`.grid-3col`)

### Placeholders
- Task 6 Step 5 содержит условную логику для `__setStatus` — это инструкция для исполнителя проверить существующий API.

### Type consistency
- `buildAccordionDetailPanel(msg, a)` — принимает те же аргументы что и блок кода который он заменяет
- `window.__accToggle` вызывается из onclick в строке generated HTML — имя совпадает
- `mid(msg)` — существующая утилита в app.js (строка ~2706)
- `esc()`, `escAttr()` — существующие утилиты в app.js
