// Phase 9 — Email extractor TDD suite
// Covers:
//   - email-filters: classifyLocalPart / classifyDomain / canUseAsTruthSource
//   - email-normalizer: parseSenderHeader / normalizeEmail / splitLocalDomain
//   - email-extractor facade: primary / dedup / classification / cross-field rules
//
// Audit baseline (1826 rows):
//   - 100% emails present in "От"
//   - 35 duplicate-in-display "email <email>"
//   - 497 public provider addresses (gmail/mail.ru/yandex.ru/bk.ru/…)
//   - 227 role mailboxes (sales/info/manager/zakaz/support/procurement/robot)
//   - 4 system/noreply
//   - 1289 unique emails / 800 unique domains

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    classifyLocalPart,
    classifyDomain,
    canUseAsTruthSource,
    PUBLIC_PROVIDER_DOMAINS,
    ROLE_KEYWORDS,
    SYSTEM_KEYWORDS,
} from "../src/services/email-filters.js";

import {
    parseSenderHeader,
    normalizeEmail,
    splitLocalDomain,
    extractEmailsFromText,
} from "../src/services/email-normalizer.js";

import { extractEmail } from "../src/services/email-extractor.js";

// ─────────────────────────────────────────────────────────────
// Filters — local-part classification
// ─────────────────────────────────────────────────────────────

test("classifyLocalPart: role keywords → role_mailbox", () => {
    assert.equal(classifyLocalPart("sales"), "role_mailbox");
    assert.equal(classifyLocalPart("info"), "role_mailbox");
    assert.equal(classifyLocalPart("manager"), "role_mailbox");
    assert.equal(classifyLocalPart("zakaz"), "role_mailbox");
    assert.equal(classifyLocalPart("support"), "role_mailbox");
    assert.equal(classifyLocalPart("procurement"), "role_mailbox");
    assert.equal(classifyLocalPart("office"), "role_mailbox");
    assert.equal(classifyLocalPart("buh"), "role_mailbox");
    assert.equal(classifyLocalPart("otdel.prodag"), "role_mailbox");
    // tender is a role (bidding mailbox, not a person)
    assert.equal(classifyLocalPart("tender"), "role_mailbox");
});

test("classifyLocalPart: system keywords → system_email/noreply_email", () => {
    assert.equal(classifyLocalPart("noreply"), "noreply_email");
    assert.equal(classifyLocalPart("no-reply"), "noreply_email");
    assert.equal(classifyLocalPart("donotreply"), "noreply_email");
    assert.equal(classifyLocalPart("mailer-daemon"), "system_email");
    assert.equal(classifyLocalPart("postmaster"), "system_email");
    assert.equal(classifyLocalPart("robot"), "system_email");
    assert.equal(classifyLocalPart("notification"), "system_email");
});

test("classifyLocalPart: person-like → person_email", () => {
    assert.equal(classifyLocalPart("ivan.petrov"), "person_email");
    assert.equal(classifyLocalPart("a.smirnov"), "person_email");
    assert.equal(classifyLocalPart("ivanov_ip"), "person_email");
    assert.equal(classifyLocalPart("elena"), "person_email");
});

test("classifyLocalPart: unknown → unknown (too short / mixed)", () => {
    assert.equal(classifyLocalPart(""), "unknown");
    assert.equal(classifyLocalPart(null), "unknown");
});

// ─────────────────────────────────────────────────────────────
// Filters — domain classification
// ─────────────────────────────────────────────────────────────

test("classifyDomain: public provider domains", () => {
    assert.equal(classifyDomain("gmail.com"), "public_provider");
    assert.equal(classifyDomain("mail.ru"), "public_provider");
    assert.equal(classifyDomain("yandex.ru"), "public_provider");
    assert.equal(classifyDomain("bk.ru"), "public_provider");
    assert.equal(classifyDomain("list.ru"), "public_provider");
    assert.equal(classifyDomain("inbox.ru"), "public_provider");
    assert.equal(classifyDomain("ya.ru"), "public_provider");
    assert.equal(classifyDomain("rambler.ru"), "public_provider");
    assert.equal(classifyDomain("hotmail.com"), "public_provider");
    assert.equal(classifyDomain("outlook.com"), "public_provider");
    assert.equal(classifyDomain("yahoo.com"), "public_provider");
    assert.equal(classifyDomain("icloud.com"), "public_provider");
    assert.equal(classifyDomain("protonmail.com"), "public_provider");
});

