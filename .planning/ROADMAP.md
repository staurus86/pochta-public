# Roadmap: pochta-platform

## Milestones

- **v1.0 Entity Extraction Sprint** — Phases 01-09, shipped 2026-04-22 → [archive](milestones/v1.0-ROADMAP.md)
- **v1.1 Detection Quality Sprint** — Phases 10-14, shipped 2026-05-28, 15/15 req, 153 tests → [archive](milestones/v1.1-ROADMAP.md)
- **v1.2 Live Deployment & Measurement** — Phase 15, in progress

---

## v1.2 Live Deployment & Measurement (Current)

**Milestone Goal:** Задеплоить v1.1 на Railway production, получить реальные post-deploy метрики через live audit, принять решение о приоритетах v1.3 на основе данных.

- [x] **Phase 15: Deploy + Live Baseline** — Push v1.1, smoke-check, baseline_v6.json post-reanalysis, DELTA.md (completed 2026-05-28)

### Phase 15: Deploy + Live Baseline
**Goal**: v1.1 код работает в production, живые метрики зафиксированы в baseline_v5.json, принято решение о следующем приоритете
**Depends on**: Nothing (v1.1 code ready in .railway-deploy/)
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, MEASURE-01, MEASURE-02, MEASURE-03
**Success Criteria** (what must be TRUE):
  1. `git push origin main` выполнен — Railway подхватил `.railway-deploy/` изменения
  2. `GET https://pochta-production.up.railway.app/api/health` возвращает 200 после деплоя
  3. Ключевые v1.1 фичи работают на живых данных (spot-check через UI или curl)
  4. `baseline_v5.json` содержит live-prod метрики (n=300, seed=42) — не старый snapshot
  5. `DELTA.md` показывает delta v1 → v5 по каждому из 8 полей
  6. Записано решение: какое поле приоритизировать в v1.3
**Plans**: TBD (будет создан при `/gsd:plan-phase 15`)

---

## Progress

| Milestone | Phases | Requirements | Status | Shipped |
|-----------|--------|--------------|--------|---------|
| v1.0 Entity Extraction Sprint | 01-09 | - | ✅ Complete | 2026-04-22 |
| v1.1 Detection Quality Sprint | 10-14 | 15/15 | ✅ Complete | 2026-05-28 |
| v1.2 Live Deployment & Measurement | 15 | 6/6 | ✅ Complete | 2026-05-28 |
