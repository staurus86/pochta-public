import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || "data");
const FREE_EMAIL_DOMAINS = new Set(["gmail.com", "mail.ru", "bk.ru", "list.ru", "inbox.ru", "yandex.ru", "ya.ru", "hotmail.com", "outlook.com"]);

const DEFAULT_RULES = [
  { scope: "body", classifier: "spam", matchType: "regex", pattern: "casino|crypto|легкий заработок|раскрут(ка|им)|seo[- ]?продвиж|unsubscr|viagra", weight: 5, notes: "Базовый spam filter" },
  { scope: "body", classifier: "client", matchType: "regex", pattern: "заявк|коммерческ|прошу|нужн|артикул|шильдик|кол-?во|счет|цен", weight: 3, notes: "Клиентские сигналы" },
  { scope: "body", classifier: "vendor", matchType: "regex", pattern: "предлагаем|каталог|дилер|поставля|прайс|услуг", weight: 3, notes: "Поставщик услуг" },
  { scope: "subject", classifier: "client", matchType: "regex", pattern: "заявка|rfq|запрос|quotation|коммерческое", weight: 4, notes: "Клиентский subject" },
  { scope: "attachment", classifier: "client", matchType: "regex", pattern: "реквиз|шильд|артик|sku|label", weight: 2, notes: "Полезные вложения" },
  { scope: "domain", classifier: "spam", matchType: "contains", pattern: "unsubscribe", weight: 4, notes: "Доменные spam сигналы" }
];

const DEFAULT_BRAND_ALIASES = [
  { canonicalBrand: "ABB", alias: "abb" },
  { canonicalBrand: "Schneider Electric", alias: "schneider" },
  { canonicalBrand: "Schneider Electric", alias: "schneider electric" },
  { canonicalBrand: "Legrand", alias: "legrand" },
  { canonicalBrand: "IEK", alias: "iek" },
  { canonicalBrand: "R. Stahl", alias: "r. stahl" },
  { canonicalBrand: "R. Stahl", alias: "rstahl" },
  { canonicalBrand: "Endress & Hauser", alias: "endress" },
  { canonicalBrand: "Endress & Hauser", alias: "hauser" }
];

const DEFAULT_FIELD_PATTERNS = [
  { fieldName: "company_name", pattern: "(ООО\\s+[\"«][^\"»]+[\"»])", priority: 100 },
  { fieldName: "company_name", pattern: "(АО\\s+[\"«][^\"»]+[\"»])", priority: 90 },
  { fieldName: "company_name", pattern: "(ИП\\s+[А-ЯЁ][а-яё]+(?:\\s+[А-ЯЁ][а-яё]+){1,2})", priority: 80 },
  { fieldName: "position", pattern: "генеральный директор", priority: 100 },
  { fieldName: "position", pattern: "менеджер по закупкам", priority: 90 },
  { fieldName: "position", pattern: "менеджер", priority: 70 },
  { fieldName: "position", pattern: "инженер", priority: 60 },
  { fieldName: "signature_hint", pattern: "(?:с уважением|best regards|спасибо)[,\\s]*\\n+([А-ЯЁ][а-яё]+(?:\\s+[А-ЯЁ][а-яё]+){1,2})", priority: 100 }
];

