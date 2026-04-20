// email-normalizer.js — Phase 9 Email extractor.
// parseSenderHeader supports:
//   - "Name <email>"          ← common RFC form
//   - '"Name" <email>'         ← quoted display
//   - "bare@email"             ← no display name
//   - '"email" <email>'        ← duplicate-in-display (deduplicated flag)
//   - "email <email>"          ← duplicate without quotes

// Basic email shape: local@domain.tld (permissive, pre-validation).
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
const EMAIL_RE_G = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

// Strip <>/quotes/whitespace from display.
function cleanDisplay(raw) {
    return String(raw || "")
        .replace(/^\s*["']\s*/, "")
        .replace(/\s*["']\s*$/, "")
        .trim();
}

// Lowercase email (case-insensitive part).
export function normalizeEmail(raw) {
    if (raw == null) return null;
    const s = String(raw).trim().toLowerCase();
    if (!s) return null;
    if (!EMAIL_RE.test(s)) return null;
    // Extract canonical match to strip anything around.
    const m = s.match(EMAIL_RE);
    return m ? m[0] : null;
}

// Split "local@domain" → { local, domain }.
export function splitLocalDomain(email) {
    const s = String(email || "").toLowerCase().trim();
    const at = s.indexOf("@");
    if (at < 1 || at === s.length - 1) return { local: "", domain: "" };
    return { local: s.slice(0, at), domain: s.slice(at + 1) };
}

// Extract all emails from a body of text — deduplicated, lowercased.
export function extractEmailsFromText(text) {
    const s = String(text || "");
    if (!s) return [];
    const seen = new Set();
    const out = [];
    const matches = s.match(EMAIL_RE_G);
    if (!matches) return out;
    for (const raw of matches) {
        const norm = raw.toLowerCase();
        if (seen.has(norm)) continue;
        seen.add(norm);
        out.push(norm);
    }
    return out;
}

// Parse an RFC-ish sender header.
// Returns: { email: "", displayName: "", deduplicated: bool }
export function parseSenderHeader(raw) {
    const s = String(raw || "").trim();
    const base = { email: "", displayName: "", deduplicated: false };
    if (!s) return base;

    // 1) Chevron form: "<something@here>" anywhere.
    const chevron = s.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
    let email = "";
    let displayRaw = "";
    if (chevron) {
        const addr = chevron[1];
        const norm = normalizeEmail(addr);
        if (norm) email = norm;
        // Display = everything before the chevron block.
        displayRaw = s.slice(0, s.indexOf(chevron[0])).trim();
    } else {
        // 2) No chevron → try to pull bare email; use rest as display.
        const m = s.match(EMAIL_RE);
        if (m) {
            const norm = normalizeEmail(m[0]);
            if (norm) email = norm;
            // Remove the email from the string → remainder is display.
            displayRaw = s.replace(m[0], "").trim();
        }
    }

    if (!email) return base;

    let displayName = cleanDisplay(displayRaw);

    // Deduplicated check: display carries the same email (possibly quoted).
    let deduplicated = false;
    if (displayName) {
        const displayLower = displayName.toLowerCase();
        if (displayLower === email || displayLower.includes(email)) {
            deduplicated = true;
            displayName = "";
        } else {
            // Also treat `"email"` wrapped in quotes as dedup even with leftover chars.
            const em = (displayLower.match(EMAIL_RE) || [])[0];
            if (em && em === email) {
                deduplicated = true;
                displayName = "";
            }
        }
    }

    return { email, displayName, deduplicated };
}
