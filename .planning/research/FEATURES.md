# Feature Research

**Domain:** Rule-based entity extraction — Russian B2B industrial supply email parser
**Researched:** 2026-05-25
**Confidence:** HIGH (analysis based on production codebase + live audit data from 100-email sample)

---

## Scope

Seven complaint areas from client (Siderus) against live production data (2497 emails, 100-email sample audit 20.05.2026):

| Field | Current rate | Target |
|-------|-------------|--------|
| ФИО | 99% present | Correct when present |
| ИНН | 18% present | Higher recall, 0 wrong values |
| Артикулы | 43% present | Higher precision (no phones/INN/noise) |
| Бренды | 58% detection | Higher recall |
| Названия товаров | present | Clean, no dupes, no HTML residue |
| Количество | present | Per-article count, no dimension leakage |
| Дедупликация | partial | 0 double-counted positions |

---

## Feature Landscape by Area

### 1. ФИО Extraction

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Name extraction from email signature block | Signatures are in ~90% of B2B emails | LOW | Already built; extractor exists |
| Rejection of company names stored as ФИО | Client sees "ООО Ромашка" in the name field | LOW | Filter exists but contamination slips through |
| Rejection of role-only strings as ФИО | "Менеджер отдела продаж" is not a name | LOW | Filter exists but role-prefix stripping can produce empty |
| Form field ФИО extraction (robot@/tilda@) | Structured forms have explicit ФИО field | LOW | Already built |
| Template name contamination guard | "Екатерина Попова" (SIDERUS form template) appears as client ФИО for 3+ different companies | MEDIUM | New: detect when same name appears as sender-side template |
| Single-word name accepted when no 2+ word candidate | "Максим" is still more useful than null | LOW | Already built but confidence is low (0.3); acceptable |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Cross-batch contamination detector | Flags when identical name appears for N distinct INNs — sign of template pollution | MEDIUM | Useful for audit script, not extractor itself |
| Initials expansion ("Жарихин Н.В.") kept as-is | Initials are valid — expanding them is error-prone | LOW | Normalizer should preserve, not expand |
| Latin-Cyrillic name split ("Ivan Ivanov / Иван Иванов") | bilingual signatures are common in Russian B2B | LOW | Already built via splitBilingualName |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| NLP person-name classifier | "Would catch all names" | Requires external model; LLM disabled; adds weight | Rule-based cascade with signature zone priority is sufficient for 99% rate |
| Guessing ФИО from email prefix when no other source exists (single word like "ivanov") | Provides some value | Single-word email-local is an alias 80%+ of the time; produces wrong names | Only accept multi-part email-local (ivan.petrov → Ivan Petrov); already implemented |

---

### 2. ИНН Extraction

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Extract labeled ИНН ("ИНН: 7701011234") from signature and body | ИНН is the primary company identifier in Russian B2B | LOW | Pattern exists (`INN_PATTERN`) but regex only matches labeled occurrences |
| Reject ИНН as article (12-digit and 10-digit without strict "Арт.:" label) | 10-12 digit numbers are ИНН shape — they contaminate article lists | LOW | Already built in article-filters.js |
| Format normalization: remove spaces ("770 101 1234" → "7701011234") | Clients write INN with spaces | LOW | Partial in INN_PATTERN but not consistently applied |
| Reject ИНН values that don't pass length check (10 or 12 digits only) | Raw regex may capture partial runs | LOW | Post-filter needed |
| Extract from form fields (robot@/tilda@ structured body) | Forms have explicit ИНН field | LOW | Form parser exists but coverage gaps |
| Extract from attachment text (company card / реквизиты DOC) | Most B2B emails attach a company card with ИНН | MEDIUM | Attachment parser exists; needs ИНН pass-through to sender fields |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Checksum validation (mod-11 algorithm) | Catches transposition errors and OCR misreads | LOW | Pure math, no external deps; eliminates impossible values immediately |
| OGRN/KPP co-extraction alongside ИНН | Client may want legal entity completeness | MEDIUM | Patterns exist (OGRN_PATTERN, KPP_PATTERN) but not surfaced to lead output |
| Prefer ИНН from signature over ИНН from body (body may contain partner ИНН) | Avoids extracting the supplier's own ИНН | MEDIUM | Zone-aware extraction for ИНН (same as articles use zones) |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Extract any 10-digit number near a company name as ИНН | Increases recall | Phone numbers are 10+ digits too; creates false positives | Require explicit "ИНН" label or form-field key; checksum as secondary gate |

