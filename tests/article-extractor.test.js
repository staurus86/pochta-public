import { test } from "node:test";
import assert from "node:assert/strict";
import {
    isHtmlWordMetadata,
    isFilenameLike,
    isDateTime,
    isTechSpec,
    isRefrigerantCode,
    isSectionNumbering,
    isDescriptorSlug,
    isOCRNoise,
    rejectArticleCandidate,
} from "../src/services/article-filters.js";
import {
    normalizeArticleCode,
    normalizeProductName,
    dedupeCaseInsensitive,
    stripDescriptorTail,
    stripBrandPrefix,
} from "../src/services/article-normalizer.js";
import { splitZones, ZONES } from "../src/services/email-zoning.js";
import { extractArticles } from "../src/services/article-extractor.js";

// =====================================================================
// TZ §5.1 — HTML / Word / attachment metadata (hard reject)
// =====================================================================
test("filters:html-word-meta rejects page:WordSection*/WORDSECTION*/XMP.IID/FS\\d+/IROW\\d+", () => {
    assert.equal(isHtmlWordMetadata("page:WordSection1"), true);
    assert.equal(isHtmlWordMetadata("WORDSECTION1"), true);
    assert.equal(isHtmlWordMetadata("XMP.IID:ABCDEF123"), true);
    assert.equal(isHtmlWordMetadata("FS20"), true);
    assert.equal(isHtmlWordMetadata("IROW0"), true);
    assert.equal(isHtmlWordMetadata("cid:image001.png"), true);
    assert.equal(isHtmlWordMetadata("mailto:user@example.com"), true);
    assert.equal(isHtmlWordMetadata("http://example.com"), true);
    assert.equal(isHtmlWordMetadata("www.example.com"), true);
    // real articles must pass
    assert.equal(isHtmlWordMetadata("DNC-80-PPV-A"), false);
    assert.equal(isHtmlWordMetadata("152618"), false);
});

// =====================================================================
// TZ §5.2 — Filename-like (hard reject)
// =====================================================================
test("filters:filename-like rejects *.jpg/jpeg/png/pdf/doc/docx/xls/xlsx", () => {
    assert.equal(isFilenameLike("1342447151.jpg"), true);
    assert.equal(isFilenameLike("2000423780.xlsx.xls"), true);
    assert.equal(isFilenameLike("11.34.27.jpeg"), true);
    assert.equal(isFilenameLike("scan001.pdf"), true);
    assert.equal(isFilenameLike("document.docx"), true);
    // real articles must pass
    assert.equal(isFilenameLike("3610.5533"), false);
    assert.equal(isFilenameLike("DNC-80-PPV-A"), false);
});

// =====================================================================
// TZ §5.3 — Date / time / year (hard reject)
// =====================================================================
test("filters:datetime rejects HH:MM:SS / years / date fragments", () => {
    assert.equal(isDateTime("13:24:37"), true);
    assert.equal(isDateTime("08:30"), true);
    assert.equal(isDateTime("2026"), true);
    assert.equal(isDateTime("1999"), true);
    assert.equal(isDateTime("04-2026"), true);
    assert.equal(isDateTime("15.04.2026"), true);
    // real articles must pass
    assert.equal(isDateTime("152618"), false);
    assert.equal(isDateTime("3610.5533"), false);
});

// =====================================================================
// TZ §5.4 — Tech specs (hard reject)
// =====================================================================
test("filters:tech-spec rejects IP\\d+, RS\\d{3}, metallurgy grades, Hz, Bar, M\\d+, ranges", () => {
    assert.equal(isTechSpec("IP54"), true);
    assert.equal(isTechSpec("IP65"), true);
    assert.equal(isTechSpec("IP44"), true);
    assert.equal(isTechSpec("RS485"), true);
    assert.equal(isTechSpec("304L"), true);
    assert.equal(isTechSpec("316L"), true);
    assert.equal(isTechSpec("50Hz"), true);
    assert.equal(isTechSpec("60Hz"), true);
    assert.equal(isTechSpec("10 Bar"), true);
    assert.equal(isTechSpec("10Bar"), true);
    assert.equal(isTechSpec("M12"), true);
    assert.equal(isTechSpec("0-600"), true);
    assert.equal(isTechSpec("4-1/2"), true);
    // real articles must pass
    assert.equal(isTechSpec("DNC-80-PPV-A"), false);
    assert.equal(isTechSpec("QIT3-5033"), false);
});

