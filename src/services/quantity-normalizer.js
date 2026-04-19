// quantity-normalizer.js — parse quantity forms into {value, unit}.
//
// Handles: "2 шт", "2шт", "82ШТ", "5 pcs", "2 компл.", "в кол-ве 5 шт",
// "Количество: 10", "3 комплекта по 4 шт", "1,000 шт" (locale-ambiguous).

const UNIT_CANON = {
    шт: "шт", штук: "шт", штуки: "шт", штука: "шт", штуках: "шт",
    pcs: "шт", pc: "шт", ea: "шт", each: "шт", units: "шт", unit: "шт",
    компл: "компл", комплект: "компл", комплекта: "компл", комплекты: "компл",
    комплектов: "компл", "к-т": "компл", "кт": "компл", set: "компл", sets: "компл",
    пар: "пар", пара: "пар", пары: "пар", pair: "пар", pairs: "пар",
    уп: "уп", упак: "уп", упаковка: "уп", упаковки: "уп", упаковок: "уп",
    pack: "уп", packs: "уп",
    бух: "бух", бухт: "бух", бухта: "бух",
    рул: "рул", рулон: "рул", рулона: "рул", рулонов: "рул",
    ед: "ед", единиц: "ед", единица: "ед", единицы: "ед",
    м: "м", метр: "м", метра: "м", метров: "м",
    кг: "кг", л: "л", литр: "л", литра: "л",
};

const COUNT_UNITS = new Set(["шт", "компл", "пар", "уп", "бух", "рул", "ед"]);

// Raw unit pattern — matches any known unit token (with optional dot)
const UNIT_TOKEN_RE = "(?:шт|штук[аи]?|штука|штуках|pcs|pc|ea|each|units?|компл(?:ект(?:а|ы|ов)?)?|к-т|пар[аы]?|pairs?|pair|уп|упак|упаковк[аиу]|упаковок|packs?|бух|бухт[аы]?|рул|рулон[аов]?|ед|единиц[аы]?|единица|м|метр[аов]?|кг|л|литр[аы]?)";

// "2 шт" / "2шт" / "82ШТ" / "2.5 л" / "0,5 м"
const VALUE_UNIT_RE = new RegExp(
    `^\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_TOKEN_RE})\\s*\\.?\\s*$`,
    "i"
);

// "в кол-ве 5 шт", "Кол-во: 3 компл.", "Количество 10", "qty 7"
// NB: кол-во/кол-ве — padezh variants; JS \b не ставим после кириллицы.
const IN_KOLVE_RE = new RegExp(
    `(?:в\\s+)?(?:кол(?:ичеств[оаеу]|-?в[оеау]|\\.)?|quantity|qty)\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_TOKEN_RE})?\\s*\\.?`,
    "i"
);

// "3 комплекта по 4 шт" / "2 компл по 5 шт"
const PACK_STRUCTURE_RE = new RegExp(
    `(\\d+)\\s*(${UNIT_TOKEN_RE})\\s+(?:по|of|x|×|по\\s+)\\s*(\\d+)\\s*(${UNIT_TOKEN_RE})`,
    "i"
);

// Locale-ambiguous: "1,000" followed by count-unit = thousand separator
// (comma between 3+ digits). Otherwise treated as decimal.
// NB: \w не матчит кириллицу, поэтому для unit используем [A-Za-zА-Яа-яЁё].
const LOCALE_THOUSAND_RE = /^(\d{1,3}(?:,\d{3})+)\s*([A-Za-zА-Яа-яЁё]+)/;
const LOCALE_SPACED_THOUSAND_RE = /^(\d{1,3}(?:\s\d{3})+)\s*([A-Za-zА-Яа-яЁё]+)/;

export function normalizeQtyUnit(unit) {
    if (!unit) return null;
    const key = String(unit).toLowerCase().trim().replace(/\.$/, "");
    return UNIT_CANON[key] || key;
}

function parseNumericValue(raw) {
    if (raw == null) return null;
    const s = String(raw).replace(",", ".").trim();
    if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
}

export function parseQuantityForm(input) {
    const s = String(input || "").trim();
    if (!s) return null;
    const match = s.match(VALUE_UNIT_RE);
    if (!match) return null;
    const value = parseNumericValue(match[1]);
    if (value == null) return null;
    const unit = normalizeQtyUnit(match[2]);
    if (!unit) return null;
    return { value, unit };
}

export function parseInKolve(input) {
    const s = String(input || "").trim();
    if (!s) return null;
    const match = s.match(IN_KOLVE_RE);
    if (!match) return null;
    const value = parseNumericValue(match[1]);
    if (value == null) return null;
    const unit = normalizeQtyUnit(match[2]) || "шт";
    return { value, unit };
}

export function parsePackStructure(input) {
    const s = String(input || "").trim();
    if (!s) return null;
    const match = s.match(PACK_STRUCTURE_RE);
    if (!match) return null;
    const packCount = parseNumericValue(match[1]);
    const packUnit = normalizeQtyUnit(match[2]);
    const itemCount = parseNumericValue(match[3]);
    const itemUnit = normalizeQtyUnit(match[4]);
    if (packCount == null || itemCount == null || !packUnit || !itemUnit) return null;
    return {
        packCount,
        packUnit,
        itemCount,
        itemUnit,
        totalCount: packCount * itemCount,
    };
}

// Locale-aware: "1,000 шт" with count-unit → 1000 (thousand sep, ambiguous)
// "2,5 шт" → 2.5 (decimal, not ambiguous)
// "10 000 шт" → 10000 (spaced thousand)
export function parseLocaleNumeric(input) {
    const s = String(input || "").trim();
    if (!s) return null;

    // Spaced thousands first: "10 000 шт"
    const spacedMatch = s.match(LOCALE_SPACED_THOUSAND_RE);
    if (spacedMatch) {
        const num = parseInt(spacedMatch[1].replace(/\s/g, ""), 10);
        const unit = normalizeQtyUnit(spacedMatch[2]);
        if (Number.isFinite(num) && unit && COUNT_UNITS.has(unit)) {
            return { value: num, unit, ambiguous: false };
        }
    }

    // Comma thousands (en-locale): "1,000 шт" with count unit
    const commaMatch = s.match(LOCALE_THOUSAND_RE);
    if (commaMatch) {
        const num = parseInt(commaMatch[1].replace(/,/g, ""), 10);
        const unit = normalizeQtyUnit(commaMatch[2]);
        if (Number.isFinite(num) && unit && COUNT_UNITS.has(unit)) {
            return { value: num, unit, ambiguous: true };
        }
    }

    // Standard decimal: "2,5 шт" or "2.5 шт"
    const parsed = parseQuantityForm(s);
    if (parsed) return { ...parsed, ambiguous: false };

    return null;
}