test("classifyDomain: corporate domains (fallback)", () => {
    assert.equal(classifyDomain("company.ru"), "corporate");
    assert.equal(classifyDomain("siderus.ru"), "corporate");
    assert.equal(classifyDomain("example.com"), "corporate");
});

test("classifyDomain: platform domains", () => {
    assert.equal(classifyDomain("tilda.ws"), "platform");
});

test("classifyDomain: empty/invalid → unknown", () => {
    assert.equal(classifyDomain(""), "unknown");
    assert.equal(classifyDomain(null), "unknown");
    assert.equal(classifyDomain(undefined), "unknown");
});

// ─────────────────────────────────────────────────────────────
// Filters — canUseAsTruthSource
// ─────────────────────────────────────────────────────────────

test("canUseAsTruthSource: public email cannot define Company", () => {
    const classified = { type: "person_email", domainType: "public_provider" };
    assert.equal(canUseAsTruthSource(classified, "company"), false);
});

test("canUseAsTruthSource: role email cannot define Person/ФИО", () => {
    const classified = { type: "role_mailbox", domainType: "corporate" };
    assert.equal(canUseAsTruthSource(classified, "person"), false);
});

test("canUseAsTruthSource: system/noreply cannot define anything", () => {
    const sys = { type: "system_email", domainType: "corporate" };
    assert.equal(canUseAsTruthSource(sys, "person"), false);
    assert.equal(canUseAsTruthSource(sys, "company"), false);
    const nor = { type: "noreply_email", domainType: "corporate" };
    assert.equal(canUseAsTruthSource(nor, "person"), false);
    assert.equal(canUseAsTruthSource(nor, "company"), false);
});

test("canUseAsTruthSource: person + corporate = YES for company + person", () => {
    const classified = { type: "person_email", domainType: "corporate" };
    assert.equal(canUseAsTruthSource(classified, "company"), true);
    assert.equal(canUseAsTruthSource(classified, "person"), true);
});

// ─────────────────────────────────────────────────────────────
// Normalizer — parseSenderHeader
// ─────────────────────────────────────────────────────────────

test("parseSenderHeader: Name <email>", () => {
    const res = parseSenderHeader("Иван Петров <ivan@company.ru>");
    assert.equal(res.email, "ivan@company.ru");
    assert.equal(res.displayName, "Иван Петров");
    assert.equal(res.deduplicated, false);
});

test('parseSenderHeader: "Name" <email> (quoted display)', () => {
    const res = parseSenderHeader('"Иван Петров" <ivan@company.ru>');
    assert.equal(res.email, "ivan@company.ru");
    assert.equal(res.displayName, "Иван Петров");
});

test("parseSenderHeader: bare email", () => {
    const res = parseSenderHeader("ivan@company.ru");
    assert.equal(res.email, "ivan@company.ru");
    assert.equal(res.displayName, "");
    assert.equal(res.deduplicated, false);
});

test('parseSenderHeader: "email" <email> — deduplicated display', () => {
    const res = parseSenderHeader('"sales@company.ru" <sales@company.ru>');
    assert.equal(res.email, "sales@company.ru");
    assert.equal(res.displayName, "");
    assert.equal(res.deduplicated, true);
});

test("parseSenderHeader: email email — deduplicated without quotes", () => {
    const res = parseSenderHeader("sales@company.ru <sales@company.ru>");
    assert.equal(res.email, "sales@company.ru");
    assert.equal(res.displayName, "");
    assert.equal(res.deduplicated, true);
});

