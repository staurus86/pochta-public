# UI-REVIEW — Pochta Platform
> Дата: 2026-04-27 | Аудитор: gsd-ui-auditor | Стандарт: 6-pillar (1–4)

---

## Контекст

Проект содержит **два параллельных фронтенда**:

| UI | Путь | Статус | Стек |
|----|------|--------|------|
| **Legacy SPA** | `public/` | Продакшн (Railway) | Vanilla JS + CSS custom-props |
| **New CRM UI** | `apps/web/` | WIP / не задеплоен | Next.js 15, Tailwind, shadcn-style |

Аудит охватывает оба. Legacy — основной; New UI — задел на будущее.

---

## Итоговые оценки

| Pillar | Legacy SPA | New CRM UI |
|--------|-----------|-----------|
| 1. Copywriting | 3/4 | 3/4 |
| 2. Visuals | 3/4 | 2/4 |
| 3. Color | 3/4 | 3/4 |
| 4. Typography | 3/4 | 3/4 |
| 5. Spacing | 3/4 | 2/4 |
| 6. Experience Design | 3/4 | 2/4 |
| **ИТОГО** | **18/24** | **15/24** |

---

## Pillar 1 — Copywriting

### Legacy SPA — 3/4

**Хорошо:**
- Весь интерфейс на русском, технические термины корректны
- Keyboard hints inline: `j`/`k` навигация, `r` обновить — лаконично и полезно
- Pipeline status описания в API Docs понятны и полные
- Пустые состояния информативны: «Нажмите «Получить письма» и выберите письмо из списка слева»

**Проблемы:**
- **Mixed-language headers** в Dashboard: «Quality Audit», «Runtime статус», «Integration Endpoints» — английские заголовки среди русского UI. Либо переводить всё, либо оставлять всё на английском — не мешать
- **Inconsistent title case**: «Покрытие Полей», «Очередь Проблемных Писем», «SLA И Приоритет» — каждое слово с заглавной, остальные панели: «Воронка обработки», «Письма по дням» — только первое. Нужен единый стиль
- **Аббревиатуры без подсказок**: поля «МОП» и «МОЗ» в форме проекта — пользователь нового проекта не поймёт без tooltip
- «Глубина, дней» — неловкая формулировка, лучше «Период (дней)» или «Глубина поиска»

### New CRM UI — 3/4

**Хорошо:**
- Чёткая иерархия: заголовок → счётчик → тулбар → таблица
- «Горячие клавиши» — понятная кнопка
- «8 писем (отфильтровано)» — хорошая обратная связь по фильтрам

**Проблемы:**
- Mock-данные в `inbox/page.tsx` — если UI когда-либо покажут заказчику, он увидит захардкоженные тестовые письма
- Кнопка «Класс» в bulk-actions — неочевидная; лучше «Изменить класс» или «Переклассифицировать»

---

## Pillar 2 — Visuals

### Legacy SPA — 3/4

**Хорошо:**
- Dashboard Dashboard-компоновка продуманная: KPI → воронка+бары → топы → аналитика
- KPI-карты с цветным left-border акцентом — чистое решение
- Inbox 3-column grid (список | тело | детали) — стандарт email-клиентов, всё правильно
- Sidebar collapse до иконок — деградирует корректно
- Heatmap почтовых ящиков с цветовой температурой: hot/warm/cold — наглядно
- DnD-панель для перекласификации — продвинутая функция

**Проблемы:**
- **Toolbar перегружен**: в Inbox 2 строки фильтров + tabs + строка с пагинацией и kbd-hints = 4 элемента до начала контента. При 1080p это ~120px накладных расходов
- **«Удалить все»** (`btn-danger`) стоит в одном ряду с экспортными кнопками CSV/XLSX — деструктивная операция рядом с безопасными без визуального разделения
- Emoji в пустых состояниях (📬, 📋, 🔍) контрастируют с остальными SVG-иконками — разный визуальный «язык»

### New CRM UI — 2/4

**Хорошо:**
- Dark sidebar + light content — классический enterprise-контраст
- lucide-react — единая иконная система
- Таблица с sortable headers — хорошо

**Критические проблемы:**
- **Active indicator не рендерится**: в `Sidebar.tsx` индикатор активного пункта (`absolute left-0 top-1/2`) использует абсолютное позиционирование, но родительский `<Link>` не имеет `relative` — индикатор будет вылетать за пределы контейнера
  ```tsx
  // Sidebar.tsx:74 — нужно добавить relative к Link
  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent-blue rounded-r-full" />
  ```