// =====================================================================
// NEW: refrigerant codes from HHR sample (R407C, R404A, R134A, R22)
// =====================================================================
test("filters:refrigerant rejects R\\d{2,3}[A-Z]? codes", () => {
    assert.equal(isRefrigerantCode("R407C"), true);
    assert.equal(isRefrigerantCode("R404A"), true);
    assert.equal(isRefrigerantCode("R134A"), true);
    assert.equal(isRefrigerantCode("R22"), true);
    assert.equal(isRefrigerantCode("R410A"), true);
    // real articles with R-prefix must pass (TZ rule 4 multi-block)
    assert.equal(isRefrigerantCode("R 480316021"), false);
    assert.equal(isRefrigerantCode("R480316021"), false);
    // not a refrigerant: too many digits
    assert.equal(isRefrigerantCode("R12345"), false);
});

// =====================================================================
// TZ §5.5 — Section numbering (hard reject when contextual)
// =====================================================================
test("filters:section-numbering rejects 1.3.1 / 2.1.4 when document-structure context", () => {
    const docCtx = { sectionCount: 5 };
    assert.equal(isSectionNumbering("1.3.1", docCtx), true);
    assert.equal(isSectionNumbering("1.3.2", docCtx), true);
    assert.equal(isSectionNumbering("4.3.14", docCtx), true);
    assert.equal(isSectionNumbering("2.1.4", docCtx), true);
    // standalone dotted article (no sibling numbering) must pass
    assert.equal(isSectionNumbering("3610.5533", { sectionCount: 0 }), false);
    assert.equal(isSectionNumbering("88.1.82.9.02", { sectionCount: 0 }), false);
    assert.equal(isSectionNumbering("413415.003-02", { sectionCount: 0 }), false);
});

// =====================================================================
// TZ §5.6 — Descriptor / slug (hard reject)
// =====================================================================
test("filters:descriptor-slug rejects DESC:* / kebab-slug / descriptor phrases", () => {
    assert.equal(isDescriptorSlug("DESC:koltsa-sistemy-ochistki-v-sbore"), true);
    assert.equal(isDescriptorSlug("DESC:vorota-butzbach-2.8x2.5m"), true);
    assert.equal(isDescriptorSlug("koltsa-sistemy-ochistki"), true);
    // real articles must pass
    assert.equal(isDescriptorSlug("DNC-80-PPV-A"), false);
    assert.equal(isDescriptorSlug("QIT3-5033"), false);
});

// =====================================================================
// TZ §5.7 — OCR / random noise
// =====================================================================
test("filters:ocr-noise rejects random alnum tokens", () => {
    assert.equal(isOCRNoise("aeb2.Ew50"), true);
    assert.equal(isOCRNoise("Rloe5....1Muo5F"), true);
    assert.equal(isOCRNoise("9pnr0X"), true);
    assert.equal(isOCRNoise("8vjolR"), true);
    assert.equal(isOCRNoise("U8qRi-I"), true);
    assert.equal(isOCRNoise("q.yna8jiy"), true);
    assert.equal(isOCRNoise("AY3DZAR"), true);
    // real alnum SKUs must pass
    assert.equal(isOCRNoise("DNC-80-PPV-A"), false);
    assert.equal(isOCRNoise("QIT3-5033"), false);
    assert.equal(isOCRNoise("CLS15E-B1A3A"), false);
    assert.equal(isOCRNoise("CPS11E-BA7AAA2"), false);
    assert.equal(isOCRNoise("G392-012-000-002"), false);
});