test("parseSenderHeader: handles mixed case → normalized lowercase", () => {
    const res = parseSenderHeader("Ivan <Ivan.Petrov@Company.RU>");
    assert.equal(res.email, "ivan.petrov@company.ru");
});

test("parseSenderHeader: empty → empty result", () => {
    const res = parseSenderHeader("");
    assert.equal(res.email, "");
});

// ─────────────────────────────────────────────────────────────
// Normalizer — normalizeEmail / splitLocalDomain / extractEmailsFromText
// ─────────────────────────────────────────────────────────────

test("normalizeEmail: trim + lowercase", () => {
    assert.equal(normalizeEmail("  Ivan@Company.RU  "), "ivan@company.ru");
    assert.equal(normalizeEmail("SALES@DOMAIN.COM"), "sales@domain.com");
});

test("normalizeEmail: returns null for invalid", () => {
    assert.equal(normalizeEmail("not an email"), null);
    assert.equal(normalizeEmail(""), null);
    assert.equal(normalizeEmail(null), null);
});

test("splitLocalDomain: valid email", () => {
    const { local, domain } = splitLocalDomain("ivan@company.ru");
    assert.equal(local, "ivan");
    assert.equal(domain, "company.ru");
});

test("splitLocalDomain: empty → empty parts", () => {
    const { local, domain } = splitLocalDomain("");
    assert.equal(local, "");
    assert.equal(domain, "");
});

test("extractEmailsFromText: finds multiple", () => {
    const list = extractEmailsFromText("Write to ivan@x.com or info@y.ru");
    assert.deepEqual(list, ["ivan@x.com", "info@y.ru"]);
});

test("extractEmailsFromText: dedup case-insensitive", () => {
    const list = extractEmailsFromText("Ivan@X.com and ivan@x.COM");
    assert.deepEqual(list, ["ivan@x.com"]);
});

// ─────────────────────────────────────────────────────────────
// Facade — basic extraction
// ─────────────────────────────────────────────────────────────

test("extractEmail: sender header primary", () => {
    const res = extractEmail({
        rawFrom: "Иван Петров <ivan@company.ru>",
        fromEmail: "ivan@company.ru",
        fromName: "Иван Петров",
        body: "",
        signature: "",
    });
    assert.equal(res.primary, "ivan@company.ru");
    assert.equal(res.displayName, "Иван Петров");
    assert.equal(res.localPart, "ivan");
    assert.equal(res.domain, "company.ru");
    assert.equal(res.type, "person_email");
    assert.equal(res.domainType, "corporate");
    assert.equal(res.source, "sender_header");
});

test("extractEmail: deduplicated 'email <email>' format → flag", () => {
    const res = extractEmail({
        rawFrom: '"sales@company.ru" <sales@company.ru>',
        fromEmail: "sales@company.ru",
        fromName: 'sales@company.ru',
    });
    assert.equal(res.primary, "sales@company.ru");
    assert.equal(res.deduplicated, true);
    assert.equal(res.displayName, "");
    assert.equal(res.type, "role_mailbox");
});

test("extractEmail: public provider classification — gmail", () => {
    const res = extractEmail({
        rawFrom: "<ivanov@gmail.com>",
        fromEmail: "ivanov@gmail.com",
        fromName: "",
    });
    assert.equal(res.domainType, "public_provider");
    assert.equal(res.type, "person_email");
});

test("extractEmail: role mailbox — sales@corporate", () => {
    const res = extractEmail({
        rawFrom: "<sales@acme.ru>",
        fromEmail: "sales@acme.ru",
        fromName: "",
    });
    assert.equal(res.type, "role_mailbox");
    assert.equal(res.domainType, "corporate");
});

test("extractEmail: system sender — noreply", () => {
    const res = extractEmail({
        rawFrom: "<noreply@acme.ru>",
        fromEmail: "noreply@acme.ru",
        fromName: "",
    });
    assert.equal(res.type, "noreply_email");
    assert.equal(res.needsReview, true);
});