- **Sidebar collapse ломает layout**: в `AppShell` задан `ml-56` как хардкод, но sidebar при collapse меняет ширину на `w-16`. Main content не адаптируется — sidebar перекрывает контент или остаётся огромный зазор

---

## Pillar 3 — Color

### Legacy SPA — 3/4

**Хорошо:**
- Семантическая система: green=ok/ready, amber=review, rose=danger, blue=info/accent, purple=vendor — последовательно используется везде (badges, KPI, confidence bar, toast)
- Dim-colors для фонов: `--green-dim`, `--rose-dim` и т.д. — хорошая практика
- Status pulse-animation у status-dot в sidebar footer — тонкая живость

**Проблемы:**
- **Gradient background**: `--bg: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)` — очень тонкий градиент, практически незаметный. Зачем усложнять: `--bg-solid` используется отдельно в ряде мест. Лучше один flat цвет
- **Accent inconsistency**: в header inline style `border-color:var(--accent,#7c6af7)` — fallback `#7c6af7` (фиолетовый), тогда как `--accent` в CSS `#3b82f6` (синий). Если CSS не подгружается, LLM-кнопка будет фиолетовой
- Таблица внутри API Docs использует hardcoded цвета `#1a3a2a`, `#1a2a3a` вместо CSS vars

### New CRM UI — 3/4

**Хорошо:**
- `steel-*` палитра хорошо структурирована в Tailwind config
- Accent: blue, emerald, rose, amber — семантически корректно
- Shortcut hint card использует `bg-steel-900 border-steel-700` — создаёт хороший темный блок

**Проблемы:**
- `text-2xs` — кастомный utility, нет подтверждения что он определён в tailwind config (если нет — невидимый текст в нескольких компонентах)

---

## Pillar 4 — Typography

### Legacy SPA — 3/4

**Хорошо:**
- Inter + JetBrains Mono — стандарт enterprise UI
- KPI: 28px/800 — хорошо читаемые цифры
- `-webkit-font-smoothing: antialiased` применён
- `letter-spacing: -0.03em` на KPI values — профессиональный touch

**Проблемы:**
- **Heading sizes**: h1 в sidebar `font-size: 16px`, h2 в main header `font-size: 15px`, h3 в panel headers `font-size: 13px` — заголовки мельчают почти до текста тела. Семантически это h3 но визуально label-уровень
- Много `font-size: 10px` элементов (nav labels, table headers, detail keys) — на мониторах с низким DPI может быть сложночитаемо
- Inconsistent casing: nav-section-labels uppercase через CSS, panel headers — смешанный case через HTML

### New CRM UI — 3/4

**Хорошо:**
- `font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11'` — проработанные OpenType features для Inter
- Чёткая иерархия в inbox: `text-xl font-bold` → `text-sm text-steel-400` → table headers `text-xs uppercase`
- `tabular-nums` на дате — корректная практика

**Проблемы:**
- `text-2xs` используется в `Sidebar.tsx` (subtitle), `ExtractedFieldsPanel.tsx`, `InboxPage` — если utility не определён, это silent failure
- `text-sm` для основного текста таблицы при плотной таблице — на 1080p достаточно, но только если межстрочный интервал в норме

---

## Pillar 5 — Spacing

### Legacy SPA — 3/4

**Хорошо:**
- `--radius`, `--radius-sm`, `--radius-lg` — многоуровневый border-radius
- Panel padding `16px 20px` — последовательный
- Grid gaps `14-16px` — ритмичные
- `main-content padding: 24px 28px` — достаточно воздуха

**Проблемы:**
- KPI card padding: `18px 20px 18px 22px` — левый отступ на 2px больше ради accent bar `width: 3px`. Лучше `padding-left: 19px` (3px bar + 16px space) для точности
- Inbox toolbar row 2 (`toolbar-filters`) — сжат до `flex-wrap: wrap` с `gap: 6px`, но при флексе wrap и маленьких размерах создаётся плотная масса из 7 контролов
- `grid-3col`: фиксированная высота `height: calc(100vh - 280px)` — хрупко при изменении размеров header

### New CRM UI — 2/4

**Критические проблемы:**
- **`ml-56` hardcoded** в `AppShell.tsx:33`: при collapse sidebar становится `w-16` (4rem = 64px), но main content по-прежнему имеет `ml-56` (224px) — 160px мёртвого пространства слева
  ```tsx
  // AppShell.tsx — нужно передавать collapsed state или использовать CSS var
  <main className="flex-1 ml-56 min-h-screen"> // ← проблема
  ```
