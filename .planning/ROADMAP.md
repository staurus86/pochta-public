# Roadmap: pochta-platform

## Milestones

- **v1.0 Entity Extraction Sprint** - Phases 01-09 (shipped 2026-04-22)
- **v1.1 Detection Quality Sprint** - Phases 10-14 (in progress)

---

## Phases

<details>
<summary>v1.0 Entity Extraction Sprint (Phases 01-09) — SHIPPED 2026-04-22</summary>

- [x] **Phase 01: Articles** - Zone-aware article extraction refactor
- [x] **Phase 02: Brands** - Brands extraction refactor
- [x] **Phase 03: Product Names** - Product names refactor
- [x] **Phase 04: Quantity** - Quantity refactor
- [x] **Phase 05: FIO** - FIO extraction refactor
- [x] **Phase 06: Company** - Company extraction refactor
- [x] **Phase 07: Position** - Position extraction refactor
- [x] **Phase 08: Phone** - Phone extraction refactor
- [x] **Phase 09: Email** - Email extraction refactor

Parallel track: `01-detection-fixes` — P0/P1 regression cycle (bugs A01-A06, B01-B03).

</details>

### v1.1 Detection Quality Sprint (In Progress)

**Milestone Goal:** Устранить ошибки в каждом поле детекции — клиент видит минимум ошибок в письмах, которые попадают в CRM через n8n. Цель: измеримое baseline до и после каждого фикса.

- [x] **Phase 10: Audit Baseline** - Ручной аудит 50 писем + автоматическая метрика + загрузка n8n-фидбека (completed 2026-05-25)
- [x] **Phase 11: Article Foundation** - Подключение article-extractor.js, UUID-фильтры, нормализация дедупликации (completed 2026-05-25)
- [x] **Phase 12: Quantity and INN** - Фикс positions/totalQty, ИНН из вложений-реквизитов, checksum-валидация ИНН (completed 2026-05-28)
- [x] **Phase 13: Contact Fields** - Блок-лист ФИО из шаблонов robot@, поддержка международных телефонов (completed 2026-05-28)
- [ ] **Phase 14: Brands and Product Names** - Приоритет Subject-брендов, фильтр коротких алиасов, чистка productNames

---

## Phase Details

### Phase 10: Audit Baseline
**Goal**: Операторы получают количественное baseline по каждому полю детекции, чтобы любой следующий фикс можно было измерить
**Depends on**: Nothing (first phase of milestone)
**Requirements**: AUDIT-01, AUDIT-02, AUDIT-03
**Success Criteria** (what must be TRUE):
  1. Агенты провели ручной аудит 50 реальных писем из продакшна и получили structured bug report с ошибками по каждому полю
  2. Автоматический audit-скрипт возвращает % корректных значений отдельно по каждому из 7 полей (ФИО, ИНН, телефон, артикул, бренд, кол-во, название товара)
  3. n8n-фидбек менеджера загружен через GET-эндпоинт и отображается в отчёте аудита как дополнительный сигнал
  4. Audit-скрипт запускается повторно после каждого следующего фикса и показывает дельту к baseline
**Plans**: 3 plans
Plans:
- [x] 10-01-PLAN.md — Build scripts/audit_baseline.py (AUDIT-02 + AUDIT-03)
- [x] 10-02-PLAN.md — Build scripts/audit_sample_50.py (AUDIT-01)
- [x] 10-03-PLAN.md — Run scripts, persist scripts/baselines/baseline_v1.json, commit

### Phase 11: Article Foundation
**Goal**: Артикулы в каждом письме извлекаются только из тела запроса (не из подписей и цитат), без UUID-мусора и без дублей
**Depends on**: Phase 10
**Requirements**: ART-01, ART-02, ART-03
**Success Criteria** (what must be TRUE):
  1. `article-extractor.js` подключён в `extractLead()` — inline regex-каскад 500 строк заменён, зонирование активно
  2. Токены формата UUID v4 (hex 32+ символов) не появляются в массиве артикулов ни в одном письме из аудитной выборки
  3. `MD-025-6L` и `MD 025-6L` сворачиваются в одну запись — дублей с разным пробелом/дефисом нет
  4. Артикулы из подписи и цитированного треда не попадают в результат детекции
**Plans**: 3 plans
Plans:
- [x] 11-01-PLAN.md — Add UUID/long-hex rejection to article-filters.js (ART-02)
- [x] 11-02-PLAN.md — Add signature-zone hard-exclude to article-extractor.js (ART-01)
- [x] 11-03-PLAN.md — Wire extractArticles() into extractLead() + audit baseline gate (ART-01, ART-03)

