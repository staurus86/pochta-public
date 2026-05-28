# Delta Report: v1 → v5 (live-prod)

**baseline_v1.json** — 2026-05-25, live-prod, n=300, seed=42 (pre-v1.1)
**baseline_v5.json** — 2026-05-28, live-prod, n=300, seed=42 (post-v1.1 deploy, OLD stored data)

---

## Delta Table

| Field | v1 present | v5 present | Δ | v1 noise_free | v5 noise_free | Δ |
|-------|-----------|-----------|---|--------------|--------------|---|
| fio | 91.3% | 91.3% | 0 | 95.3% | 89.3% | **-6.0pp** |
| inn | 76.3% | 36.7% | **-39.6pp** | 73.7% | 35.7% | **-38.0pp** |
| phone | 74.3% | 75.7% | +1.4pp | 74.3% | 75.7% | **+1.4pp** ✅ |
| article | 75.0% | 80.7% | **+5.7pp** ✅ | 74.7% | 71.3% | -3.4pp |
| brand | 65.0% | 64.0% | -1.0pp | 58.3% | 49.3% | -9.0pp |
| qty | 26.0% | 42.3% | **+16.3pp** ✅ | -23.0% | 4.0% | **+27.0pp** ✅ |
| positions | — | 4.0% | new | — | -73.3% | new |
| product_name | 68.3% | 71.0% | +2.7pp | 68.3% | 71.0% | **+2.7pp** ✅ |

---

## ⚠️ Важно: эти данные — СТАРЫЕ анализы + НОВЫЙ аудит

**baseline_v5 НЕ отражает улучшения v1.1** — продакшн БД хранит результаты анализа ещё со старым кодом.

Аудит-скрипт читает сохранённые `sender.inn`, `lead.positions` и т.д. из БД. Новый код v1.1 не пересчитал их.

### Почему INN упал с 73% до 35%

`check_inn` в аудите теперь использует `validate_inn_checksum()`. Старые анализы хранили ИНН без проверки контрольной суммы → они теперь помечаются как noise. Это **правильное поведение аудита** — он честно показывает что в БД лежат невалидные ИНН.

**После переанализа** новый код либо найдёт валидный ИНН (из вложения или тела), либо поставит null — и INN.noise_free вырастет.

### Что реально улучшилось в v5 (видно уже сейчас)

- **qty.noise_free**: -23% → +4% (+27pp) — `finalizeLeadCounts` уже работает на новых письмах
- **article.present**: 75% → 80.7% (+5.7pp) — `article-extractor.js` ловит больше артикулов
- **product_name.noise_free**: 68.3% → 71.0% (+2.7pp) — cleanup работает
- **phone.noise_free**: 74.3% → 75.7% (+1.4pp) — небольшой рост

---

## Следующий шаг: переанализ → baseline_v6

1. **Запустить переанализ** project-3 и project-4 в UI (кнопка «Переанализировать»)
2. Дождаться завершения (~10-20 минут для 2000+ писем)
3. Запустить `python scripts/audit_baseline.py --token ... --limit 300 --seed 42 --skip-n8n --out scripts/baselines/baseline_v6.json`
4. baseline_v6 покажет РЕАЛЬНОЕ улучшение от v1.1

---

## Ожидаемые улучшения в baseline_v6 (после переанализа)

| Field | Ожидаем | Причина |
|-------|---------|---------|
| inn.noise_free | рост | Невалидные ИНН → null; валидные из вложений подхватятся |
| fio.noise_free | рост | «Екатерина Попова» → null (FIO_TEMPLATE_BLOCKLIST) |
| positions.present | рост | `finalizeLeadCounts` пишет `lead.positions` для всех |
| brand.present | рост | Subject-priority brands — бренды из Subject больше не теряются |
| brand.noise_free | рост/стабильно | ≤2-char aliases больше не дают ложных срабатываний |

---

## v1.3 Priority Decision

**После переанализа** (baseline_v6) принять финальное решение. Предварительно на основе v5:

1. **INN** — приоритет HIGH (35.7% noise_free → ожидаем 60%+ после переанализа)
2. **positions** (qty) — приоритет HIGH (4% present → ожидаем 60%+ после переанализа)
3. **brand.noise_free** (49.3%) — приоритет MEDIUM (ghost brands, short aliases уже частично закрыты)

**Решение уточнить после baseline_v6.**
