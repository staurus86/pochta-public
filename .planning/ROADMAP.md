# Roadmap: pochta-platform

## Milestones

- **v1.0 Entity Extraction Sprint** — Phases 01-09, shipped 2026-04-22 → [archive](milestones/v1.0-ROADMAP.md)
- **v1.1 Detection Quality Sprint** — Phases 10-14, shipped 2026-05-28, 15/15 req → [archive](milestones/v1.1-ROADMAP.md)
- **v1.2 Live Deployment & Measurement** — Phase 15, shipped 2026-05-28 → baseline_v6.json
- **v1.3 Field Quality Sprint** — Phases 16-18, in progress

---

## v1.3 Field Quality Sprint (Current)

**Milestone Goal:** Поднять INN.present ≥50%, brand.noise_free ≥55%, qty.noise_free ≥20% — три самых слабых поля по baseline_v6.

- [x] **Phase 16: INN Quality** — 34.7%→45.7% (+11pp); цель 50% не достигнута (gap 4.3pp)
- [ ] **Phase 17: Brand Quality** — Исследовать и устранить ghost brands (noise_free 45.3% → 55%+)
- [ ] **Phase 18: Qty Quality** — Отфильтровать шумовые количества (noise_free 4% → 20%+)

---

### Phase 16: INN Quality
**Goal**: INN.present растёт с 34.7% до ≥50% — письма, в которых ИНН реально есть в тексте, получают его в sender.inn
**Depends on**: Phase 15 (baseline есть)
**Requirements**: INN-01, INN-02, INN-03, INN-04
**Success Criteria**:
  1. Исследование выявило топ-3 паттерна пропуска ИНН (какие форматы не извлекаются)
  2. Расширенные паттерны извлечения покрывают выявленные случаи
  3. `inn.present` в baseline_v7 ≥ 50% (рост ≥ 15pp от baseline_v6)
  4. Новые тесты регрессии зелёные
**Plans**: 3 plans

Plans:
- [x] 16-01-PLAN.md — INN regex fixes A+B+C (em-dash, HTML strip, EDO pattern) + TDD tests
- [x] 16-02-PLAN.md — Auto-learning company_directory enrichment (Fix D) + TDD tests
- [x] 16-03-PLAN.md — Deploy + reanalysis + capture baseline_v7 + delta measurement

### Phase 17: Brand Quality
**Goal**: brand.noise_free растёт с 45.3% до ≥55% — меньше ghost brands в результатах
**Depends on**: Phase 15 (baseline есть)
**Requirements**: BRAND-04, BRAND-05, BRAND-06
**Success Criteria**:
  1. Исследование идентифицировало топ-5 паттернов ghost brands с примерами
  2. Каждый паттерн устранён с regression тестом
  3. `brand.noise_free` в baseline_v7 ≥ 55%
**Plans**: TBD

### Phase 18: Qty Quality
**Goal**: qty.noise_free растёт с 4% до ≥20% — шумовые значения (OCR-ошибки, страничные номера) отфильтрованы
**Depends on**: Phase 15 (baseline есть)
**Requirements**: QTY-01, QTY-02, QTY-03
**Success Criteria**:
  1. Исследование идентифицировало основные паттерны шумовых qty (OCR страничные номера, timestamp-qty, коды позиций)
  2. Фильтры внедрены с regression тестами
  3. `qty.noise_free` в baseline_v7 ≥ 20%
**Plans**: TBD

---

## Progress

| Milestone | Phases | Requirements | Status | Shipped |
|-----------|--------|--------------|--------|---------|
| v1.0 Entity Extraction Sprint | 01-09 | - | ✅ Complete | 2026-04-22 |
| v1.1 Detection Quality Sprint | 10-14 | 15/15 | ✅ Complete | 2026-05-28 |
| v1.2 Live Deployment & Measurement | 15 | 6/6 | ✅ Complete | 2026-05-28 |
| v1.3 Field Quality Sprint | 16-18 | 10/10 | 🔄 In progress | - |

**Execution Order:** 16 → 17 → 18 (можно параллельно 17 и 18 после 16)
