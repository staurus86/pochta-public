# Phase 01 — PLAN.md

**Goal (from CONTEXT):** закрыть 8 классов дефектов Артикулы + сохранить 5 валидных паттернов (A–E). Критерий успеха — regression-тесты по TZ cases + прогон аудит-скрипта по production корпусу без регрессий по бренд-детекту.

**Strategy:** NOT a rewrite. Existing `email-analyzer.js` уже содержит ≈7 слоёв правил (`ARTICLE_POSITIVE_PATTERNS`, `ARTICLE_NEGATIVE_PATTERNS`, `ARTICLE_CONTEXT_*`, `isObviousArticleNoise`, `isLikelyArticle`, `normalizeArticleCode`, scattered injection points в `postprocessLead`). Подход: **вынести правила в 4 модуля + добавить недостающее + TDD-coverage для TZ cases, потом подключить через `extractLead`**.

---

## Current Pipeline Map (touch points)

| File | Function / Const | Lines | Role |
|------|------------------|-------|------|
| `src/services/email-analyzer.js` | `ARTICLE_PATTERN` | 44 | label-based extract (`арт/sku → token`) |
| | `NUMERIC_ARTICLE_PATTERN` | 47 | numeric fallback `\d{2,6}[-/.]\d{2,6}…` |
| | `ARTICLE_POSITIVE_PATTERNS` | 512 | accept-form regex set |
| | `ARTICLE_NEGATIVE_PATTERNS` | 520 | reject-form regex set |
| | `ARTICLE_CONTEXT_POSITIVE_PATTERNS` | 542 | +score for label context |
| | `ARTICLE_CONTEXT_NEGATIVE_PATTERNS` | 547 | −score for spec context |
| | `STRONG_ARTICLE_CONTEXT_PATTERN` | 552 | hard +score trigger |
| | `ARTICLE_SCORE_THRESHOLDS` | 556 | `{acceptConfident:5, acceptProbable:3}` |
| | `OFFICE_XML_ARTICLE_NOISE_PATTERNS` | 462 | office/docx meta reject |
| | `PDF_INTERNAL_TEXT_NOISE_PATTERNS` | 487 | pdf internals reject |
| | `sanitizeAttachmentText()` | 1538 | pre-extract cleanup |
| | `extractLead()` | 2206 | main entry (subject/body/attachments → lead) |
| | `normalizeArticleCode()` | 5100 | trim/strip junk/translit |
| | `isLikelyArticle()` | 5140 | pattern + spec-context gates |
| | `isObviousArticleNoise()` | 5316 | final reject pass |
| | scattered filter passes | 875–1100, 1240–1390 | postprocess injection |