### Phase 12: Quantity and INN ✅ COMPLETE
**Goal**: Счётчики позиций и количества корректны, ИНН извлекается из вложений-реквизитов, 10-значные ложные ИНН отклоняются
**Depends on**: Phase 11
**Requirements**: ART-04, CONTACT-01, CONTACT-02
**Success Criteria** (what must be TRUE):
  1. `positions` равно числу уникальных артикулов в письме, `totalQty` равно сумме qty по уникальным позициям (кейс Belgormash: было 18/7, должно стать 2/5)
  2. Если тело письма не содержит ИНН, но во вложении (PDF/DOCX карточка контрагента) есть 10-значный ИНН с корректной контрольной суммой — он попадает в `sender.inn`
  3. 10-значное число, не прошедшее checksum ФНС (mod-11), не принимается ни как ИНН, ни как артикул
  4. Audit-скрипт показывает рост % писем с корректным ИНН относительно Phase 10 baseline
**Plans**: 3 plans
Plans:
- [x] 12-01-PLAN.md — finalizeLeadCounts + positions/totalQty rename (ART-04)
- [x] 12-02-PLAN.md — validateInnChecksum + normalizeInn gate + article rejection (CONTACT-02)
- [x] 12-03-PLAN.md — attachment INN checksum filter + audit metrics + baseline_v2 (CONTACT-01)

### Phase 13: Contact Fields
**Goal**: ФИО клиента не загрязнено шаблонными именами из форм, телефоны из Беларуси, Китая и Азербайджана корректно распознаются
**Depends on**: Phase 10
**Requirements**: CONTACT-03, CONTACT-04
**Success Criteria** (what must be TRUE):
  1. «Екатерина Попова» (и другие имена блок-листа robot@siderus.ru) не появляется как ФИО клиента ни в одном письме — клиент-специфичный шаблон заблокирован
  2. Телефоны в формате +375 (Беларусь), +86 (Китай), +994 (Азербайджан) нормализуются и сохраняются в `sender.phone`
  3. Audit-скрипт показывает рост % писем с корректным ФИО и телефоном относительно Phase 10 baseline
**Plans**: 3 plans
Plans:
- [ ] 13-01-PLAN.md — FIO_TEMPLATE_BLOCKLIST + step 0c in validateSenderFields (CONTACT-03)
- [ ] 13-02-PLAN.md — International phone coverage BY/CN/AZ verification + fix (CONTACT-04)
- [ ] 13-03-PLAN.md — audit_baseline.py FIO noise detection + baseline_v3 (CONTACT-03, CONTACT-04)

### Phase 14: Brands and Product Names
**Goal**: Бренды из темы письма детектируются с приоритетом, шумовые короткие алиасы отклонены, productNames не содержат сырых строк и дублей
**Depends on**: Phase 10
**Requirements**: BRAND-02, BRAND-03, PROD-01, PROD-02
**Success Criteria** (what must be TRUE):
  1. Бренд, упомянутый в Subject письма, всегда присутствует в результатах детекции — даже если в теле письма сигнал слабее
  2. Алиасы длиной 1-2 символа не вызывают срабатывания бренда; 3-символьные алиасы (abb→ABB) сохраняются
  3. `productNames` не содержит строк вида `"1. Название товара — N шт."` — сырой формат нумерованного списка убран
  4. Дубли в `productNames`, отличающиеся только HTML-остатком, свёрнуты в одну строку
  5. Audit-скрипт показывает рост % писем с корректными брендами и названиями товаров относительно Phase 10 baseline
**Plans**: 3 plans
Plans:
- [ ] 14-01-PLAN.md — BRAND-02 subject priority (P15/P18 exemption) + BRAND-03 <=2-char alias guard (BRAND-02, BRAND-03)
- [ ] 14-02-PLAN.md — PROD-01 plain-hyphen qty cleanup + PROD-02 HTML-residue dedup + audit fix (PROD-01, PROD-02)
- [ ] 14-03-PLAN.md — Generate baseline_v4.json (BRAND-02, BRAND-03, PROD-01, PROD-02)

---

## Progress

**Execution Order:** 10 → 11 → 12 → 13 → 14
(Phase 13 depends on Phase 10, not 12 — can begin after baseline is established)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 10. Audit Baseline | v1.1 | 3/3 | Complete    | 2026-05-25 |
| 11. Article Foundation | v1.1 | 3/3 | Complete    | 2026-05-25 |
| 12. Quantity and INN | v1.1 | 3/3 | Complete    | 2026-05-28 |
| 13. Contact Fields | v1.1 | 3/3 | Complete    | 2026-05-28 |
| 14. Brands and Product Names | v1.1 | 0/3 | Not started | - |