// =====================================================================
// Unified rejectArticleCandidate — aggregate filter
// =====================================================================
test("rejectArticleCandidate aggregates all filters with reason codes", () => {
    const r1 = rejectArticleCandidate("IP54");
    assert.ok(r1.rejected);
    assert.match(r1.reason, /tech_spec|spec/i);

    const r2 = rejectArticleCandidate("page:WordSection1");
    assert.ok(r2.rejected);
    assert.match(r2.reason, /html|word|meta/i);

    const r3 = rejectArticleCandidate("DNC-80-PPV-A");
    assert.equal(r3.rejected, false);

    const r4 = rejectArticleCandidate("152618", { hasLabel: true });
    assert.equal(r4.rejected, false);

    // numeric WITHOUT strong context rejected (TZ Rule 1)
    const r5 = rejectArticleCandidate("2026", { hasLabel: false });
    assert.ok(r5.rejected);
});

// =====================================================================
// Normalization
// =====================================================================
test("normalizer: preserves WR-/MWR- prefix with space-dash (Belgormash case)", () => {
    assert.equal(normalizeArticleCode("WR- 2510GLW"), "WR-2510GLW");
    assert.equal(normalizeArticleCode("МWR- 5020FLWH"), "MWR-5020FLWH");
    assert.equal(normalizeArticleCode("WR -2510GLW"), "WR-2510GLW");
});

test("normalizer: strips leading/trailing junk but keeps structure", () => {
    assert.equal(normalizeArticleCode("  DNC-80-PPV-A,"), "DNC-80-PPV-A");
    assert.equal(normalizeArticleCode("«152618»"), "152618");
    assert.equal(normalizeArticleCode("'QIT3-5033'."), "QIT3-5033");
    // multi-block preserved
    assert.equal(normalizeArticleCode("TG 40-55/22-285"), "TG 40-55/22-285");
    assert.equal(normalizeArticleCode("AT 051 DA F04 N 11 DS"), "AT 051 DA F04 N 11 DS");
    assert.equal(normalizeArticleCode("R 480316021"), "R 480316021");
});

test("normalizer:normalizeProductName strips '1. ' prefix + '- N шт.' tail", () => {
    assert.equal(
        normalizeProductName("1. 3-х ходовой_Bronze_1\"_подсоединение_Rc_тип WR- 2510GLW - 10 шт."),
        "3-х ходовой Bronze 1\" подсоединение Rc тип WR-2510GLW"
    );
    assert.equal(
        normalizeProductName("2. 2-х ходовой_Bronze_2\"_подсоединение_Flange_тип МWR- 5020FLWH - 10 шт."),
        "2-х ходовой Bronze 2\" подсоединение Flange тип MWR-5020FLWH"
    );
});

test("normalizer:dedupeCaseInsensitive collapses cleaned↔raw dupes", () => {
    const deduped = dedupeCaseInsensitive([
        "DNC-80-PPV-A",
        "dnc-80-ppv-a",
        "DNC-80-PPV-A.",
        "QIT3-5033",
    ]);
    assert.deepEqual(deduped, ["DNC-80-PPV-A", "QIT3-5033"]);
});

test("normalizer:stripDescriptorTail cuts 'Betriebsdaten:…' and 'Вас сообщить…' tails", () => {
    assert.equal(
        stripDescriptorTail("TG40-55/22285", "TG40-55/22285 Betriebsdaten:- Luftanteil im Medium"),
        "TG40-55/22285"
    );
    assert.equal(
        stripDescriptorTail("152618", "152618 Вас сообщить о сроках"),
        "152618"
    );
});

