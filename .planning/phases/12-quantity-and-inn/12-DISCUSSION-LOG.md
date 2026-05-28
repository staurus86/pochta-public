# Phase 12: Quantity and INN - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-28
**Phase:** 12-quantity-and-inn
**Areas discussed:** positions/totalQty, INN checksum, Audit gate

---

## positions/totalQty — логика и имена полей

| Option | Description | Selected |
|--------|-------------|----------|
| positions + totalQty | totalPositions переименовать в positions, добавить totalQty | ✓ |
| totalPositions + totalQty | Оставить totalPositions, добавить totalQty | |
| positions + totalQty + legacy totalPositions | Добавить оба новых поля, сохранить totalPositions | |

**User's choice:** positions + totalQty
**Notes:** Переименование может сломать CRM-адаптер (lead.total_positions) — обновить при переименовании.

---

### NULL qty handling

| Option | Description | Selected |
|--------|-------------|----------|
| null-qty = 0 в сумме | totalQty = сумма, null считается 0 | ✓ |
| null-qty = 1 (запасной вариант) | Каждая позиция без qty считается 1 шт | |

**User's choice:** null-qty = 0 в сумме
**Notes:** totalQty может быть 0 если ни одна позиция не имеет qty.

---

### Где вычислять

| Option | Description | Selected |
|--------|-------------|----------|
| Пост-процессинг в email-analyzer.js | finalizeLeadCounts(lead) после всех merge-шагов | ✓ |
| В extractLead() на выходе | Вычислять перед return | |

**User's choice:** Пост-процессинг в email-analyzer.js

---

## INN checksum — строгость и scope

### Для каких длин

| Option | Description | Selected |
|--------|-------------|----------|
| Только Россия: 10-зн. + 12-зн. | mod-11 для 10-знак. (юрлица) и ИП (12-знак.), Belarus 9-зн. без checksum | ✓ |
| Россия + Belarus + Казахстан | Широкий охват, но Belarus/Kaz только по длине | |

**User's choice:** Только Россия: 10-зн. (mod-11) + 12-зн. (ИП)
**Notes:** Пользователь предоставил детальную информацию о форматах: Россия 10/12, Belarus 9, Казахстан ИИН 12. Приоритет: Россия > Belarus > Казахстан. Phase 12 — только Russian mod-11.

---

### При fail checksum в теле письма

| Option | Description | Selected |
|--------|-------------|----------|
| Отклонить полностью | sender.inn = null | ✓ |
| Оставить с флагом innChecksum: false | Хранить сомнительный ИНН | |

**User's choice:** Отклонить полностью

---

## Audit gate — как измерить улучшение

### ART-04 метрика

| Option | Description | Selected |
|--------|-------------|----------|
| positions_noise_free: % писем где totalQty > 0 | Простая, без ambiguity | ✓ |
| positions_match_rate: % где positions == len(unique articles) | Строже, но требует доступа к uniq(articles) | |

**User's choice:** positions_noise_free: % писем где totalQty > 0

---

### INN метрика

| Option | Description | Selected |
|--------|-------------|----------|
| inn_valid_rate: % писем где inn прошёл checksum | noise_free для inn — измеряет чистоту | ✓ |
| Оставить только inn.present | Checksum сам по себе уберёт мусор | |

**User's choice:** inn_valid_rate / inn.noise_free: % писем где inn прошёл checksum

---

## Claude's Discretion

- Порядок дедупликации в finalizeLeadCounts: при конфликте qty — брать максимальный (не null)
- Имя функции finalizeLeadCounts — на усмотрение если есть лучший вариант
- positions = 0 (не undefined) когда артикулов нет

## Deferred Ideas

- Kazakhstan ИИН checksum (12-знак.) — для будущей фазы
- Belarus УНП checksum — алгоритм существует, но вне scope
- Автосинхронизация src/ ↔ .railway-deploy/src/ — REQ-SYNC-01