---

### 3. Article Extraction Precision

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Reject 10-digit numbers as articles unless preceded by strict "Арт.:" label | ИНН-shape numbers are not SKUs | LOW | Built; regression-tested in p0-cycle3.test.js |
| Reject phone number patterns as articles (3-3-2-2, 8-800-xxx-xx-xx) | Phones appear in signatures and headers | LOW | isPhoneFragment exists; gaps for full Russian mobile patterns |
| Reject refrigerant codes (R407C, R404A) unless in labeled "Арт.:" context | Refrigerants look like article codes but are product types | LOW | isRefrigerantCode exists |
| Reject HTML structural tokens (row-1, column-3, WORDSECTION1) | HTML-to-text conversion leaks structural IDs | LOW | Built via isHtmlStructureToken + isHtmlWordMetadata |
| Reject date/time tokens (09.11.2023, 14:30, 00-18.00) | Dates use same separator patterns as SKUs | LOW | isDateTime + isHoursRange exist; gap for 2-segment time ranges |
| Reject pure-numeric without explicit article label | Pure numbers are quantities, INN, dates — not SKUs | LOW | Built; "Арт.:" label required |
| Reject dimension tokens (80x55x40, DN65) as articles | Dimension specs are parsed as SKU candidates | LOW | isSizeTriple exists; gaps for DN/Ду format with letters |
| Reject UUID / hash tokens (8 or more hex chars with no structure) | UUIDs appear in form metadata and email headers | LOW | isOCRNoise partially catches this; UUID-specific pattern needed |
| Preserve WR-/MWR- prefixed codes after tilde-space normalization | "WR- 2510" should become "WR-2510" | LOW | preprocessForExtraction exists |
| Strip brand prefix from article ("FESTO:DNC-80-PPV-A" → "DNC-80-PPV-A") | Brand-prefixed articles arrive from templates | LOW | stripBrandPrefix exists |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Article-quantity boundary split ("9226513-4 шт" → article=9226513, qty=4) | Common pattern in industrial price lists | MEDIUM | splitArticleBoundary exists but matching coverage is partial |
| Cyrillic-in-article detection (АИР100S4, 08Х18Н10Т steel grades) | Russian-specific industrial codes use Cyrillic | MEDIUM | CYRILLIC_MIXED_CODE_PATTERN in email-analyzer.js but not wired into article-extractor.js filters |
| Multi-word article extraction ("R STAHL 8579/12-506") | Multi-block vendor codes common in ATEX/Ex equipment | MEDIUM | SKU_MULTIBLOCK_RE + trimTechSpecTail; accuracy depends on zone context |
| Strict-mode auto-trigger (>12 candidates + >30% noise ratio) | Prevents spam-email flooding article list | LOW | Already built; threshold tuning may be needed |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Extract all alphanumeric tokens from body as potential articles | Maximizes recall | Floods article list with brand names, cities, company abbreviations, HTML noise | Zone-priority scoring + label-proximity + dedup is the right approach |
| Accept any 4+ character uppercase sequence as article | Seems conservative | Catches city abbreviations (СПЕЦ, ПРОФ), brand acronyms (АВВ, ЕМА), Russian words in CAPS | Require structural pattern (separator or label) for unlabeled candidates |

---