test("normalizer:stripBrandPrefix removes FESTO:/SIEMENS: brand leak", () => {
    assert.equal(stripBrandPrefix("FESTO:DNC-80-PPV-A", ["FESTO", "SIEMENS"]), "DNC-80-PPV-A");
    assert.equal(stripBrandPrefix("SIEMENS: 6EP1961-3BA21", ["SIEMENS"]), "6EP1961-3BA21");
    // no brand — unchanged
    assert.equal(stripBrandPrefix("DNC-80-PPV-A", ["FESTO"]), "DNC-80-PPV-A");
});

// =====================================================================
// Email zoning
// =====================================================================
test("email-zoning:splitZones separates subject/currentMessage/signature/quotedThread", () => {
    const email = {
        subject: "FW: Запрос WR-2510GLW",
        body: [
            "Добрый день, прилагаю уточнения.",
            "",
            "С уважением,",
            "Виталий Косинский",
            "Тел.:+79217849364",
            "",
            "From: SIDERUS",
            "Sent: Wednesday, April 15, 2026 2:40 PM",
            "Subject: FW: Запрос",
            "",
            "Добрый день, у вас есть SAGINOMIYA WR-2510GLW — 10 шт?",
        ].join("\n"),
    };
    const zones = splitZones(email);
    assert.ok(zones.subject.includes("WR-2510GLW"));
    assert.ok(zones.currentMessage.includes("прилагаю уточнения"));
    assert.ok(zones.signature.includes("Виталий"));
    assert.ok(zones.quotedThread.includes("SAGINOMIYA WR-2510GLW"));
});

test("email-zoning:ZONES constants exported", () => {
    assert.ok(ZONES.SUBJECT);
    assert.ok(ZONES.CURRENT);
    assert.ok(ZONES.SIGNATURE);
    assert.ok(ZONES.QUOTED);
    assert.ok(ZONES.ATTACHMENT);
});

// =====================================================================
// TZ §A — classical alnum SKU with dashes/slashes/dots (POSITIVE)
// =====================================================================
test("extractor:TZ-A classical alnum SKU accepted", () => {
    const cases = [
        "DNC-80-PPV-A",
        "DNC-100-PPV-A",
        "QIT3-5033",
        "G392-012-000-002",
        "TA-050CLEM14-A-ZVG/US",
        "CLS15E-B1A3A",
        "CPS11E-BA7AAA2",
    ];
    for (const sku of cases) {
        const result = extractArticles({ subject: `Запрос ${sku}`, body: `Нужен ${sku} — 5 шт.` });
        assert.ok(
            result.articles.some((a) => a.toUpperCase() === sku.toUpperCase()),
            `expected ${sku} in ${JSON.stringify(result.articles)}`
        );
    }
});

// =====================================================================
// TZ §B — pure numeric with strong context (POSITIVE)
// =====================================================================
test("extractor:TZ-B pure numeric accepted with label context", () => {
    const cases = [
        { body: "Артикул: 152618", expected: "152618" },
        { body: "Артикул 34095 34098", expected: ["34095", "34098"] },
        { body: "Арт 3610.5533", expected: "3610.5533" },
        { body: "арт. 105500", expected: "105500" },
        { body: "Артикул № 1358", expected: "1358" },
        { body: "Артикул № 1360", expected: "1360" },
    ];
    for (const { body, expected } of cases) {
        const result = extractArticles({ subject: "Запрос", body });
        const expectedList = Array.isArray(expected) ? expected : [expected];
        for (const exp of expectedList) {
            assert.ok(
                result.articles.includes(exp),
                `expected ${exp} in ${JSON.stringify(result.articles)} for body "${body}"`
            );
        }
    }
});

test("extractor:TZ-B pure numeric WITHOUT strong context rejected (year, page, timestamp)", () => {
    const result = extractArticles({
        subject: "Запрос",
        body: "Отправлено 2026 года. Страница 553. Дата: 15.04.2026.",
    });
    assert.ok(!result.articles.includes("2026"), `2026 should not be article: ${JSON.stringify(result.articles)}`);
    assert.ok(!result.articles.includes("553"), `553 should not be article: ${JSON.stringify(result.articles)}`);
});

