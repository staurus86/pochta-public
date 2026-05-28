# Requirements — v1.2 Live Deployment & Measurement

**Milestone:** v1.2
**Status:** Defined
**Date:** 2026-05-28

---

## In Scope

### DEPLOY — Деплой v1.1 в production

- [ ] **DEPLOY-01**: v1.1 код задеплоен на Railway production (`git push origin main`) — `.railway-deploy/src/` содержит все изменения из v1.1
- [ ] **DEPLOY-02**: Smoke-check после деплоя — `GET /api/health` отвечает 200, анализ тестового письма через UI возвращает результат без 500-ошибок
- [ ] **DEPLOY-03**: Проверка ключевых v1.1 фич на живых данных:
  - `finalizeLeadCounts` — positions/totalQty без дублей
  - `validateInnChecksum` — ИНН с неверной контрольной суммой = null
  - `FIO_TEMPLATE_BLOCKLIST` — «Екатерина Попова» = null в fullName
  - `subjectGroundedBrands` — бренд из Subject присутствует в detectedBrands

### MEASURE — Живые метрики после деплоя

- [ ] **MEASURE-01**: `audit_baseline.py` запущен против live production API (не локальный snapshot) — `baseline_v5.json` с n=300, seed=42
- [ ] **MEASURE-02**: Delta v1 → v5 посчитана по каждому полю — задокументирована в `DELTA.md`
- [ ] **MEASURE-03**: Решение принято: какое поле детекции приоритизировать в v1.3 (бренды / артикулы / компания / ФИО / ИНН / qty)

---

## Future Requirements (deferred to v1.3+)

- Brand quality: noise_free 58% → 70%+ (зависит от реальных постдеплой метрик)
- qty/positions: измерение реального улучшения от finalizeLeadCounts
- src/ ↔ .railway-deploy/ auto-sync (REQ-SYNC-01) — инфраструктурная задача
- Company/INN quality — после измерений

---

## Out of Scope

- Новые фичи детекции — только после получения реальных метрик
- v2 монорепо — без изменений
- OCR вложений

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| DEPLOY-01 | Phase 15 | Pending |
| DEPLOY-02 | Phase 15 | Pending |
| DEPLOY-03 | Phase 15 | Pending |
| MEASURE-01 | Phase 15 | Pending |
| MEASURE-02 | Phase 15 | Pending |
| MEASURE-03 | Phase 15 | Pending |
