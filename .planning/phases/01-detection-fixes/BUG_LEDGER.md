# P0 BUG LEDGER — detection-fixes

**Baseline:** `data/prod-messages-local-postAudit2.json` (1657 Клиент писем, Apr 20 2026 12:52)
**Audit script:** `scripts/audit_p0.py` → `P0_AUDIT.json`

Severity: P0 = блокирующий; P1 = массовый мусор; P2 = косметика.
All IDs are `id[:8]` short form from the prod snapshot.

---

## P0-A. Articles — False Positives

### BUG-A01 — Pure 12-digit numeric (ИП ИНН) принимается как артикул [P0, 7 msgs]
- **Symptom:** `194000145952` в `lead.articles` (026b91eb, cb4b0b61, 2e1582e6…)
- **Root cause:** `LABEL_NUMERIC_RE` в `article-extractor.js` ограничен `\d{3,6}` (не выпускает 12-значное), но **legacy path в email-analyzer.js** через attachment/isObviousArticleNoise пропускает. 12 цифр подряд = ИНН ИП, не артикул.
- **Expected:** reject `^\d{12}$` всегда.
- **Proposed fix:** `article-filters.js::rejectArticleCandidate` — добавить предикат `isInnLike` (`^\d{10}$|^\d{12}$` без сильного inline-label). В `email-analyzer.js::isObviousArticleNoise` — reject `^\d{12}$` безусловно.
- **Risk:** минимальный; 12-цифровые товарные коды не встречаются в РФ-каталогах.

### BUG-A02 — HTML table структурные токены как артикулы [P0, 1 msg, 22 instances]
- **Symptom:** [cce3edfc] `row-19, column-1, block-3, row-14, block-1, row-3, row-6, row-5, column-2, row-4, row-10, row-12, row-21, row-11, row-13, row-7, row-8, row-9, row-15, row-16` → 22 ложных артикулов в одном newsletter-письме.
- **Root cause:** BROAD_TOKEN_RE принимает lowercase-starting tokens с digit. `row-19` проходит через все фильтры (нет pattern для structure tokens).
- **Expected:** reject все `^(row|column|col|block|cell|header|footer|section|group|item|wrapper|container|nav|aside)-\d+$`
- **Proposed fix:** `article-filters.js` — добавить `isHtmlStructureToken`. `email-analyzer.js::isObviousArticleNoise` — тот же pattern.
- **Risk:** нулевой; реальные артикулы не имеют lowercase kebab + digits.

### BUG-A03 — Size triple `NN/NN/NN` принимается как артикул [P0, 1+]
- **Symptom:** [eefa81c1] `80/95/70` — размер втулки, а не артикул. Строка письма: `"Втулка 80/95/70 арт 9226513-4 шт"`. Настоящий артикул = `9226513-4`.
- **Root cause:** `SKU_DIGIT_START_RE` `/\d{2,6}(?:[/-]\d{1,6}){1,4}/` принимает `80/95/70`.
- **Expected:** reject `^\d{1,3}(?:[/×xXхХ]\d{1,3}){1,2}$` (size triples: dimensions like 80×95×70, 40/55/80).
- **Proposed fix:** добавить `isSizeTriple` filter.
- **Risk:** низкий; trailing-letter размеры (e.g. 80x95mm) уже отрезаются.

### BUG-A04 — Time/hours pattern `NN-NN.NN` проходит [P0, 1]
- **Symptom:** [628d4deb] `00-18.00` — часы работы, не артикул.
- **Root cause:** `DATE_DMY_RE` `^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}$` — технически матчит `00-18.00` (00 `-` 18 `.` 00), но значение могло прийти через legacy-path без применения DATE_DMY_RE.
- **Expected:** reject in legacy too + добавить HOURS_RE `^\d{1,2}[.\-]\d{1,2}[.\-]\d{2}(?:[.\-]\d{2})?$` где первые 2 числа ≤24 и следующие ≤59.
- **Proposed fix:** extend `isObviousArticleNoise` + verify `isDateTime` path.
- **Risk:** низкий.

