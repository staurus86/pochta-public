// quantity-filters.js — negative predicates for quantity extraction.
// Distinguishes real counts ("2 шт", "5 компл.") from technical specs that
// look like counts ("90 мм", "240V", "50Hz", "1500 min-1", "2.20 kW").
//
// All predicates receive a pre-trimmed candidate segment (number + following
// token/unit) and return true if the segment is a technical spec, not a count.

// Dimensions: mm / см / м / ft / in / DN / Ду / inch
// NB: JS \b doesn't work with Cyrillic, so we use explicit end-of-string anchor.
const DIMENSION_UNIT_RE = /^\s*\d+(?:[.,]\d+)?\s*(?:mm|мм|cm|см|m|м|ft|in|inch|\"|\')\s*$/i;
const DN_RE = /^\s*(?:DN|Ду|DU)\s*\d+/i;
// Weight: кг/г/т/tons/lbs
const WEIGHT_UNIT_RE = /^\s*\d+(?:[.,]\d+)?\s*(?:кг|kg|г|g|т|tons?|lbs?|gram|грамм|тонн)\s*\.?\s*$/i;
// Power: W/kW/Вт/кВт/лс/hp
const POWER_UNIT_RE = /^\s*\d+(?:[.,]\d+)?\s*(?:W|Вт|kW|кВт|мВт|mW|л\.?\s*с\.?|hp)\s*\.?\s*$/i;
// Voltage: V/В/kV/кВ
const VOLTAGE_UNIT_RE = /^\s*\d+(?:[.,]\d+)?\s*(?:V|В|kV|кВ|mV|мВ|VDC|VAC)\s*\.?\s*$/i;
// Pressure: bar/MPa/atm/Pa/psi/Па/атм/МПа/кПа/бар
const PRESSURE_UNIT_RE = /^\s*\d+(?:[.,]\d+)?\s*(?:bar|bars|МПа|МРа|mpa|kpa|кПа|Pa|Па|atm|атм|psi|бар)\s*\.?\s*$/i;
// Frequency: Hz/Гц (incl. 50/60HZ)
const FREQUENCY_UNIT_RE = /^\s*\d+(?:\s*\/\s*\d+)?\s*(?:Hz|HZ|Гц|kHz|кГц|MHz|МГц)\s*\.?\s*$/i;
// RPM: rpm / об/мин / min-1 / мин-1
const RPM_UNIT_RE = /^\s*\d+(?:[.,]\d+)?\s*(?:rpm|об\/мин|min-?1|мин-?1)\s*\.?\s*$/i;
// Temperature: °C / °F / C / °
const TEMPERATURE_UNIT_RE = /^\s*-?\d+(?:[.,]\d+)?\s*°?\s*(?:C|F|К|Цельсия)\s*\.?\s*$/i;

// Phones: strict — require explicit phone shape (international +, parentheses,
// or 3+ digit groups separated by spaces/dashes — not a single hyphen boundary).
const PHONE_INTL_RE = /\+\d[\d\s\-()]{6,}/;
const PHONE_PAREN_RE = /\(\d{3,4}\)\s*\d/;
const PHONE_GROUPS_RE = /\b\d{2,4}[\s\-]\d{2,4}[\s\-]\d{2,4}(?:[\s\-]\d{2,4})?\b/;
// Dates: 21.04.2026, 2026-04-20, 20/04/2026
const DATE_RE = /^\s*(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\s*$/;
// Hours: 9.00-18.00 or 9:00 - 18:00
const HOURS_RE = /\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2}/;

// ——————————————————————————————————————————————————————————————
// Public predicates
// ——————————————————————————————————————————————————————————————

export function isDimensionLike(value) {
    const s = String(value || "").trim();
    if (!s) return false;
    return DIMENSION_UNIT_RE.test(s) || DN_RE.test(s);
}

export function isWeightLike(value) {
    return WEIGHT_UNIT_RE.test(String(value || "").trim());
}

export function isPowerLike(value) {
    return POWER_UNIT_RE.test(String(value || "").trim());
}

export function isVoltageLike(value) {
    return VOLTAGE_UNIT_RE.test(String(value || "").trim());
}

export function isPressureLike(value) {
    return PRESSURE_UNIT_RE.test(String(value || "").trim());
}

export function isFrequencyLike(value) {
    return FREQUENCY_UNIT_RE.test(String(value || "").trim());
}

export function isRpmLike(value) {
    return RPM_UNIT_RE.test(String(value || "").trim());
}

export function isTemperatureLike(value) {
    return TEMPERATURE_UNIT_RE.test(String(value || "").trim());
}

export function isPhoneLike(value) {
    const s = String(value || "").trim();
    if (!s) return false;
    const digitsOnly = s.replace(/\D/g, "");
    if (digitsOnly.length < 7) return false;
    // Must have explicit phone shape — not just "digits + single hyphen + digit"
    // (which matches article-qty segments like "9226513 - 4").
    return PHONE_INTL_RE.test(s) || PHONE_PAREN_RE.test(s) || PHONE_GROUPS_RE.test(s);
}

export function isDateLike(value) {
    return DATE_RE.test(String(value || "").trim());
}

export function isHoursLike(value) {
    return HOURS_RE.test(String(value || "").trim());
}

// Composite: true if candidate looks like any technical spec (not a count).
export function isTechnicalSpec(value) {
    const s = String(value || "").trim();
    if (!s) return false;
    return (
        isDimensionLike(s) ||
        isWeightLike(s) ||
        isPowerLike(s) ||
        isVoltageLike(s) ||
        isPressureLike(s) ||
        isFrequencyLike(s) ||
        isRpmLike(s) ||
        isTemperatureLike(s) ||
        isPhoneLike(s) ||
        isDateLike(s) ||
        isHoursLike(s)
    );
}
