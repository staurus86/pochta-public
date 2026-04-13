# Design: Inbox UX — Кликабельные фильтры и реклассификация спама

**Дата:** 2026-04-13  
**Источник:** Комментарии Сергея Балыкина (#1, #17) к отчёту «Pochta Platform — Апрель 2026»  
**Файлы:** `public/app.js`, `public/index.html`, `public/styles.css`

---

## Проблема

1. **#1** — Сайдбар показывает счётчики «CRM-готово: 1446», «Уточнение: 9» и т.д. как статичный текст. Нет способа одним кликом перейти к письмам с нужным статусом.
2. **#17** — Вкладка «Спам» есть, но нельзя перенести письмо из спама на проверку к менеджеру.

---

## Решение

### 1. Кликабельные счётчики сайдбара

**Новая переменная состояния:**
```js
let inboxStatusFilter = ''; 
// Возможные значения: '' | 'ready_for_crm' | 'needs_clarification' | 'review' | 'ignored_spam'
```

**Поведение:**
- Клик на счётчик → `inboxStatusFilter = '<status>'`, вкладка переключается на `'all'`, вызывается `renderInbox()`
- Повторный клик того же счётчика → `inboxStatusFilter = ''` (сброс)
- Активный счётчик подсвечивается классом `active` (левая полоска цвета + чуть темнее фон)

**Изменение `renderSidebarStats()`:**  
Плашки `<div class="sidebar-stat">` → `<button class="sidebar-stat" data-status-filter="ready_for_crm">`. Добавляется `cursor: pointer`, hover-эффект, активное состояние. Кнопки вешают обработчик на `click` при рендере.

**Изменение `filterInboxMessages(tab)`:**  
После mailbox-фильтра добавляется:
```js
if (inboxStatusFilter) {
  msgs = msgs.filter((m) => m.pipelineStatus === inboxStatusFilter);
}
```

**Сброс статус-фильтра:**  
При клике на любую вкладку инбокса (`inbox-tab`) — `inboxStatusFilter` сбрасывается.

**Счётчики сайдбара с фильтрами:**
| Плашка | `data-status-filter` |
|--------|---------------------|
| CRM-готово | `ready_for_crm` |
| Уточнение | `needs_clarification` |
| Спам | `ignored_spam` |

Плашки «Всего писем» и «Непрочитанных» — не кликабельные (нет конкретного статуса).

---

### 2. Кнопка «Перенести на проверку» в спаме

**Где:** В карточке письма, только когда активна вкладка «Спам» или статус-фильтр `ignored_spam`.

**Кнопка:**  
```html
<button class="btn-unspam" title="Перенести на проверку менеджера">↩ На проверку</button>
```

**Действие при клике:**
1. `PATCH /api/projects/:projectId/messages/:messageKey` с телом `{ pipelineStatus: 'review' }`
2. API уже реализован в `server.js:1372` — изменений бэкенда не нужно
3. При успехе: обновить `pipelineStatus` у письма в `allRunnerMessages`, вызвать `renderInbox()`
4. Письмо исчезает из спам-вкладки, появляется в «Модерации»

**Функция:**
```js
async function unspamMessage(projectId, messageKey) {
  await apiFetch(`/api/projects/${projectId}/messages/${encodeURIComponent(messageKey)}`, {
    method: 'PATCH',
    body: JSON.stringify({ pipelineStatus: 'review' })
  });
  const m = allRunnerMessages.find((x) => x.messageKey === messageKey);
  if (m) m.pipelineStatus = 'review';
  renderInbox();
  renderSidebarStats();
}
```

---

## Затронутые файлы

| Файл | Изменение |
|------|-----------|
| `public/app.js` | +`inboxStatusFilter` переменная, изменение `renderSidebarStats`, `filterInboxMessages`, `updateInboxTabCounts`, добавление `unspamMessage`, обработчик кнопки в рендере карточки |
| `public/index.html` | Нет изменений |
| `public/styles.css` | Стили для `.sidebar-stat` как кнопки (hover, active, cursor) + `.btn-unspam` |

---

## Что НЕ меняется

- Бэкенд (`server.js`, `detection-kb.js`, `email-analyzer.js`) — без изменений
- Существующие вкладки и их логика — без изменений
- Логика `isSpam`, `isRequest`, `isModeration` — без изменений

---

## Критерии готовности

- [ ] Клик «CRM-готово: 1446» → инбокс показывает только `ready_for_crm` письма
- [ ] Клик «Уточнение: 9» → инбокс показывает только `needs_clarification` письма  
- [ ] Клик «Спам: 276» → переключается на вкладку «Все» с фильтром `ignored_spam`
- [ ] Повторный клик активного счётчика → сброс фильтра
- [ ] Клик на вкладку инбокса → сброс статус-фильтра
- [ ] Активный счётчик визуально подсвечен
- [ ] Кнопка «↩ На проверку» видна в карточках спам-писем
- [ ] Клик «↩ На проверку» → письмо перемещается в «Модерацию», исчезает из спама