**Problems (from TZ + sample emails):**
1. Refrigerant codes `R407C`, `R404A` проходят в articles (HHR) — нет refrigerant reject pattern.
2. `WR-`, `MWR-` теряют тире-пробел при normalize (Belgormash) — агрессивный trim в `normalizeArticleCode`.
3. Raw `1. X - N шт.` попадает в productNames (three samples) — product-name дубликаты cleaned↔raw.
4. UUID/hash tokens (Laserzz #69/#328) — OCR noise filter неполный.
5. `Вас сообщить…`, descriptor phrases в productNames — descriptor tail не обрезается.
6. `FESTO:` prefix в productName — brand leak.
7. Inflated positions/qty (Belgormash: 18 / 7 → expected 2 / 5) — нет unique-article counting.

---

## Target module layout

```
src/services/
├── email-zoning.js       # NEW — zone split (subject/current/sig/quoted/attachment/html_noise)
├── article-filters.js    # NEW — hard negative filters (TZ §5.1–5.7)
├── article-normalizer.js # NEW — normalize + prefix preserve + dedupe + descriptor strip
├── article-extractor.js  # NEW — facade: zoning → candidates → scoring → filters → normalize
└── email-analyzer.js     # CHANGED — wires new modules via extractLead
```

**Sync:** каждый новый/изменённый файл копируется в `.railway-deploy/src/services/` перед коммитом.

---

## Task flow (TDD-ordered)

### T1. `tests/article-extractor.test.js` — red phase ✓ TZ-driven
Regression suite для TZ:
- **Positive (A–E):** `Артикул: 152618`, `Артикул 34095 34098`, `Арт 3610.5533`, `DNC-80-PPV-A`, `QIT3-5033`, `G392-012-000-002`, `TA-050CLEM14-A-ZVG/US`, `CLS15E-B1A3A`, `TG 40-55/22-285`, `AT 051 DA F04 N 11 DS`, `R 480316021`, `PEV-W-KL-LED-GH` + `152618` coexist.
- **Negative (§1–5):** `page:WordSection1`, `XMP.IID:...`, `FS20`, `IROW0`, `1342447151.jpg`, `11.34.27.jpeg`, `13:24:37`, `IP54`, `IP65`, `RS485`, `304L`, `316L`, `50Hz`, `10 Bar`, `M12`, `1.3.1 / 1.3.2 / 1.3.3`, `DESC:koltsa-…`, `aeb2.Ew50`, `Rloe5....1Muo5F`, `2026`, `04-2026`.
- **Mixed:** `R. STAHL 8579/12-506 63A 5P IP66 Ex e` → `8579/12-506`; `Aventics арт. R 480316021 10 Bar` → `R 480316021`.
- **Sample emails (from user):** HHR `R407C/R404A/WR-2510GLW/MWR-5020FLWH` → только 2 article, `R407C/R404A` reject; Belgormash positions=2, qty=5.

### T2. `src/services/article-filters.js`
Pure functions (no state, no I/O). Каждая возвращает `{rejected: boolean, reason: string}` для audit.

```
isHtmlWordMetadata(token)       // page:WordSection*, XMP.IID, FS\d+, IROW\d+, cid:, mailto:, http, www, @
isFilenameLike(token)           // *.jpg/jpeg/png/pdf/doc/docx/xls/xlsx
isDateTime(token)               // HH:MM:SS, DD.MM.YYYY, year 19xx/20xx, month-year
isTechSpec(token)               // IP\d{2,3}, RS\d{3}, \d{3}L, \d+Hz, \d+\s*Bar, M\d+, ranges 0-600, 4-1/2
isRefrigerantCode(token)        // R\d{3}[A-Z]? (R22, R134A, R404A, R407C, R410A) — NEW vs existing code
isSectionNumbering(token, ctx)  // 1.3.1 с контекстом section count ≥3
isDescriptorSlug(token)         // DESC:, slug `a-b-c-d`, kebab-case-ru latin mix
isOCRNoise(token)               // mixed case random, 4–12 char alnum noise
isFormatLikeArticle(token)      // meta-guard: всё выше false + есть digit → keep
```

### T3. `src/services/article-normalizer.js`
```
normalizeArticleCode(value)          // preserve prefix `WR-`, `MWR-`, `R-` после space-dash
normalizeProductName(rawLine)        // strip `1. ` prefix, strip `- N шт.` tail, strip leading `BRAND:`
dedupeCaseInsensitive(list)          // cleaned↔raw dedup (case + punct-normalized key)
stripDescriptorTail(token, sourceLine) // cut `Betriebsdaten:…`, `Vas soobschit…`
stripBrandPrefix(token, brands)      // `FESTO:DNC-...` → `DNC-...`
```

### T4. `src/services/email-zoning.js`
```
splitZones(email) => {
  subject,
  currentMessage,   // до первого `From:/---Original Message---/>` маркера
  signature,        // эвристика: после `С уважением/BR/Regards` или `--`
  quotedThread,     // всё в quoted/forwarded блоках
  attachmentText,   // уже есть в attachments.articleText, просто forward
  htmlNoise         // alt-chain, style blocks, xml residue
}
```
Priority for extraction: `subject > currentMessage > attachmentText > signature > quotedThread`.

### T5. `src/services/article-extractor.js` (facade)
```
extractArticles(email, brands) => {
  articles: [...],          // unique, normalized, ordered by zone priority
  rawCandidates: [...],     // debug
  rejectedCandidates: [...] // {value, reason, zone}
}
```

Internal flow:
1. `zones = splitZones(email)`
2. For each zone (в priority order):
   - `candidates += generateCandidates(zone, labelRe, sku-like re, table-row re)`
3. `scored = candidates.map(c => ({...c, score: scoreArticle(c, zones)}))`
4. `filtered = scored.filter(c => !applyAllFilters(c.token, c.zone))`
5. `accepted = filtered.filter(c => c.score >= thresholds[zone])`
6. `normalized = dedupeCaseInsensitive(accepted.map(normalizeArticleCode))`
7. **Safety guard:** if `candidates.length > 12 && rejectedRatio > 0.3` → strict mode (raise thresholds, downgrade confidence, mark review).

### T6. `email-analyzer.js` integration
Minimal invasive:
- Import `{extractArticles}`.
- В `extractLead` после текущих fallback passes (L875–1100) — **сравнить** результат нового extractor с существующим, накатывать через feature-flag `USE_NEW_EXTRACTOR=1` для shadow-mode.
- После regression-подтверждения — заменить старые scattered passes на единый вызов.

### T7. `tests/article-integration.test.js`
End-to-end: полный `analyzeEmail(project, payload)` на трёх письмах-образцах (HHR/БВС/Belgormash). Assert `articles`, `positions`, `totalQty`, `productNames`.

### T8. Test run + sync
- `npm test` (141 baseline + новые ≥30 TZ cases).
- `cp src/services/{article-*.js,email-zoning.js} .railway-deploy/src/services/`.
- `cp src/services/email-analyzer.js .railway-deploy/src/services/`.

### T9. Report
`.planning/phases/01-articles/SUMMARY.md` с: изменённые файлы, реализовано, закрытые кейсы, спорные зоны, test results.

---

## Non-goals (Phase 1)
- LLM-based extraction — не трогаем reanalyze cache path.
- OCR — out of scope (см. PROJECT.md).
- Brand detection — Phase 2.
- Product names quality — Phase 3 (но `stripBrandPrefix` + `cleaned↔raw dedupe` попадают в Phase 1 из-за влияния на articles).

## Risks
- **Regressions на production corpus** — пропускаем через `scripts/audit_prod_json.py` (attachment-aware) на 1666 Client emails до push.
- **Breaking API** — `extractLead` signature не меняем, только internal wiring.
- **Time** — 48h deadline; если не успеваем T6 integration, оставляем shadow-mode с flag-off по default.

## Acceptance Criteria (goal-backward)
1. Все 27+ TZ regression кейсов проходят в `tests/article-extractor.test.js`.
2. Три sample письма (HHR/БВС/Belgormash) дают expected articles/positions/qty в `tests/article-integration.test.js`.
3. `npm test` total: ≥141 prior PASS + ≥27 new PASS, 0 new fails.
4. `scripts/audit_prod_json.py` accuracy на 1666 Client не падает.
5. `src/` ↔ `.railway-deploy/src/` синхронизированы (mtime + size diff = 0).
