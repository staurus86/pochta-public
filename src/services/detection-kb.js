import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || "data");
const FREE_EMAIL_DOMAINS = new Set(["gmail.com", "mail.ru", "bk.ru", "list.ru", "inbox.ru", "yandex.ru", "ya.ru", "hotmail.com", "outlook.com", "icloud.com", "me.com", "live.com", "yahoo.com", "rambler.ru", "ro.ru", "autorambler.ru", "myrambler.ru", "lenta.ru", "aol.com", "protonmail.com", "proton.me", "zoho.com"]);

const DEFAULT_RULES = [
  { scope: "body", classifier: "spam", matchType: "regex", pattern: "casino|crypto|легкий заработок|раскрут(ка|им)|seo[- ]?продвиж|unsubscr|viagra|скидк|распродаж|кэшбэк|отписа|подписк|рассылк|промокод|sale", weight: 6, notes: "Базовый spam filter" },
  { scope: "subject", classifier: "spam", matchType: "regex", pattern: "скидк|распродаж|акци[яи]|кэшбэк|до\\s*-?\\d+%|промокод|sale", weight: 5, notes: "Маркетинговый spam subject" },
  { scope: "body", classifier: "client", matchType: "regex", pattern: "заявк|коммерческ|прошу|нужн|артикул|шильдик|кол-?во|счет|quotation|rfq|price request|цена(?:\\b|\\s)|цены(?:\\b|\\s)", weight: 3, notes: "Клиентские сигналы" },
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
  { canonicalBrand: "Endress & Hauser", alias: "hauser" },
  { canonicalBrand: "Siemens", alias: "siemens" },
  { canonicalBrand: "Eaton", alias: "eaton" },
  { canonicalBrand: "Phoenix Contact", alias: "phoenix contact" },
  { canonicalBrand: "Phoenix Contact", alias: "phoenix" },
  { canonicalBrand: "Weidmuller", alias: "weidmuller" },
  { canonicalBrand: "Weidmuller", alias: "weidmüller" },
  { canonicalBrand: "Rittal", alias: "rittal" },
  { canonicalBrand: "Pepperl+Fuchs", alias: "pepperl" },
  { canonicalBrand: "Pepperl+Fuchs", alias: "fuchs" },
  { canonicalBrand: "Festo", alias: "festo" },
  { canonicalBrand: "Danfoss", alias: "danfoss" },
  { canonicalBrand: "Kiesel", alias: "kiesel" },
  { canonicalBrand: "Turck", alias: "turck" },
  { canonicalBrand: "Pilz", alias: "pilz" },
  { canonicalBrand: "WAGO", alias: "wago" },
  { canonicalBrand: "Omron", alias: "omron" },
  { canonicalBrand: "Sick", alias: "sick" },
  { canonicalBrand: "Balluff", alias: "balluff" }
];