### 4. Brand Detection

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| KB-based brand matching with 15k+ aliases | Client has pre-loaded all their supplier brands | LOW | Exists; 58% detection rate indicates recall gaps |
| Reject material-type tokens as brands (NBR, EPDM, PTFE) | Materials look like brand codes but are not | LOW | NEGATIVE_MATERIALS set exists |
| Reject ISO/DIN/GOST standard codes as brands | Standard codes appear near part numbers and brand names | LOW | NEGATIVE_STANDARDS set exists |
| Reject unit abbreviations as brands (VAC, Hz, kW) | Units appear in technical specs adjacent to brand names | LOW | NEGATIVE_UNITS set exists |
| Strip signature capability-list brands ("Бренды, по которым мы работаем: ...") | SIDERUS signature lists 50+ brands they sell — these are not what the client is asking for | LOW | stripBrandCapabilityListText exists (commit 5ea1dfa) |
| Strip image alt-text brand chains ("[Brand][Brand][Brand]") | HTML emails contain image alt-text chains that parse as 20+ brands | LOW | IMAGE_ALT_CHAIN_PATTERN exists (commit 70e4722) |
| Post-hoc signature-cluster filter | Comma-separated brand list in signature footer (Electrovent, АИСС style) | LOW | signatureCluster filter exists (commit 29f5456) |
| Mass-brand guard (13+ brands = catalog dump, discard) | Single email requesting 20+ brands is not a real order | LOW | classifyBrandContext exists with MASS_BRAND_CATALOG=13 |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Sender-profile brand inference (if sender domain matches known supplier) | Some emails mention no brand but come from known supplier reps | MEDIUM | Sender profiles exist in KB; coverage unknown |
| Subject-line brand extraction boost | Subject often states the brand: "Запрос на Grundfos" | LOW | Subject is a zone in email-zoning.js; brand extraction should prioritize subject hits |
| Brand recall from product name context ("Запрос на насосное оборудование Grundfos 40-50") | Brand embedded in product description without explicit brand label | MEDIUM | Requires sliding-window alias scan over product-name zone |
| Aliases for common misspellings (Siemens/Сименс, Grundfos/Грундфос) | Russian industrial clients write brand names in Cyrillic | LOW | KB already stores Cyrillic aliases but alias coverage may have gaps |
| Brand synonym canonicalization (Буркерт/Bürkert/Buerkert → Burkert) | Multiple transliteration variants of same brand | LOW | splitAliasBundle + canonicalizeBrand exists; coverage depends on KB data quality |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Extract any uppercase word cluster as a brand | Maximizes recall | Catches company names, Russian acronyms, city names, document titles | KB-anchored matching only; body-grounding for non-KB candidates |
| Semantic token matching (single-word brand fragments) | Catches partial mentions | Single tokens like "Датчик", "Клапан", "Привод" match dozens of brands; already proven catastrophic (reverted commit) | Require ≥2 non-stopword token overlap for semantic match |

---

### 5. Product Name Quality

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Strip raw list-item prefixes ("1. X - 10 шт." → "X") | LLM and template parsers emit numbered list strings | LOW | normalizeProductName handles this but multi-level stripping risks date corruption |
| Strip HTML residue (tags, entities, CSS declarations, Word metadata) | HTML-to-text conversion leaves artifacts | LOW | Filters exist; CSS_DECL_BARE_RE, HTML_TAG_RE, WORD_META_RE in product-name-filters.js |
| Strip trailing quantity ("Клапан Norgren - 3 шт" → "Клапан Norgren") | Quantity is a separate field | LOW | buildBaseCanon strips trailing qty for dedup key |
| Reject phone numbers stored as product names | Phone-like strings arrive from signature zone leakage | LOW | isPhoneLike in product-name-filters.js |
| Reject role/greeting strings ("С уважением, Иванов") | Signature greeter lines bleed into product names | LOW | REGARDS_RE + NAME_TITLE_RE in product-name-filters.js |
| Case-insensitive dedup with homoglyph folding | Same product appears as "Клапан" and "клапан" or "ОТ400U03" (Cyr) vs "OT400U03" (Lat) | LOW | dedupByCanonical + homoglyphFold exists |
| Product names with different article suffixes kept distinct | "Фильтры SERFILCO SF10u20" ≠ "Фильтры SERFILCO SF20u20" | MEDIUM | tryStripArticle with base-set guard exists |
| Subject-line fallback when no body names survive | Email subject often is the best product description | LOW | subjectAsFallback exists |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Brand name in product name stripped to separate brand field ("FESTO: Клапан DNC-80" → name="Клапан DNC-80", brand="FESTO") | Reduces redundancy between productNames and brands | MEDIUM | Not currently implemented; requires coordination between name and brand extractors |
| Max-length cap with intelligent truncation at phrase boundary | 200-char cap truncates mid-word; truncate at last space/comma | LOW | normalizeProductName has maxLen but truncates at char boundary |
| Multi-item list splitting ("Насосы; Клапаны; Фильтры") | Single string containing 3+ product names | LOW | splitMultiItem + isMultiItemList exists |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Normalize Russian product-type nouns to canonical form ("насос" → "Насос") | Consistent capitalization | Lemmatization needs a full morphological library; LLM disabled | Title-case first letter only; accept variation |
| Extract product names from attachment text via OCR | Attachments often contain full product specs | OCR is out of scope | Use text-layer attachments only (PDF with embedded text) |