class DetectionKnowledgeBase {
  constructor({ dataDir = DEFAULT_DATA_DIR } = {}) {
    this.dataDir = dataDir;
    mkdirSync(this.dataDir, { recursive: true });
    this.dbPath = path.join(this.dataDir, "detection-kb.sqlite");
    this.db = new DatabaseSync(this.dbPath);
    this.initialize();
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS detection_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        classifier TEXT NOT NULL,
        match_type TEXT NOT NULL,
        pattern TEXT NOT NULL,
        weight INTEGER NOT NULL DEFAULT 1,
        notes TEXT DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS brand_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_brand TEXT NOT NULL,
        alias TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS sender_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_email TEXT DEFAULT '',
        sender_domain TEXT DEFAULT '',
        classification TEXT NOT NULL,
        company_hint TEXT DEFAULT '',
        brand_hint TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS field_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field_name TEXT NOT NULL,
        pattern TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 50,
        is_active INTEGER NOT NULL DEFAULT 1
      );
    `);

    this.seedIfEmpty();
  }

  seedIfEmpty() {
    const hasRules = this.db.prepare("SELECT COUNT(*) AS count FROM detection_rules").get().count;
    if (!hasRules) {
      const statement = this.db.prepare("INSERT INTO detection_rules (scope, classifier, match_type, pattern, weight, notes) VALUES (?, ?, ?, ?, ?, ?)");
      for (const rule of DEFAULT_RULES) {
        statement.run(rule.scope, rule.classifier, rule.matchType, rule.pattern, rule.weight, rule.notes);
      }
    }

    const hasBrands = this.db.prepare("SELECT COUNT(*) AS count FROM brand_aliases").get().count;
    if (!hasBrands) {
      const statement = this.db.prepare("INSERT INTO brand_aliases (canonical_brand, alias) VALUES (?, ?)");
      for (const alias of DEFAULT_BRAND_ALIASES) {
        statement.run(alias.canonicalBrand, alias.alias);
      }
    }

    const hasFields = this.db.prepare("SELECT COUNT(*) AS count FROM field_patterns").get().count;
    if (!hasFields) {
      const statement = this.db.prepare("INSERT INTO field_patterns (field_name, pattern, priority) VALUES (?, ?, ?)");
      for (const field of DEFAULT_FIELD_PATTERNS) {
        statement.run(field.fieldName, field.pattern, field.priority);
      }
    }
  }

  getRules() {
    return this.db.prepare("SELECT * FROM detection_rules WHERE is_active = 1 ORDER BY classifier, weight DESC, id ASC").all();
  }

  getBrandAliases() {
    return this.db.prepare("SELECT * FROM brand_aliases WHERE is_active = 1 ORDER BY canonical_brand, alias").all();
  }

  getFieldPatterns(fieldName) {
    return this.db.prepare("SELECT * FROM field_patterns WHERE is_active = 1 AND field_name = ? ORDER BY priority DESC, id ASC").all(fieldName);
  }

  getSenderProfiles() {
    return this.db.prepare("SELECT * FROM sender_profiles WHERE is_active = 1 ORDER BY id ASC").all();
  }

  addRule(payload) {
    const statement = this.db.prepare(`
      INSERT INTO detection_rules (scope, classifier, match_type, pattern, weight, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = statement.run(
      payload.scope,
      payload.classifier,
      payload.matchType,
      payload.pattern,
      Number(payload.weight || 1),
      payload.notes || ""
    );

    return this.db.prepare("SELECT * FROM detection_rules WHERE id = ?").get(Number(result.lastInsertRowid));
  }

  addBrandAlias(payload) {
    const statement = this.db.prepare(`
      INSERT INTO brand_aliases (canonical_brand, alias)
      VALUES (?, ?)
    `);
    const result = statement.run(payload.canonicalBrand, payload.alias);
    return this.db.prepare("SELECT * FROM brand_aliases WHERE id = ?").get(Number(result.lastInsertRowid));
  }

