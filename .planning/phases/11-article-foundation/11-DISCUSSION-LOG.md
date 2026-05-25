# Phase 11: Article Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-25
**Phase:** 11-article-foundation
**Areas discussed:** Стратегия миграции, Подписи и цитаты, UUID-фильтр

---

## Стратегия миграции

| Option | Description | Selected |
|--------|-------------|----------|
| Полная замена сразу | Удалить inline-каскад, заменить extractArticles(). Сравнить с baseline 80.7% после. | ✓ |
| Shadow-режим | Запускать оба параллельно, логгировать расхождения. | |

**User's choice:** Полная замена сразу
**Notes:** Baseline Phase 10 (article.present=80.7%) служит контрольной точкой — если падение > 5% после reanalysis, расследовать.

---

## Подписи и цитаты

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-exclude подписи, score-filter цитаты | Подписи всегда шаблон — hard-exclude. Цитаты могут нести реальный запрос — score -2. | ✓ |
| Hard-exclude обе зоны | Чище, но теряем forwarded-письма где запрос в цитате. | |
| Score-filter обе зоны | Оставляет зазор для labeled артикулов из подписей. | |

**User's choice:** Hard-exclude подписи, score-filter цитаты
**Notes:** Forwarded-письма где весь запрос в quoted thread должны сохранить артикулы через score-filter fallback.

---

## UUID-фильтр

| Option | Description | Selected |
|--------|-------------|----------|
| UUID v4 + длинные hex строки | UUID-формат 8-4-4-4-12 + hex ≥ 20 символов без дефисов. | ✓ |
| UUID v4 только | Только канонический формат 8-4-4-4-12. | |

**User's choice:** UUID v4 + длинные hex строки
**Notes:** Паттерн добавляется в rejectArticleCandidate() в article-filters.js с label "uuid_or_long_hex".

---

## Claude's Discretion

- minScore threshold (оставить 3/5 по умолчанию)
- Форма при collapse дублей (первая встреченная)
- Структура тестов

## Deferred Ideas

None.