// =====================================================================
// TZ §C — dotted codes (POSITIVE with context)
// =====================================================================
test("extractor:TZ-C dotted codes accepted standalone", () => {
    const result = extractArticles({
        subject: "Запрос",
        body: "Арт 3610.5533, каталожный номер 413415.003-02, позиция 88.1.82.9.02 — 3 шт.",
    });
    assert.ok(result.articles.includes("3610.5533"));
    assert.ok(result.articles.includes("413415.003-02"));
    assert.ok(result.articles.includes("88.1.82.9.02"));
});

test("extractor:TZ-C section numbering 1.3.1/1.3.2/1.3.3 rejected", () => {
    const result = extractArticles({
        subject: "ТЗ",
        body: "1.3.1 Общие требования\n1.3.2 Состав\n1.3.3 Оборудование\n1.3.4 Материалы\n4.3.14 Монтаж",
    });
    for (const ng of ["1.3.1", "1.3.2", "1.3.3", "1.3.4", "4.3.14"]) {
        assert.ok(!result.articles.includes(ng), `section ${ng} should be rejected: ${JSON.stringify(result.articles)}`);
    }
});

// =====================================================================
// TZ §D — multi-block articles (POSITIVE)
// =====================================================================
test("extractor:TZ-D multi-block articles preserved", () => {
    const cases = [
        { body: "Артикул: TG 40-55/22-285", expected: "TG 40-55/22-285" },
        { body: "Part number: AT 051 DA F04 N 11 DS", expected: "AT 051 DA F04 N 11 DS" },
        { body: "Арт R 480316021 — 5 шт.", expected: "R 480316021" },
    ];
    for (const { body, expected } of cases) {
        const result = extractArticles({ subject: "Запрос", body });
        assert.ok(
            result.articles.includes(expected),
            `expected "${expected}" in ${JSON.stringify(result.articles)} for body "${body}"`
        );
    }
});

// =====================================================================
// TZ §E — model + numeric article coexist
// =====================================================================
test("extractor:TZ-E model + numeric article both preserved", () => {
    const result = extractArticles({
        subject: "Запрос",
        body: "Модель: PEV-W-KL-LED-GH\nАртикул: 152618\n5 шт.",
    });
    assert.ok(result.articles.includes("PEV-W-KL-LED-GH"), `expected PEV-W-KL-LED-GH: ${JSON.stringify(result.articles)}`);
    assert.ok(result.articles.includes("152618"), `expected 152618: ${JSON.stringify(result.articles)}`);
});

// =====================================================================
// TZ MIXED — brand + article + specs
// =====================================================================
test("extractor:TZ-mixed 'R. STAHL 8579/12-506 63A 5P IP66 Ex e' → only 8579/12-506", () => {
    const result = extractArticles({
        subject: "Запрос",
        body: "Артикул: R. STAHL 8579/12-506 63A 5P IP66 Ex e — 2 шт.",
    }, { knownBrands: ["R. STAHL", "R.STAHL", "STAHL"] });
    assert.ok(
        result.articles.includes("8579/12-506"),
        `expected 8579/12-506 in ${JSON.stringify(result.articles)}`
    );
    // specs must not leak
    for (const spec of ["63A", "5P", "IP66", "Ex e", "IP66 Ex e"]) {
        assert.ok(
            !result.articles.includes(spec),
            `spec ${spec} leaked to articles: ${JSON.stringify(result.articles)}`
        );
    }
});