### BUG-A05 — Phone fragment `NN-NN-NN` / `NNN-NNN-NN-NN` как артикул [P0, 9]
- **Symptom:** [79c41967] `9510451992` (pure 10-digit), [93e4ec84] `915-506-04-96` (phone-pattern).
- **Root cause:** `915-506-04-96` — 3-3-2-2 digits = классический РФ phone. Не отфильтровывается явно.
- **Expected:** reject `^\d{3}-\d{3}-\d{2}-\d{2}$` и `^\d{3}-\d{2}-\d{2}-\d{3}$` (phone fragments); reject pure 10-digit без strong-label как article.
- **Proposed fix:** `article-filters.js::isPhoneFragment`; `isObviousArticleNoise` — reject 10 digits pure w/o strong label.
- **Risk:** Некоторые артикулы могут быть 10-цифровыми. Для 79c41967 есть `Арт.: 9510451992` — строгий label → разрешить. Для остальных случаев — reject.

### BUG-A06 — Duplicate articles (spacing/hyphen variants) [P0, 9]
- **Symptom:** [00fa1add] `MD-025-6L` и `MD 025-6L` оба присутствуют; [573a27cf] `ADC75` и др.
- **Root cause:** `unique() = [...new Set()]` — case-sensitive string equality; `dedupKey` в article-normalizer нормализует case, но сохраняет `-` vs ` ` как разные.
- **Expected:** `MD-025-6L` ≡ `MD 025-6L` после dedup.
- **Proposed fix:** `article-normalizer.js::dedupKey` — `[\s\-]+` → `` (collapse both).
- **Risk:** нулевой; разные написания одного SKU — это и есть причина дедупа.

---

## P0-B. Product Names — FP / contamination

### BUG-B01 — CSS tokens в productNamesClean [P0, 2 msgs / 7+ instances]
- **Symptom:** [9cb21c0a] `font-family:'times new roman'`, `font-size:medium`, `color:#000000`, `<span style="background-color:#000000` — попали в productNamesClean.
- **Root cause:** `stripHtmlResidue` в normalizer матчит только полные теги `<tag>`. Незакрытые теги `<span style="...` не обрабатываются. CSS-declarations без тегов (`color:#fff`) тоже проходят.
- **Expected:** strip полностью.
- **Proposed fix:** `product-name-normalizer.js` — добавить `stripCssTokens` (remove `(?:font-family|font-size|font-weight|font-style|color|background-color|text-decoration-color|text-decoration-style|text-indent|text-transform|white-space|word-spacing|margin|padding|border|width|height|display|float|position|left|right|top|bottom)\s*:\s*[^;"'\n]+`); также strip неполные теги `<\/?[a-z][^>\n]*` (без закрывающего `>`).
- **Risk:** нулевой — CSS никогда не в названии товара.

### BUG-B02 — URL/email в названии товара [P0, 13 msgs / 16 instances]
- **Symptom:** [6672b50f] `SEEPEX ( https://siderus.ru/brands/seepex/ )`; [936b9c11] `www.huntsman-nmg.com`; [170b2c45] `<https://tender.lot-online.ru/...>`
- **Root cause:** normalizer не режет URL/email-хвост.
- **Expected:** strip URL и email из title.
- **Proposed fix:** `product-name-normalizer.js::stripUrlTail` + `stripEmailTail`.
- **Risk:** нулевой.

### BUG-B03 — Quoted-thread marker `>>:` в начале title [P0, 2 msgs]
- **Symptom:** [72bde21d] `>>: ГПС Запрос Rolls-Royce Marine AS - 2026 (заявка № 2)` — весь subject начинается с `>>:` (quote-marker из ответа).
- **Root cause:** subject как product-name источник не чистится от quote-markers.
- **Expected:** strip leading `^\s*>+[:\s]*` / `^\s*-{3,}.*Original Message.*$`.
- **Proposed fix:** `product-name-normalizer.js::stripQuoteMarker`.
- **Risk:** нулевой.

---

## Приоритизация фиксов

| # | Bug | Files | LoC estimate | Tests |
|---|-----|-------|--------------|-------|
| 1 | A01 — 12-digit INN | article-filters + email-analyzer | ~15 | 3 |
| 2 | A02 — HTML struct | article-filters + email-analyzer | ~10 | 3 |
| 3 | A03 — size triple | article-filters + email-analyzer | ~10 | 3 |
| 4 | A04 — hours/time | email-analyzer | ~6 | 2 |
| 5 | A05 — phone fragment | article-filters + email-analyzer | ~12 | 4 |
| 6 | A06 — dedup hyphen/space | article-normalizer | ~3 | 2 |
| 7 | B01 — CSS strip | product-name-normalizer + filters | ~20 | 3 |
| 8 | B02 — URL strip | product-name-normalizer | ~12 | 3 |
| 9 | B03 — quote marker | product-name-normalizer | ~5 | 2 |

Total: ~95 LoC, ~25 tests.