---

### 6. Quantity Accuracy

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Reject dimension measurements as quantity (90 мм, DN 65, 1.5 kW) | Technical specs use same "number + unit" format as counts | LOW | isDimensionLike/isPowerLike/isVoltageLike exist in quantity-filters.js |
| Reject phone numbers as quantity | Phone-like strings match inline quantity regex | LOW | isPhoneLike in quantity-filters.js |
| Article-boundary quantity split ("9226513-4 шт" → article, qty=4) | Common in Russian industrial catalog line items | MEDIUM | splitArticleBoundary exists but regex coverage is partial |
| Pack structure parsing ("3 компл. по 4 шт" → total=12) | Pack-of-N is a common purchasing unit | MEDIUM | parsePackStructure exists |
| Per-article quantity association (not just "total quantity for email") | Client needs quantity per SKU, not aggregate | HIGH | lineItems structure exists but positions/totalQty calculation has known bug (Belgormash: 2 позиции / 5 шт reported as 18/7) |
| totalQty = sum of per-article quantities, deduplicated | positions = count of unique articles; totalQty = their sum | MEDIUM | REQ-K-COUNT-01 in PROJECT.md; not yet fixed |
| Outlier rejection (qty > 100,000 without context) | Captures numbers like year (2023) or large INN segment | LOW | value > 100000 check exists; threshold may need tuning |
| Unit normalization ("штук" / "шт" / "ед" → "шт") | Multiple unit spellings in Russian | LOW | normalizeQtyUnit exists |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Locale-aware thousand separator ("1,000 шт" = 1000, not 1) | EN-locale formatting appears in copy-pasted price lists | LOW | parseLocaleNumeric with ambiguous flag exists |
| Labeled quantity priority ("в кол-ве 5 шт" beats unlabeled "5 шт") | Labeled quantities are more reliable | LOW | Source priority: pack > article_boundary > labeled > inline > locale already built |
| Quantity in parentheses extraction ("Клапан (2 шт)") | Russian purchasing emails use parenthetical quantities | LOW | INLINE_QTY_RE handles this if parenthesis context is parsed |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Sum ALL numeric tokens in email as total quantity | Simple aggregation | Numbers in email are addresses, INN, article numbers, dates, phone numbers — summing them is meaningless | Per-article association with explicit unit confirmation only |

---