  addSenderProfile(payload) {
    const statement = this.db.prepare(`
      INSERT INTO sender_profiles (sender_email, sender_domain, classification, company_hint, brand_hint, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = statement.run(
      payload.senderEmail || "",
      payload.senderDomain || "",
      payload.classification,
      payload.companyHint || "",
      payload.brandHint || "",
      payload.notes || ""
    );
    return this.db.prepare("SELECT * FROM sender_profiles WHERE id = ?").get(Number(result.lastInsertRowid));
  }

  getStats() {
    return {
      dbPath: this.dbPath,
      ruleCount: this.db.prepare("SELECT COUNT(*) AS count FROM detection_rules WHERE is_active = 1").get().count,
      brandAliasCount: this.db.prepare("SELECT COUNT(*) AS count FROM brand_aliases WHERE is_active = 1").get().count,
      senderProfileCount: this.db.prepare("SELECT COUNT(*) AS count FROM sender_profiles WHERE is_active = 1").get().count,
      fieldPatternCount: this.db.prepare("SELECT COUNT(*) AS count FROM field_patterns WHERE is_active = 1").get().count
    };
  }

  classifyMessage({ subject = "", body = "", attachments = [], fromEmail = "", projectBrands = [] }) {
    const scopes = {
      subject: String(subject || "").toLowerCase(),
      body: String(body || "").toLowerCase(),
      attachment: attachments.join(" ").toLowerCase(),
      domain: getDomain(fromEmail),
      all: [subject, body, attachments.join(" "), fromEmail].join("\n").toLowerCase()
    };

    const scores = { client: 0, spam: 0, vendor: 0 };
    const matchedRules = [];

    for (const rule of this.getRules()) {
      const haystack = scopes[rule.scope] ?? scopes.all;
      if (isRuleMatch(rule, haystack)) {
        scores[rule.classifier] = (scores[rule.classifier] || 0) + Number(rule.weight || 0);
        matchedRules.push({
          id: rule.id,
          classifier: rule.classifier,
          scope: rule.scope,
          pattern: rule.pattern,
          weight: rule.weight
        });
      }
    }

    const senderSignal = this.matchSenderProfile(fromEmail);
    if (senderSignal) {
      scores[senderSignal.classification] = (scores[senderSignal.classification] || 0) + 6;
      matchedRules.push({
        id: `sender:${senderSignal.id}`,
        classifier: senderSignal.classification,
        scope: senderSignal.sender_email ? "sender_email" : "sender_domain",
        pattern: senderSignal.sender_email || senderSignal.sender_domain,
        weight: 6
      });
    }

    if (fromEmail && !FREE_EMAIL_DOMAINS.has(getDomain(fromEmail))) {
      scores.client += 1;
    }

    const label = decideLabel(scores);
    const topScore = Math.max(scores.client, scores.spam, scores.vendor, 0);
    const totalScore = scores.client + scores.spam + scores.vendor;
    const confidence = topScore === 0 ? 0.35 : Math.min(0.99, 0.45 + topScore / Math.max(totalScore, 1) * 0.5);

    return {
      label,
      confidence: Number(confidence.toFixed(2)),
      scores,
      matchedRules: matchedRules.slice(0, 12),
      detectedBrands: this.detectBrands(scopes.all, projectBrands)
    };
  }

  detectBrands(text, projectBrands = []) {
    const lowered = String(text || "").toLowerCase();
    const aliases = this.getBrandAliases();
    const matched = aliases
      .filter((entry) => lowered.includes(entry.alias.toLowerCase()))
      .map((entry) => entry.canonical_brand);

    const projectMatched = (projectBrands || []).filter((brand) => lowered.includes(String(brand).toLowerCase()));
    return [...new Set([...matched, ...projectMatched])];
  }

  matchField(fieldName, text) {
    for (const pattern of this.getFieldPatterns(fieldName)) {
      const regex = new RegExp(pattern.pattern, "iu");
      const match = String(text || "").match(regex);
      if (match) {
        return match[1] || match[0];
      }
    }
    return null;
  }

  matchSenderProfile(fromEmail) {
    const domain = getDomain(fromEmail);
    return this.getSenderProfiles().find((profile) => {
      const byEmail = profile.sender_email && profile.sender_email.toLowerCase() === String(fromEmail || "").toLowerCase();
      const byDomain = profile.sender_domain && profile.sender_domain.toLowerCase() === domain;
      return byEmail || byDomain;
    }) || null;
  }
}

function isRuleMatch(rule, haystack) {
  if (!haystack) {
    return false;
  }

  if (rule.match_type === "contains") {
    return String(haystack).includes(String(rule.pattern).toLowerCase());
  }

  if (rule.match_type === "exact") {
    return String(haystack).trim() === String(rule.pattern).toLowerCase().trim();
  }

  if (rule.match_type === "regex") {
    return new RegExp(rule.pattern, "iu").test(String(haystack));
  }

  return false;
}

function decideLabel(scores) {
  const entries = [
    { label: "Клиент", score: scores.client || 0 },
    { label: "СПАМ", score: scores.spam || 0 },
    { label: "Поставщик услуг", score: scores.vendor || 0 }
  ].sort((left, right) => right.score - left.score);

  if (!entries[0] || entries[0].score <= 0) {
    return "Не определено";
  }

  if (entries[0].score === entries[1]?.score && entries[0].score < 4) {
    return "Не определено";
  }

  return entries[0].label;
}

function getDomain(fromEmail) {
  return String(fromEmail || "").split("@")[1]?.toLowerCase().trim() || "";
}

export const detectionKb = new DetectionKnowledgeBase();
