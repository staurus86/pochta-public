# Phase 01 — Article Extraction Refactor (Summary)

**Status:** ✅ Shipped · **Date:** 2026-04-19 · **Deadline:** 2026-04-21

## Goal

Закрыть 8 категорий дефектов TZ в article extraction:
WordSection/XMP/FS/IROW metadata, filenames, tech-specs (IP54/304L/50Hz/10Bar/M12),
section numbering (1.3.1), descriptor/slug/brand leak, OCR noise, valid SKU
preservation (DNC-80-PPV-A, WR-2510GLW, 3610.5533, QIT3-5033, PEV-W-KL-LED-GH,
8579/12-506, R 480316021).

## Delivered

Новый модульный pipeline (4 файла, полностью TDD):

| Файл | Назначение |
|------|-----------|
| `src/services/email-zoning.js` | Split body → subject/current/signature/quoted/attachment с priority map |
| `src/services/article-filters.js` | 8 hard-negative predicates + `rejectArticleCandidate` |
| `src/services/article-normalizer.js` | `normalizeArticleCode`, `trimTechSpecTail`, `stripDescriptorTail`, `stripBrandPrefix`, `preprocessForExtraction`, `dedupeCaseInsensitive` |
| `src/services/article-extractor.js` | Facade: zoning → candidate generation → scoring → filter → normalize → dedup |

Интеграция в `email-analyzer.js` — структурный пост-фильтр (HtmlWordMeta +
Filename + Datetime) применяется к `allArticles` после существующего pipeline.
Тех-спеки/OCR-шум/slug намеренно пропущены в пост-фильтре, так как existing
pipeline уже их корректно обрабатывает и добавление этих фильтров приводит
к false-negative на легитимных mixed-case SKU (`RBE 03.6904`, `mLT220/151`,
`509-1720`).

## Tests

- `tests/article-extractor.test.js` — **29/29 green** (фильтры, нормалайзер, зоны, facade)
- Полный suite: **141 PASS / 3 FAIL** (все 3 failing — pre-existing: docx/xlsx attachment parsers, brand-alias R. Stahl detection — не связано с этим phase)

## Key design decisions

1. **`\b` не работает с кириллицей** → все смешанные regex на `(?<![A-Za-zА-ЯЁ0-9])` lookbehind вместо word-boundary.
2. **`арт` vs `артикул` порядок** — `артикул(?:...)?` первым с `арт(?=[\s.:#№]|$)` lookahead, иначе backtrack захватывает «Арт» + капчу «икул» как якобы артикул.
3. **LABEL_ALNUM leading single-letter** — `{0,40}` (не `{1,40}`), чтобы `R` в «Aventics арт. R 480316021» ловился как leading token.
4. **SKU_MULTIBLOCK post-trim** — `trimTechSpecTail` снимает хвосты `10 Bar`/`63A`/`5P`/`IP66` итерационно до 5 раз.
5. **OCR-noise typeTrans** — case-transitions (upper↔lower) недостаточно для `q.yna8jiy`; добавлен digit↔letter transition counter.
6. **`LATIN_RU_MIX_SLUG_RE` без `/i`** — реальные slug в lowercase; uppercase kebab-коды (`PEV-W-KL-LED-GH`) не должны матчиться как descriptor.
7. **Post-filter conservative** — три structural predicate в `email-analyzer.js`, а не полный `rejectArticleCandidate`, чтобы не сломать существующие SKU.

## Railway deploy

Файлы синхронизированы в `.railway-deploy/src/services/` (diff пуст):
`email-zoning.js`, `article-filters.js`, `article-normalizer.js`,
`article-extractor.js`, `email-analyzer.js`.

## Out of scope (следующие фазы)

- Интеграция нового `extractArticles(email)` facade как основной pipeline
  (сейчас используется лишь filter API). Требует adaptation слоя вокруг 6k+ строк legacy.
- Pre-existing docx/xlsx/brand-alias failures.
