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
- [ ] **Phase 18: Qty Quality** — Extractor fixes + metric redefinition (noise_free 4% → ≥30%)

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
  3. `brand.noise_free` в baseline_v8 ≥ 55%
**Plans**: 2 plans

Plans:
- [x] 17-01-PLAN.md — TDD: устранить ghost-паттерны GHOST-1..4 (reply-zone filter, slash-split, concat-dedup, generic aliases) + regression tests, mirror в .railway-deploy
- [x] 17-02-PLAN.md — GHOST-5 audit fix (full body) + deploy + reanalysis + capture baseline_v8 + delta measurement

### Phase 18: Qty Quality
**Goal**: qty.noise_free растёт с 4% до ≥30% — фикс HTML table split + bold strip + метрика v2 (без штрафа за письма без qty)
**Depends on**: Phase 15 (baseline есть)
**Requirements**: QTY-01, QTY-02, QTY-03
**Success Criteria**:
  1. Исследование выявило 2 fixable паттерна (HTML table split 13 писем, bold wrapping 1 письмо) + структурный дефект метрики (75/112 noise — legitimate no-qty emails)
  2. QTY-1 (multiline_table scanner) + QTY-2 (bold strip) внедрены с TDD тестами
  3. check_qty v2: "no qty in email" больше не является noise
  4. `qty.noise_free` в baseline_v9 ≥ 30% (estimate: 40-46% achievable)
**Plans**: 2 plans

Plans:
- [x] 18-01-PLAN.md — TDD: QTY-1 multiline_table scanner + QTY-2 bold strip + check_qty v2 metric + mirror
- [ ] 18-02-PLAN.md — Deploy + reanalysis + capture baseline_v9 + delta vs baseline_v8

---

## Progress

| Milestone | Phases | Requirements | Status | Shipped |
|-----------|--------|--------------|--------|---------|
| v1.0 Entity Extraction Sprint | 01-09 | - | ✅ Complete | 2026-04-22 |
| v1.1 Detection Quality Sprint | 10-14 | 15/15 | ✅ Complete | 2026-05-28 |
| v1.2 Live Deployment & Measurement | 15 | 6/6 | ✅ Complete | 2026-05-28 |
| v1.3 Field Quality Sprint | 16-18 | 10/10 | 🔄 In progress | - |

**Execution Order:** 16 → 17 → 18 (можно параллельно 17 и 18 после 16)