### 7. Deduplication

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Article-level case-insensitive dedup ("DNC-80-PPV-A" == "dnc-80-ppv-a") | Same article written in different cases by different clients | LOW | dedupeCaseInsensitive exists in article-normalizer.js |
| Cyrillic-Latin homoglyph dedup in articles ("IРFD9024" cyr-I vs "IRFD9024" lat-I) | OCR and manual entry mix Cyrillic/Latin look-alikes | LOW | preprocessForExtraction + homoglyphFold exist |
| Product name canonical dedup with article-stripped variant collapsing | "Клапан Norgren" and "2. Клапан Norgren V04A486l-Q116A" should collapse | MEDIUM | dedupByCanonical with tryStripArticle built; needs edge-case coverage |
| Quantity per unique article, not per occurrence | If the same article appears 3 times with qty=2 each, the result is qty=2 (not 6) unless the email explicitly lists 3 separate positions | MEDIUM | Known bug: Belgormash case. Fix: group by normalized article, take max or labeled qty |
| Brand dedup after canonicalization (Bürkert/Buerkert → single entry) | Alias resolution must happen before dedup | LOW | canonicalizeBrand + dedupCanonical in brand-normalizer.js |
| Product name dedup across LLM-extracted and rule-extracted names | Both paths produce names; merge without duplicating | LOW | LLM is disabled; but when re-enabled, mergeLlmExtraction handles this |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Fuzzy article dedup for near-identical codes ("DNC80PPVA" vs "DNC-80-PPV-A") | Copy-paste from different catalog formats | MEDIUM | Normalization strips separators; then exact match — covers most cases |
| Line-item level dedup (same product name + same article = one row, not two) | LLM and rule extractor may emit the same item twice | MEDIUM | Dedup on (normalizedArticle, normalizedName) composite key |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Semantic dedup ("насос центробежный" == "центробежный насос") | Reduces apparent duplicates | Word-order normalization needs morphological parsing; risks collapsing different products | Only dedup exact or homoglyph-equivalent strings |

---

## Feature Dependencies

```
[Quantity per article]
    └──requires──> [Article extraction precision]
                       └──requires──> [Article-level dedup]

[Brand recall improvement]
    └──enhances──> [Product name quality]
                   (brand names stripped from product names → cleaner names)

[ИНН extraction recall]
    └──requires──> [Article precision — reject INN-shape numbers as articles]
                   (both fields compete for 10-digit numbers)

[ИНН checksum validation]
    └──enhances──> [ИНН extraction recall]
                   (checksum lets you accept unlabeled 10-digit without label
                   when checksum is valid, currently blocked)

[Template contamination guard for ФИО]
    └──requires──> [Known template sender pattern detection]
                   (robot@siderus.ru body-template ФИО names must be on a blocklist)

[Deduplication]
    └──requires──> [Normalization] for all fields
    └──requires──> [Article extraction] before quantity-per-article can work
```

### Dependency Notes

- **Quantity per article requires article precision:** You cannot associate quantities with articles if the article list contains phones, INN, and noise — the association will be wrong. Fix article precision first.
- **ИНН extraction and article extraction share the same 10-digit number space:** These must be fixed together. The article filter already rejects INN-shape numbers; ИНН extraction must pick them up on the other side.
- **Brand recall and product name quality are coupled:** If brand names are being left in product name strings, fixing brand recall also cleans product names. Order: fix brand extraction, then re-audit product names.
- **Template ФИО contamination:** Requires a sender-context guard — names from robot@siderus.ru body templates must be identified as SIDERUS-side data and blocked from being stored as client ФИО.

---

## MVP Definition (for this milestone)

### Launch With (v1.1 — Detection Quality Sprint)

Minimum to close client complaints:

- [ ] **Article precision: reject all phone-format patterns as articles** — specific: 3-3-2-2, 8-800-xxx, +7 patterns not already caught by isPhoneFragment; testable: known production samples with leaked phones
- [ ] **Article precision: reject UUID/hash (8+ lowercase hex without dashes, or UUID format) as articles** — testable: UUID from form metadata must not appear in articles list
- [ ] **Quantity per article: fix positions/totalQty calculation** — specific: positions = unique article count, totalQty = sum of unique-article quantities; testable: Belgormash case (2 positions, 5 шт, not 18/7)
- [ ] **ИНН recall: extract from attachment "реквизиты" text and pass through to sender.inn** — currently attachment text is parsed for articles/brands but ИНН is not propagated to sender fields
- [ ] **ФИО template contamination: blocklist known SIDERUS-form sender names ("Екатерина Попова", "Александр Корнев") when source is body and fromEmail is robot@siderus.ru** — testable: 3 confirmed affected messages
- [ ] **Product names: strip "1. X - N шт." raw format completely** — the raw list-item format should never survive into productNames; testable: check for presence of "шт." + digits in productNames
- [ ] **Brand detection: add subject-line priority boost** — brands mentioned in subject ("Запрос на Grundfos") must appear in detectedBrands even if not in body; testable: subject-only brand emails