test("extractEmail: mailer-daemon → system_email", () => {
    const res = extractEmail({
        rawFrom: "<mailer-daemon@company.ru>",
        fromEmail: "mailer-daemon@company.ru",
        fromName: "",
    });
    assert.equal(res.type, "system_email");
});

test("extractEmail: person-like mailbox ivan.petrov@corp", () => {
    const res = extractEmail({
        rawFrom: "<ivan.petrov@acme.ru>",
        fromEmail: "ivan.petrov@acme.ru",
        fromName: "",
    });
    assert.equal(res.type, "person_email");
    assert.equal(res.domainType, "corporate");
});

// ─────────────────────────────────────────────────────────────
// Facade — source-of-truth rules
// ─────────────────────────────────────────────────────────────

test("extractEmail: public provider → canDefineCompany=false", () => {
    const res = extractEmail({
        rawFrom: "<ivan@gmail.com>",
        fromEmail: "ivan@gmail.com",
        fromName: "",
    });
    assert.equal(res.canDefineCompany, false);
    assert.equal(res.canDefinePerson, true); // person-like local part
});

test("extractEmail: role mailbox → canDefinePerson=false", () => {
    const res = extractEmail({
        rawFrom: "<sales@acme.ru>",
        fromEmail: "sales@acme.ru",
        fromName: "",
    });
    assert.equal(res.canDefinePerson, false);
    assert.equal(res.canDefineCompany, true); // corporate domain
});

test("extractEmail: system → neither person nor company source", () => {
    const res = extractEmail({
        rawFrom: "<noreply@acme.ru>",
        fromEmail: "noreply@acme.ru",
        fromName: "",
    });
    assert.equal(res.canDefinePerson, false);
    assert.equal(res.canDefineCompany, false);
});

// ─────────────────────────────────────────────────────────────
// Facade — confidence + debug
// ─────────────────────────────────────────────────────────────

test("extractEmail: confidence high for person@corporate", () => {
    const res = extractEmail({
        rawFrom: "<ivan.petrov@acme.ru>",
        fromEmail: "ivan.petrov@acme.ru",
        fromName: "",
    });
    assert.ok(res.confidence >= 0.8, `confidence too low: ${res.confidence}`);
    assert.equal(res.needsReview, false);
});

test("extractEmail: confidence low for noreply", () => {
    const res = extractEmail({
        rawFrom: "<noreply@acme.ru>",
        fromEmail: "noreply@acme.ru",
    });
    assert.ok(res.confidence < 0.6, `confidence too high for noreply: ${res.confidence}`);
    assert.equal(res.needsReview, true);
});

test("extractEmail: debug raw candidates", () => {
    const res = extractEmail({
        rawFrom: "Иван <ivan@company.ru>",
        fromEmail: "ivan@company.ru",
    });
    assert.ok(Array.isArray(res.rawCandidates));
    assert.ok(res.rawCandidates.length >= 1);
});

test("extractEmail: empty input → null primary", () => {
    const res = extractEmail({});
    assert.equal(res.primary, null);
});

test("extractEmail: invalid email format → rejected", () => {
    const res = extractEmail({
        rawFrom: "not-an-email",
        fromEmail: "not-an-email",
    });
    assert.equal(res.primary, null);
    assert.ok(res.rejected.length >= 1);
});

// ─────────────────────────────────────────────────────────────
// Facade — deduplication detection
// ─────────────────────────────────────────────────────────────

test("extractEmail: deduplicated display flagged", () => {
    const res = extractEmail({
        rawFrom: 'info@company.ru <info@company.ru>',
        fromEmail: 'info@company.ru',
        fromName: 'info@company.ru',
    });
    assert.equal(res.deduplicated, true);
});

test("extractEmail: preserves displayName when it's a real name", () => {
    const res = extractEmail({
        rawFrom: 'Petrov Ivan <ivan.petrov@acme.ru>',
        fromEmail: 'ivan.petrov@acme.ru',
        fromName: 'Petrov Ivan',
    });
    assert.equal(res.displayName, "Petrov Ivan");
    assert.equal(res.deduplicated, false);
});