- Pagination кнопки используют raw `className` string concatenation вместо `Button` компонента — выбивается из design system
- `p-6` в AppShell `<div>` — 24px фиксированный, но внутренние страницы сами добавляют `space-y-4`. Нормально, но возможно двойное паддинг-накопление

---

## Pillar 6 — Experience Design

### Legacy SPA — 3/4

**Хорошо:**
- Page transitions `page-fade-in` с opacity + translateY — плавно
- Auto-refresh select с вариантами 30s/1m/5m
- Command palette (⌘K) — продвинутая фича
- DnD reclassify — уникально для email-платформ
- Hover-card preview — ускоряет работу
- Toast stack (не перекрывает друг друга)
- Progress bar при загрузке с анимацией
- Bulk-actions toolbar появляется только при выделении

**Проблемы:**
- **Деструктивные операции без подтверждения**: «Удалить все» — нет confirm dialog или undo
- **Mobile filter visibility**: при ширине <959px `toolbar-filters` скрывается (display:none). 7 фильтров просто исчезают без альтернативы — это не «mobile-first», а «mobile-never-filter»
- Sidebar collapse toggle `‹` / `›` — один символ без label; непонятно без наведения
- Reanalyze и LLM-анализ прогресс-бары встроены в header на одной строке с фильтром проектов — при двух активных прогрессах header переполняется

### New CRM UI — 2/4

**Хорошо:**
- Sort state в EmailList корректен (field + direction)
- Indeterminate checkbox состояние реализовано
- Copy-to-clipboard с визуальным feedback (Check icon)
- `useMemo` для фильтрации — правильно

**Критические проблемы:**
- **Sidebar collapse не меняет layout** (см. Spacing): сайдбар схлопывается визуально, но main content остаётся со старым margin — UX-баг при взаимодействии
- **Pagination не реализована**: `totalPages` вычисляется, кнопки рендерятся, но данные не нарезаются — всегда показываются все записи
- **Нет loading/error states** во всех страницах (только mock data, нет skeleton-ов)
- **Active indicator bug** (см. Visuals): выбранный пункт навигации не имеет визуального индикатора

---

## Топ-10 исправлений (по приоритету)

### Критичные (баги)

1. **[New UI] `Sidebar.tsx:74`** — добавить `relative` к родительскому `<Link>` чтобы `absolute` active indicator рендерился корректно
2. **[New UI] `AppShell.tsx:33`** — `ml-56` должен обновляться при collapse: поднять `collapsed` state в AppShell и передавать в Sidebar; либо использовать CSS custom property `--sidebar-w`
3. **[New UI] `inbox/page.tsx`** — реализовать реальную постраничную нарезку или убрать pagination UI до имплементации

### Высокий приоритет

4. **[Legacy] Деструктивные кнопки** — добавить confirm dialog для «Удалить все» и bulk-delete; как минимум undo-toast
5. **[Legacy] Mobile filters** — добавить кнопку «Фильтры» на мобиле, которая открывает drawer/sheet с filter controls; сейчас функциональность просто пропадает
6. **[New UI] `text-2xs`** — верифицировать что утилита определена в tailwind.config; если нет — добавить в `theme.extend.fontSize`

### Средний приоритет

7. **[Legacy] Mixed-language headers** — выбрать единый язык для заголовков панелей; предпочтительно полный русский для внутреннего инструмента
8. **[Legacy] Title case consistency** — стандартизировать: только первое слово с заглавной (sentence case) во всех h3 panel headers
9. **[Legacy] МОП/МОЗ tooltips** — добавить `title` или inline hint к аббревиатурам в форме проекта
10. **[Legacy] Toolbar density** — рассмотреть схлопывание фильтров inbox row 2 в dropdown «Фильтры» по умолчанию с expanded toggle

---

## Сильные стороны (что оставить)

- **Legacy**: команда palette + DnD + hover-card + auto-refresh — серьёзный UX-арсенал для внутреннего инструмента
- **Legacy**: семантическая цветовая система CSS vars — масштабируется
- **Legacy**: confidence bar с high/medium/low семантикой — чистый паттерн
- **New UI**: Button компонент с `forwardRef`, `loading`, `icon` — production-ready API
- **New UI**: `ExtractedFieldsPanel` с copy-to-clipboard и source_snippet — отличная detail-UX
- **New UI**: Inter font features + tabular-nums — внимание к типографике

---

## ## UI REVIEW COMPLETE