test("extractor:TZ-mixed 'Aventics арт. R 480316021 10 Bar' → only R 480316021", () => {
    const result = extractArticles({
        subject: "Запрос Aventics",
        body: "Aventics арт. R 480316021 10 Bar — 4 шт.",
    }, { knownBrands: ["Aventics"] });
    assert.ok(
        result.articles.includes("R 480316021"),
        `expected R 480316021 in ${JSON.stringify(result.articles)}`
    );
    assert.ok(!result.articles.includes("10 Bar"), `10 Bar leaked: ${JSON.stringify(result.articles)}`);
    assert.ok(!result.articles.includes("10"), `raw 10 leaked: ${JSON.stringify(result.articles)}`);
});

// =====================================================================
// HHR sample — refrigerant reject + WR-/MWR- preserve
// =====================================================================
test("extractor:HHR sample — R407C/R404A rejected, WR-2510GLW/MWR-5020FLWH preserved", () => {
    const result = extractArticles({
        subject: "FW: Запрос",
        body: [
            "Добрый день.",
            "У вас есть в наличии или под заказ водорегулирующие клапаны SAGINOMIYA для",
            "морской воды и применением фреона R407C, R404A:",
            "",
            "1. 3-х ходовой_Bronze_1\"_подсоединение_Rc_тип WR- 2510GLW - 10 шт.",
            "2. 2-х ходовой_Bronze_2\"_подсоединение_ Flange _тип МWR- 5020FLWH - 10 шт.",
        ].join("\n"),
    }, { knownBrands: ["SAGINOMIYA"] });

    // refrigerants REJECTED
    assert.ok(!result.articles.includes("R407C"), `R407C leaked: ${JSON.stringify(result.articles)}`);
    assert.ok(!result.articles.includes("R404A"), `R404A leaked: ${JSON.stringify(result.articles)}`);
    assert.ok(
        !result.articles.some((a) => /R407C|R404A/.test(a)),
        `refrigerant fragment leaked: ${JSON.stringify(result.articles)}`
    );

    // WR-/MWR- preserved with prefix
    assert.ok(result.articles.includes("WR-2510GLW"), `WR-2510GLW lost: ${JSON.stringify(result.articles)}`);
    assert.ok(result.articles.includes("MWR-5020FLWH"), `MWR-5020FLWH lost: ${JSON.stringify(result.articles)}`);

    // positions = 2 unique articles (TZ goal for Belgormash-like inflation fix)
    assert.equal(result.articles.length, 2, `expected 2 unique articles, got ${result.articles.length}: ${JSON.stringify(result.articles)}`);
});

// =====================================================================
// Safety guard — attachment flood
// =====================================================================
test("extractor:safety-guard flags strict mode when >12 candidates with >30% noise", () => {
    const body = [
        "Вложение attachment.docx:",
        "page:WordSection1 WORDSECTION1 XMP.IID:abcdef",
        "FS20 FS21 IROW0 IROW1",
        "1342447151.jpg 2000423780.xlsx.xls 11.34.27.jpeg",
        "IP54 IP65 RS485 304L 316L 50Hz",
        "",
        "Артикул: 152618",
    ].join("\n");
    const result = extractArticles({ subject: "Запрос", body });
    assert.equal(result.strictMode, true, "strictMode should trigger");
    assert.ok(result.rejectedCandidates.length >= 10, "many rejects expected");
    // real article still extracted
    assert.ok(result.articles.includes("152618"));
});

// =====================================================================
// Debug — rawCandidates + rejectedCandidates available
// =====================================================================
test("extractor:debug exposes rawCandidates + rejectedCandidates", () => {
    const result = extractArticles({
        subject: "Запрос",
        body: "Артикул: 152618 IP54 page:WordSection1 DNC-80-PPV-A",
    });
    assert.ok(Array.isArray(result.rawCandidates));
    assert.ok(Array.isArray(result.rejectedCandidates));
    assert.ok(result.rejectedCandidates.some((r) => r.value === "IP54"));
    assert.ok(result.rejectedCandidates.some((r) => /WordSection/i.test(r.value)));
});