### Add After Validation (v1.1.x)

- [ ] **ИНН checksum validation** — accepts unlabeled 10-digit INN when mod-11 checksum is valid, increases recall without false positives; trigger: ИНН recall still below 30% after v1.1
- [ ] **Quantity in parentheses extraction** — "Клапан (2 шт)" pattern; trigger: audit shows >5% quantities missed from parenthetical format
- [ ] **Brand recall: sliding-window alias scan over product description zone** — catches brand embedded in "запрос на оборудование Grundfos серии CM"; trigger: brand detection still below 65% after v1.1
- [ ] **OGRN/KPP co-extraction** — surface to lead output; trigger: client requests these fields in Directus schema

### Future Consideration (v2+)

- [ ] **Cyrillic article codes (АИР100S4) fully wired into article-extractor.js** — CYRILLIC_MIXED_CODE_PATTERN currently only in email-analyzer.js monolith path; needs migration to extractor module
- [ ] **Line-item dedup on composite (article + name) key** — prevents LLM re-enable from creating duplicate items
- [ ] **Brand synonym gap analysis** — systematic audit of which KB brands have no Cyrillic transliteration alias
- [ ] **INN zone-awareness** — prefer INN from signature zone over INN from body to avoid extracting partner INN; trigger: false-positive INN found in production sample

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Quantity per article (positions/totalQty fix) | HIGH | MEDIUM | P1 |
| Phone patterns rejected as articles | HIGH | LOW | P1 |
| ФИО template contamination guard | HIGH | LOW | P1 |
| Product names: no raw "1. X - N шт." format | HIGH | LOW | P1 |
| ИНН from attachment реквизиты | HIGH | MEDIUM | P1 |
| Subject-line brand priority boost | MEDIUM | LOW | P1 |
| UUID/hash article rejection | MEDIUM | LOW | P1 |
| ИНН checksum validation | MEDIUM | LOW | P2 |
| Brand recall: sliding-window product-name scan | HIGH | MEDIUM | P2 |
| Quantity in parentheses | MEDIUM | LOW | P2 |
| OGRN/KPP co-extraction | LOW | LOW | P3 |
| Cyrillic article codes migration to extractor | LOW | MEDIUM | P3 |
| INN zone-awareness | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for this milestone — directly addresses client complaints
- P2: Should have — improves metrics but not blocking
- P3: Nice to have — architectural debt, future validation

---

## Sources

- Live production codebase: `src/services/article-extractor.js`, `article-filters.js`, `fio-extractor.js`, `company-extractor.js`, `quantity-extractor.js`, `brand-extractor.js`, `brand-negative-filters.js`, `product-name-extractor.js`, `product-name-filters.js`
- Test suites: `tests/p0-regression.test.js`, `tests/p0-cycle3.test.js`, `tests/batch-j-fixes.test.js`, `tests/fio-extractor.test.js`, `tests/quantity-extractor.test.js`
- Production audit: memory/session_2026_05_20.md (100-email sample, 2026-05-20)
- Production feedback: memory/session_2026_05_21.md (template ФИО contamination discovery, 2026-05-21)
- PROJECT.md: Active requirements REQ-K-ARTICLES-01, REQ-K-COUNT-01, REQ-BRAND-01
- HANDOFF.json: known remaining bugs tasks 5-7

---
*Feature research for: Russian B2B email entity extraction — Detection Quality Sprint*
*Researched: 2026-05-25*