const DEFAULT_FIELD_PATTERNS = [
  // Company names with quotes: ООО «Ромашка», АО "Техно"
  { fieldName: "company_name", pattern: "(ООО\\s+[\"«][^\"»]+[\"»])", priority: 100 },
  { fieldName: "company_name", pattern: "(АО\\s+[\"«][^\"»]+[\"»])", priority: 100 },
  { fieldName: "company_name", pattern: "(ОАО\\s+[\"«][^\"»]+[\"»])", priority: 100 },
  { fieldName: "company_name", pattern: "(ЗАО\\s+[\"«][^\"»]+[\"»])", priority: 100 },
  { fieldName: "company_name", pattern: "(ПАО\\s+[\"«][^\"»]+[\"»])", priority: 100 },
  { fieldName: "company_name", pattern: "(ФГУП\\s+[\"«][^\"»]+[\"»])", priority: 100 },
  { fieldName: "company_name", pattern: "(МУП\\s+[\"«][^\"»]+[\"»])", priority: 100 },
  { fieldName: "company_name", pattern: "(ГУП\\s+[\"«][^\"»]+[\"»])", priority: 100 },
  { fieldName: "company_name", pattern: "(НПО\\s+[\"«][^\"»]+[\"»])", priority: 100 },
  { fieldName: "company_name", pattern: "(НПП\\s+[\"«][^\"»]+[\"»])", priority: 100 },
  // Company names without quotes: ООО Ромашка, АО Техно (capitalized word after)
  { fieldName: "company_name", pattern: "(ООО\\s+[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9\\s-]{2,40})", priority: 85 },
  { fieldName: "company_name", pattern: "(АО\\s+[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9\\s-]{2,40})", priority: 85 },
  { fieldName: "company_name", pattern: "(ОАО\\s+[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9\\s-]{2,40})", priority: 85 },
  { fieldName: "company_name", pattern: "(ЗАО\\s+[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9\\s-]{2,40})", priority: 85 },
  { fieldName: "company_name", pattern: "(ПАО\\s+[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9\\s-]{2,40})", priority: 85 },
  { fieldName: "company_name", pattern: "(ФГУП\\s+[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9\\s-]{2,40})", priority: 85 },
  { fieldName: "company_name", pattern: "(МУП\\s+[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9\\s-]{2,40})", priority: 85 },
  { fieldName: "company_name", pattern: "(НПО\\s+[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9\\s-]{2,40})", priority: 85 },
  { fieldName: "company_name", pattern: "(НПП\\s+[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9\\s-]{2,40})", priority: 85 },
  // ИП Фамилия Имя
  { fieldName: "company_name", pattern: "(?<![А-ЯЁа-яё])(ИП\\s+[А-ЯЁ][а-яё]+(?:\\s+[А-ЯЁ][а-яё]+){1,2})", priority: 80 },
  // Завод, фабрика, комбинат as part of company name
  { fieldName: "company_name", pattern: "([А-ЯЁ][А-ЯЁа-яё-]+\\s+(?:завод|фабрика|комбинат|предприятие))", priority: 75 },
  { fieldName: "company_name", pattern: "((?:завод|фабрика|комбинат)\\s+[\"«][^\"»]+[\"»])", priority: 80 },
  // International: Company Name GmbH/AG/Ltd/LLC
  { fieldName: "company_name", pattern: "([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,3}\\s+(?:GmbH|AG|Ltd\\.?|LLC|Inc\\.?|SE|S\\.A\\.|B\\.V\\.|Co\\.?|Corp\\.?|PLC|Pty|S\\.r\\.l\\.))", priority: 90 },
  { fieldName: "position", pattern: "генеральный директор", priority: 100 },
  { fieldName: "position", pattern: "коммерческий директор", priority: 95 },
  { fieldName: "position", pattern: "технический директор", priority: 95 },
  { fieldName: "position", pattern: "заместитель директора", priority: 90 },
  { fieldName: "position", pattern: "менеджер по закупкам", priority: 90 },
  { fieldName: "position", pattern: "начальник отдела", priority: 85 },
  { fieldName: "position", pattern: "руководитель отдела", priority: 85 },
  { fieldName: "position", pattern: "главный инженер", priority: 85 },
  { fieldName: "position", pattern: "ведущий инженер", priority: 80 },
  { fieldName: "position", pattern: "специалист по закупкам", priority: 80 },
  { fieldName: "position", pattern: "менеджер", priority: 70 },
  { fieldName: "position", pattern: "инженер", priority: 60 },
  { fieldName: "position", pattern: "специалист", priority: 55 },
  { fieldName: "position", pattern: "снабженец", priority: 50 },
  { fieldName: "signature_hint", pattern: "(?:с уважением|best regards|спасибо|kind regards|regards)[,\\s]*\\n+([А-ЯЁ][а-яё]+(?:\\s+[А-ЯЁ][а-яё]+){1,2})", priority: 100 },
  { fieldName: "signature_hint", pattern: "(?:--|_{3,}|={3,})\\s*\\n+([А-ЯЁ][а-яё]+(?:\\s+[А-ЯЁ][а-яё]+){1,2})", priority: 80 }
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

      CREATE TABLE IF NOT EXISTS message_corpus (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        message_key TEXT NOT NULL UNIQUE,
        mailbox TEXT DEFAULT '',
        sender_email TEXT DEFAULT '',
        subject TEXT DEFAULT '',
        classification TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0,
        company_name TEXT DEFAULT '',
        brand_names TEXT DEFAULT '',
        body_excerpt TEXT DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS extracted_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_key TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_value TEXT DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS own_brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        notes TEXT DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS api_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        project_ids TEXT DEFAULT '',
        webhook_url TEXT DEFAULT '',
        webhook_secret TEXT DEFAULT '',
        webhook_statuses TEXT DEFAULT 'ready_for_crm,needs_clarification',
        created_at TEXT NOT NULL,
        notes TEXT DEFAULT ''
      );
    `);

    // FTS5 virtual table for full-text search over message corpus
    // Uses external content mode — synced via explicit rebuild after ingestion
    // Drop legacy triggers if they exist (they conflict with upsert)
    this.db.exec(`DROP TRIGGER IF EXISTS message_corpus_ai`);
    this.db.exec(`DROP TRIGGER IF EXISTS message_corpus_ad`);
    this.db.exec(`DROP TRIGGER IF EXISTS message_corpus_au`);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS message_corpus_fts USING fts5(
        subject,
        body_excerpt,
        sender_email,
        company_name,
        brand_names,
        content='message_corpus',
        content_rowid='id'
      );
    `);

    // Rebuild FTS index on startup to sync with corpus
    try {
      const corpusCount = this.db.prepare("SELECT COUNT(*) as n FROM message_corpus").get().n;
      if (corpusCount > 0) {
        this.db.exec("INSERT INTO message_corpus_fts(message_corpus_fts) VALUES('rebuild')");
      }
    } catch {
      // FTS rebuild is best-effort
    }

    this.seedDefaults();
    this.seedOwnBrands();
    this.seedBrandCatalog();
    this.migrateLegacyRules();
  }

  seedDefaults() {
    const insertRule = this.db.prepare(`
      INSERT INTO detection_rules (scope, classifier, match_type, pattern, weight, notes)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM detection_rules
        WHERE scope = ? AND classifier = ? AND match_type = ? AND pattern = ?
      )
    `);
    for (const rule of DEFAULT_RULES) {
      insertRule.run(
        rule.scope,
        rule.classifier,
        rule.matchType,
        rule.pattern,
        rule.weight,
        rule.notes,
        rule.scope,
        rule.classifier,
        rule.matchType,
        rule.pattern
      );
    }

    const insertBrand = this.db.prepare(`
      INSERT INTO brand_aliases (canonical_brand, alias)
      SELECT ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM brand_aliases
        WHERE canonical_brand = ? AND alias = ?
      )
    `);
    for (const alias of DEFAULT_BRAND_ALIASES) {
      insertBrand.run(alias.canonicalBrand, alias.alias, alias.canonicalBrand, alias.alias);
    }

    const insertField = this.db.prepare(`
      INSERT INTO field_patterns (field_name, pattern, priority)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM field_patterns
        WHERE field_name = ? AND pattern = ?
      )
    `);
    for (const field of DEFAULT_FIELD_PATTERNS) {
      insertField.run(field.fieldName, field.pattern, field.priority, field.fieldName, field.pattern);
    }
  }

  seedOwnBrands() {
    const defaults = [
      "siderus", "сидерус", "klvrt", "коловрат",
      "ersab2b", "ersa b2b", "ersa"
    ];
    const insert = this.db.prepare(`
      INSERT INTO own_brands (name) SELECT ?
      WHERE NOT EXISTS (SELECT 1 FROM own_brands WHERE name = ?)
    `);
    for (const name of defaults) {
      insert.run(name, name);
    }
  }

  seedBrandCatalog() {
    // Try multiple locations: dataDir (volume), then app root data/
    const candidates = [
      path.join(this.dataDir, "brand-catalog.json"),
      path.resolve(process.cwd(), "data", "brand-catalog.json")
    ];
    for (const catalogPath of candidates) {
      if (!existsSync(catalogPath)) continue;
      try {
        const brands = JSON.parse(readFileSync(catalogPath, "utf8"));
        const result = this.importBrandCatalog(brands);
        if (result.added > 0) {
          console.log(`[detection-kb] Brand catalog: +${result.added} aliases (${result.total} total) from ${catalogPath}`);
        }
        return;
      } catch (err) {
        console.error("[detection-kb] Failed to seed brand catalog:", err.message);
      }
    }
  }

  getOwnBrands() {
    return this.db.prepare("SELECT * FROM own_brands WHERE is_active = 1 ORDER BY name").all();
  }

  getOwnBrandNames() {
    return new Set(
      this.db.prepare("SELECT name FROM own_brands WHERE is_active = 1").all()
        .map((row) => row.name.toLowerCase())
    );
  }

  addOwnBrand(payload) {
    const name = String(payload.name || "").trim().toLowerCase();
    if (!name) return null;
    const statement = this.db.prepare(`
      INSERT INTO own_brands (name, notes) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET is_active = 1, notes = excluded.notes
    `);
    statement.run(name, payload.notes || "");
    return this.db.prepare("SELECT * FROM own_brands WHERE name = ?").get(name);
  }

  deactivateOwnBrand(id) {
    this.db.prepare("UPDATE own_brands SET is_active = 0 WHERE id = ?").run(Number(id));
    return { id, deactivated: true };
  }

  isOwnBrand(brandName) {
    const lowered = String(brandName || "").toLowerCase();
    return this.getOwnBrandNames().has(lowered);
  }

  filterOwnBrands(brands) {
    const ownNames = this.getOwnBrandNames();
    return (brands || []).filter((b) => !ownNames.has(String(b).toLowerCase()));
  }

  // ── API Clients ──

  getApiClients() {
    return this.db.prepare("SELECT * FROM api_clients ORDER BY created_at DESC").all()
      .map(normalizeApiClientRow);
  }

  getApiClient(id) {
    const row = this.db.prepare("SELECT * FROM api_clients WHERE id = ?").get(id);
    return row ? normalizeApiClientRow(row) : null;
  }

  createApiClient(payload) {
    const id = `client-${Date.now().toString(36)}`;
    const apiKey = `sk-${randomHex(32)}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO api_clients (id, name, api_key, enabled, project_ids, webhook_url, webhook_secret, webhook_statuses, created_at, notes)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      String(payload.name || "New Client").trim(),
      apiKey,
      (payload.projectIds || []).join(","),
      String(payload.webhookUrl || "").trim(),
      String(payload.webhookSecret || "").trim(),
      String(payload.webhookStatuses || "ready_for_crm,needs_clarification").trim(),
      now,
      String(payload.notes || "").trim()
    );
    return this.getApiClient(id);
  }

  updateApiClient(id, payload) {
    const existing = this.getApiClient(id);
    if (!existing) return null;
    const fields = [];
    const values = [];
    if (payload.name !== undefined) { fields.push("name = ?"); values.push(String(payload.name).trim()); }
    if (payload.enabled !== undefined) { fields.push("enabled = ?"); values.push(payload.enabled ? 1 : 0); }
    if (payload.projectIds !== undefined) { fields.push("project_ids = ?"); values.push(Array.isArray(payload.projectIds) ? payload.projectIds.join(",") : String(payload.projectIds)); }
    if (payload.webhookUrl !== undefined) { fields.push("webhook_url = ?"); values.push(String(payload.webhookUrl).trim()); }
    if (payload.webhookSecret !== undefined) { fields.push("webhook_secret = ?"); values.push(String(payload.webhookSecret).trim()); }
    if (payload.webhookStatuses !== undefined) { fields.push("webhook_statuses = ?"); values.push(String(payload.webhookStatuses).trim()); }
    if (payload.notes !== undefined) { fields.push("notes = ?"); values.push(String(payload.notes).trim()); }
    if (fields.length === 0) return existing;
    values.push(id);
    this.db.prepare(`UPDATE api_clients SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getApiClient(id);
  }

  deleteApiClient(id) {
    this.db.prepare("DELETE FROM api_clients WHERE id = ?").run(id);
    return { id, deleted: true };
  }

  regenerateApiKey(id) {
    const newKey = `sk-${randomHex(32)}`;
    this.db.prepare("UPDATE api_clients SET api_key = ? WHERE id = ?").run(newKey, id);
    return this.getApiClient(id);
  }

  getApiClientsForAuth() {
    return this.db.prepare("SELECT * FROM api_clients WHERE enabled = 1").all()
      .map(normalizeApiClientRow);
  }

  importBrandCatalog(brands) {
    const insertAlias = this.db.prepare(`
      INSERT INTO brand_aliases (canonical_brand, alias)
      SELECT ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM brand_aliases WHERE canonical_brand = ? AND alias = ?
      )
    `);
    let added = 0;
    let skipped = 0;
    for (const brand of brands) {
      const canonical = String(brand.canonical || brand.brand || "").trim();
      if (!canonical) continue;
      for (const alias of (brand.aliases || [])) {
        const a = String(alias || "").trim().toLowerCase();
        if (!a || a.length < 2) continue;
        const result = insertAlias.run(canonical, a, canonical, a);
        if (Number(result.changes) > 0) {
          added++;
        } else {
          skipped++;
        }
      }
    }
    return { added, skipped, total: this.db.prepare("SELECT COUNT(*) AS count FROM brand_aliases WHERE is_active = 1").get().count };
  }

  clearBrandAliases() {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM brand_aliases").get().count;
    this.db.prepare("DELETE FROM brand_aliases").run();
    return { deactivated: count };
  }

  migrateLegacyRules() {
    this.db.prepare(`
      UPDATE detection_rules
      SET pattern = ?, notes = ?
      WHERE scope = 'body'
        AND classifier = 'client'
        AND match_type = 'regex'
        AND pattern = ?
    `).run(
      "заявк|коммерческ|прошу|нужн|артикул|шильдик|кол-?во|счет|quotation|rfq|price request|цена(?:\\b|\\s)|цены(?:\\b|\\s)",
      "Клиентские сигналы",
      "заявк|коммерческ|прошу|нужн|артикул|шильдик|кол-?во|счет|цен"
    );

    // Fix ИП pattern: add negative lookbehind to prevent "Тип" → "ип" match
    this.db.prepare(`
      UPDATE field_patterns
      SET pattern = ?
      WHERE field_name = 'company_name'
        AND pattern = ?
    `).run(
      "(?<![А-ЯЁа-яё])(ИП\\s+[А-ЯЁ][а-яё]+(?:\\s+[А-ЯЁ][а-яё]+){1,2})",
      "(ИП\\s+[А-ЯЁ][а-яё]+(?:\\s+[А-ЯЁ][а-яё]+){1,2})"
    );
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

  deactivateRule(id) {
    this.db.prepare("UPDATE detection_rules SET is_active = 0 WHERE id = ?").run(Number(id));
    return { id, deactivated: true };
  }

  deactivateSenderProfile(id) {
    this.db.prepare("UPDATE sender_profiles SET is_active = 0 WHERE id = ?").run(Number(id));
    return { id, deactivated: true };
  }

  deactivateBrandAlias(id) {
    this.db.prepare("UPDATE brand_aliases SET is_active = 0 WHERE id = ?").run(Number(id));
    return { id, deactivated: true };
  }

  getStats() {
    return {
      dbPath: this.dbPath,
      ruleCount: this.db.prepare("SELECT COUNT(*) AS count FROM detection_rules WHERE is_active = 1").get().count,
      brandAliasCount: this.db.prepare("SELECT COUNT(*) AS count FROM brand_aliases WHERE is_active = 1").get().count,
      senderProfileCount: this.db.prepare("SELECT COUNT(*) AS count FROM sender_profiles WHERE is_active = 1").get().count,
      fieldPatternCount: this.db.prepare("SELECT COUNT(*) AS count FROM field_patterns WHERE is_active = 1").get().count,
      ownBrandCount: this.db.prepare("SELECT COUNT(*) AS count FROM own_brands WHERE is_active = 1").get().count,
      corpusCount: this.db.prepare("SELECT COUNT(*) AS count FROM message_corpus").get().count
    };
  }

  getCorpus(limit = 50, projectId = null) {
    if (projectId) {
      return this.db.prepare(`
        SELECT * FROM message_corpus
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(projectId, Number(limit));
    }

    return this.db.prepare(`
      SELECT * FROM message_corpus
      ORDER BY created_at DESC
      LIMIT ?
    `).all(Number(limit));
  }

  searchCorpus(query, { projectId = null, limit = 50 } = {}) {
    // Escape FTS5 special characters and add prefix matching
    const sanitized = String(query || "")
      .replace(/['"*():^~{}[\]\\]/g, " ")
      .trim();
    if (!sanitized) return this.getCorpus(limit, projectId);

    const ftsQuery = sanitized
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w}"*`)
      .join(" ");

    if (projectId) {
      return this.db.prepare(`
        SELECT mc.* FROM message_corpus mc
        JOIN message_corpus_fts fts ON mc.id = fts.rowid
        WHERE message_corpus_fts MATCH ?
          AND mc.project_id = ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, projectId, Number(limit));
    }

    return this.db.prepare(`
      SELECT mc.* FROM message_corpus mc
      JOIN message_corpus_fts fts ON mc.id = fts.rowid
      WHERE message_corpus_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, Number(limit));
  }

  rebuildFtsIndex() {
    this.db.exec(`
      INSERT INTO message_corpus_fts(message_corpus_fts) VALUES('rebuild');
    `);
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
      detectedBrands: this.detectBrands([scopes.subject, scopes.body, scopes.attachment].join("\n"), projectBrands)
    };
  }

  detectBrands(text, projectBrands = []) {
    const lowered = String(text || "").toLowerCase();
    const padded = ` ${lowered} `;
    const aliases = this.getBrandAliases();
    const matched = aliases
      .filter((entry) => {
        const alias = entry.alias.toLowerCase();
        // Short aliases (< 4 chars like "ilt", "smc", "abb") require word boundary
        if (alias.length < 4) {
          return new RegExp(`\\b${escapeRegex(alias)}\\b`, "i").test(lowered);
        }
        return padded.includes(alias);
      })
      .map((entry) => entry.canonical_brand);

    const projectMatched = (projectBrands || []).filter((brand) => {
      const b = String(brand).toLowerCase();
      if (b.length < 4) {
        return new RegExp(`\\b${escapeRegex(b)}\\b`, "i").test(lowered);
      }
      return padded.includes(b);
    });
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

  ingestAnalyzedMessages(projectId, messages = []) {
    const insertCorpus = this.db.prepare(`
      INSERT INTO message_corpus (
        project_id, message_key, mailbox, sender_email, subject, classification,
        confidence, company_name, brand_names, body_excerpt, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_key) DO UPDATE SET
        classification=excluded.classification,
        confidence=excluded.confidence,
        company_name=excluded.company_name,
        brand_names=excluded.brand_names,
        body_excerpt=excluded.body_excerpt,
        created_at=excluded.created_at
    `);

    const deleteFields = this.db.prepare(`DELETE FROM extracted_fields WHERE message_key = ?`);
    const insertField = this.db.prepare(`
      INSERT INTO extracted_fields (message_key, field_name, field_value, confidence, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const item of messages) {
      if (!item.messageKey || item.pipelineStatus === "ignored_spam" || item.error) {
        continue;
      }

      insertCorpus.run(
        projectId,
        item.messageKey,
        item.mailbox || "",
        item.analysis?.sender?.email || "",
        item.subject || "",
        item.analysis?.classification?.label || "Не определено",
        Number(item.analysis?.classification?.confidence || 0),
        item.analysis?.sender?.companyName || "",
        JSON.stringify(item.analysis?.detectedBrands || []),
        String(item.analysis?.lead?.freeText || "").slice(0, 500),
        now
      );

      deleteFields.run(item.messageKey);
      const fieldEntries = [
        ["sender_email", item.analysis?.sender?.email],
        ["sender_name", item.analysis?.sender?.fullName],
        ["sender_position", item.analysis?.sender?.position],
        ["company_name", item.analysis?.sender?.companyName],
        ["website", item.analysis?.sender?.website],
        ["city_phone", item.analysis?.sender?.cityPhone],
        ["mobile_phone", item.analysis?.sender?.mobilePhone],
        ["inn", item.analysis?.sender?.inn],
        ["request_type", item.analysis?.lead?.requestType],
        ["articles", JSON.stringify(item.analysis?.lead?.articles || [])],
        ["brands", JSON.stringify(item.analysis?.detectedBrands || [])]
      ].filter((entry) => entry[1]);

      for (const [fieldName, fieldValue] of fieldEntries) {
        insertField.run(item.messageKey, fieldName, String(fieldValue), Number(item.analysis?.classification?.confidence || 0), now);
      }
    }

    // Rebuild FTS index after batch ingestion
    try {
      this.db.exec("INSERT INTO message_corpus_fts(message_corpus_fts) VALUES('rebuild')");
    } catch {
      // best-effort
    }
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

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function randomHex(length) {
  return randomBytes(length / 2).toString("hex");
}

function normalizeApiClientRow(row) {
  return {
    id: row.id,
    name: row.name,
    apiKey: row.api_key,
    enabled: Boolean(row.enabled),
    projectIds: String(row.project_ids || "").split(",").filter(Boolean),
    webhookUrl: row.webhook_url || null,
    webhookSecret: row.webhook_secret || "",
    webhookStatuses: String(row.webhook_statuses || "").split(",").filter(Boolean),
    createdAt: row.created_at,
    notes: row.notes || ""
  };
}

export const detectionKb = new DetectionKnowledgeBase();
