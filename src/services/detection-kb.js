import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || "data");
const FREE_EMAIL_DOMAINS = new Set(["gmail.com", "mail.ru", "bk.ru", "list.ru", "inbox.ru", "yandex.ru", "ya.ru", "hotmail.com", "outlook.com", "icloud.com", "me.com", "live.com", "yahoo.com", "rambler.ru", "ro.ru", "autorambler.ru", "myrambler.ru", "lenta.ru", "aol.com", "protonmail.com", "proton.me", "zoho.com"]);
const BRAND_FALSE_POSITIVE_ALIASES = new Set(["top", "moro", "ydra", "hydra", "global"]);
// Aliases that must match as whole words only (prevent substring false positives like "puls" inside "vegapuls")
const BRAND_WORD_BOUNDARY_ALIASES = new Set(["puls"]);

const DEFAULT_RULES = [
  { scope: "body", classifier: "spam", matchType: "regex", pattern: "casino|crypto|легкий заработок|раскрут(ка|им)|seo[- ]?продвиж|unsubscr|viagra|скидк|распродаж|кэшбэк|отписа|подписк|рассылк|промокод|sale|выиграли|лотере", weight: 6, notes: "Базовый spam filter" },
  { scope: "subject", classifier: "spam", matchType: "regex", pattern: "скидк|распродаж|акци[яи]|кэшбэк|до\\s*-?\\d+%|промокод|sale|free|бесплатн", weight: 5, notes: "Маркетинговый spam subject" },
  { scope: "body", classifier: "spam", matchType: "regex", pattern: "управлени[ея]\\s+подписк|unsubscribe|opt.out|отказаться\\s+от\\s+рассылки|email\\s+preference|email.marketing", weight: 4, notes: "Рассылочные сигналы в теле" },
  { scope: "body", classifier: "client", matchType: "regex", pattern: "заявк|коммерческ|прошу|нужн|артикул|шильдик|кол-?во|счет|quotation|rfq|price request|цена(?:\\b|\\s)|цены(?:\\b|\\s)|просим|потребность", weight: 3, notes: "Клиентские сигналы" },
  { scope: "body", classifier: "client", matchType: "regex", pattern: "нужен|нужна(?!ш)|просьба|кп|цену|цена|цене|наличии|наличие|в наличии|сообщите|подскажите|помогите|под заказ", weight: 3, notes: "Клиентские сигналы (расширенные формы)" },
  { scope: "body", classifier: "client", matchType: "regex", pattern: "наличие\\s+на\\s+складе|сроки\\s+поставки|с\\s+доставкой|просьба\\s+выставить|реквизиты\\s+прилагаются|карточка\\s+предприятия", weight: 4, notes: "Сильные клиентские сигналы" },
  { scope: "body", classifier: "client", matchType: "regex", pattern: "(?:ООО|АО|ОАО|ЗАО|ПАО|ФГУП|МУП|ГУП)\\s+[\"«]", weight: 3, notes: "Легальная форма организации в теле — признак B2B клиента" },
  { scope: "body", classifier: "vendor", matchType: "regex", pattern: "предлагаем\\s+(?:вам|услуг|сотрудничеств)|предложить вам|предложить продукцию|хотел бы предложить|наша\\s+компания\\s+предлагает|каталог\\s+продукции|являемся\\s+(?:дилер|поставщик|производител)|прайс.?лист", weight: 4, notes: "Поставщик услуг (точные паттерны)" },
  { scope: "body", classifier: "vendor", matchType: "regex", pattern: "предлагаем|каталог|дилер|поставля|прайс|услуг", weight: 2, notes: "Поставщик услуг (слабые сигналы)" },
  { scope: "subject", classifier: "client", matchType: "regex", pattern: "заявка|rfq|запрос|quotation|коммерческое|кп\\b|предложение", weight: 4, notes: "Клиентский subject" },
  { scope: "attachment", classifier: "client", matchType: "regex", pattern: "реквиз|шильд|артик|sku|label|спецификац|заявк|техзадан", weight: 2, notes: "Полезные вложения" },
  { scope: "domain", classifier: "spam", matchType: "contains", pattern: "unsubscribe", weight: 4, notes: "Доменные spam сигналы" },
  { scope: "body", classifier: "spam", matchType: "regex", pattern: "(?:noreply|no-reply|mailer-daemon|postmaster)@.*(?:не\\s+отвечайте|do\\s+not\\s+reply)", weight: 5, notes: "Системные уведомления" },
  { scope: "body", classifier: "spam", matchType: "regex", pattern: "(?:просмотреть|открыть)\\s+(?:в\\s+браузере|онлайн)|view\\s+(?:in\\s+browser|this\\s+email\\s+online|email\\s+in\\s+browser)|если\\s+(?:это\\s+письмо|письмо\\s+не).{0,50}(?:открыва|отображ|корректно)", weight: 5, notes: "HTML-рассылка (view in browser)" },
  { scope: "body", classifier: "spam", matchType: "regex", pattern: "вакансия|резюме\\s+(?:на\\s+должность|кандидат)|headhunter|hh\\.ru|superjob\\.ru|подбор\\s+персонала|поиск\\s+(?:сотрудников|кандидатов)|job\\s+offer|career\\s+opportunity", weight: 5, notes: "HR/рекрутинг спам" },
  { scope: "subject", classifier: "spam", matchType: "regex", pattern: "вакансия|резюме|трудоустройство|подбор\\s+персонала|job\\s+offer|career\\s+opportunity", weight: 5, notes: "HR тема" },
  { scope: "body", classifier: "spam", matchType: "regex", pattern: "(?:СДЭК|DHL|DPD|EMS|FedEx|Boxberry|PONY\\s*EXPRESS|Почта\\s+России)\\s+(?:уведомляет|сообщает|информирует|напоминает)|трек.?номер\\s*[:\\-]?\\s*[A-Z0-9]{6,}|пункт\\s+выдачи\\s+(?:вашего\\s+)?(?:заказа|посылки|отправления)|статус\\s+(?:вашей\\s+)?(?:доставки|посылки|отправления)", weight: 4, notes: "Уведомления служб доставки" },
  { scope: "body", classifier: "spam", matchType: "regex", pattern: "выписка\\s+по\\s+(?:карте|счёту|счету|вкладу|договору)|интернет.?банк|мобильн.{0,10}банк.{0,20}(?:уведомля|сообщает)|платёж\\s+(?:принят|отклонён|проведён|выполнен)|операция\\s+по\\s+(?:карте|счёту|счету)\\s+(?:на\\s+сумму|проведена|отклонена)", weight: 4, notes: "Банковские уведомления" },
  { scope: "body", classifier: "spam", matchType: "regex", pattern: "продление\\s+(?:домена|хостинга|ssl)|(?:домен|хостинг|ssl\\s+сертификат).{0,50}(?:истека|заканчивается|истёк|продлит)|оплатите\\s+(?:домен|хостинг)|срок\\s+действия.{0,30}(?:домена|сертификата).{0,30}(?:истека|заканчивается)", weight: 5, notes: "Домен/хостинг спам" },
  { scope: "subject", classifier: "spam", matchType: "regex", pattern: "уведомление\\s+о\\s+(?:доставке|платеже|переводе|заказе|статусе)|заказ\\s+(?:доставлен|отправлен|получен|передан)|выписка|квитанция|счёт-фактура\\s+сформирована|трек.?номер|доставлено\\s+в\\s+пункт", weight: 4, notes: "Subject системных уведомлений" },
  { scope: "subject", classifier: "spam", matchType: "regex", pattern: "\\[\\*+SPAM\\*+|\\[SPAM\\b", weight: 8, notes: "Email-сервер пометил как спам ([***SPAM***])" },
  { scope: "subject", classifier: "spam", matchType: "regex", pattern: "приглаша[её]т принять участие в (?:тендере|закупке|процедур[её]?|торгах)|приглашаем.{0,20}к участию в (?:закупке|тендере|торгах)|приглашение на\\s+тендер|приглашение\\s+на\\s+закупку", weight: 6, notes: "B2B тендерный/закупочный спам в теме" },
  { scope: "body", classifier: "spam", matchType: "regex", pattern: "приглаша[её]т принять участие в (?:тендере|закупке|процедур[её]?|торгах)|приглашаем.{0,20}к участию в (?:закупке|тендере|торгах)", weight: 5, notes: "B2B тендерный/закупочный спам в теле" },
  { scope: "subject", classifier: "spam", matchType: "regex", pattern: "вебинар|онлайн.(?:семинар|конференц|форум)|\\d+\\s+дней\\s+до\\s+(?:вебинара|семинара)|присоединяйтесь к", weight: 5, notes: "Вебинар/семинар приглашения в теме" },
  { scope: "body", classifier: "spam", matchType: "regex", pattern: "зарегистрируйтесь.{0,40}(?:сейчас|бесплатно|на вебинар)|бесплатная регистрация\\s+на\\s+(?:вебинар|семинар|конференц)|участвуйте в (?:вебинаре|семинаре|конференции)|записаться на вебинар", weight: 4, notes: "Регистрация на вебинар/мероприятие" }
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

const DEFAULT_SENDER_PROFILES = [
  { senderEmail: "noreply-oplata@cdek.ru",              senderDomain: "",                        classification: "spam",   companyHint: "", notes: "СДЭК — платёжные уведомления" },
  { senderEmail: "",                                    senderDomain: "mail.instagram.com",       classification: "spam",   companyHint: "", notes: "Instagram — сервисные нотификации" },
  { senderEmail: "portal-identity@globus.ru",           senderDomain: "",                        classification: "spam",   companyHint: "", notes: "Глобус — уведомления поставщику" },
  { senderEmail: "info@obed.ru",                        senderDomain: "",                        classification: "spam",   companyHint: "", notes: "Обед.ру — сервисные уведомления" },
  { senderEmail: "145@siderus.ru",                      senderDomain: "",                        classification: "spam",   companyHint: "", notes: "Siderus внутренний ящик — не клиент" },
  // SPAM — service notifications / promo / offers
  { senderEmail: "",                                    senderDomain: "obed.ru",                  classification: "spam",   companyHint: "", notes: "Обед.ру — домен целиком (balance/service notifications)" },
  { senderEmail: "",                                    senderDomain: "elecrow.com",              classification: "spam",   companyHint: "", notes: "Elecrow — рекламные рассылки" },
  { senderEmail: "",                                    senderDomain: "tektorg.ru",               classification: "spam",   companyHint: "", notes: "ТЭК-Торг — предложения банковских гарантий" },
  { senderEmail: "",                                    senderDomain: "1c-uc.ru",                 classification: "spam",   companyHint: "", notes: "УЦ1/1С — рассылки об учебных курсах" },
  // VENDOR — logistics / supply-from-China offers
  { senderEmail: "",                                    senderDomain: "cdek.ru",                  classification: "vendor", companyHint: "СДЭК", notes: "СДЭК — документы и предложения по логистике" },
  { senderEmail: "",                                    senderDomain: "slacnc.com",               classification: "vendor", companyHint: "", notes: "SLACNC — китайский производитель калибров" },
  { senderEmail: "",                                    senderDomain: "eayglobal.com",             classification: "vendor", companyHint: "EAY Global", notes: "EAY Global — предложения поставки из Китая" },
  { senderEmail: "",                                    senderDomain: "globalpost.ru",             classification: "vendor", companyHint: "ГлобалПост", notes: "ГлобалПост — предложения логистики" },
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
    this.cache = {
      rules: null,
      brandAliases: null,
      senderProfiles: null,
      ownBrandNames: null,
      ownBrands: null,
      fieldPatterns: new Map()
    };
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
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

      CREATE TABLE IF NOT EXISTS company_directory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        inn TEXT DEFAULT '',
        okved TEXT DEFAULT '',
        okved_title TEXT DEFAULT '',
        contact_name TEXT DEFAULT '',
        contact_position TEXT DEFAULT '',
        email TEXT DEFAULT '',
        email_domain TEXT DEFAULT '',
        greeting TEXT DEFAULT '',
        source_file TEXT DEFAULT '',
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

      CREATE TABLE IF NOT EXISTS api_client_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        preset_key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        query_json TEXT NOT NULL DEFAULT '{}',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(client_id, preset_key)
      );

      CREATE TABLE IF NOT EXISTS nomenclature_dictionary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article TEXT NOT NULL,
        article_normalized TEXT NOT NULL UNIQUE,
        brand TEXT DEFAULT '',
        product_name TEXT DEFAULT '',
        description TEXT DEFAULT '',
        synonyms TEXT DEFAULT '[]',
        source_deal_ids TEXT DEFAULT '[]',
        source_rows INTEGER NOT NULL DEFAULT 0,
        total_quantity REAL NOT NULL DEFAULT 0,
        min_price REAL,
        max_price REAL,
        avg_price REAL,
        last_imported_at TEXT NOT NULL,
        source_file TEXT DEFAULT ''
      );
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_message_corpus_project_created
        ON message_corpus(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_company_directory_email
        ON company_directory(email);
      CREATE INDEX IF NOT EXISTS idx_company_directory_domain
        ON company_directory(email_domain);
      CREATE INDEX IF NOT EXISTS idx_company_directory_inn
        ON company_directory(inn);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_company_directory_email_unique
        ON company_directory(email);
      CREATE INDEX IF NOT EXISTS idx_nomenclature_brand
        ON nomenclature_dictionary(brand);
      CREATE INDEX IF NOT EXISTS idx_nomenclature_source_rows
        ON nomenclature_dictionary(source_rows DESC);
      CREATE INDEX IF NOT EXISTS idx_nomenclature_avg_price
        ON nomenclature_dictionary(avg_price);
      CREATE INDEX IF NOT EXISTS idx_api_client_presets_client
        ON api_client_presets(client_id, project_id, is_active, preset_key);
      CREATE INDEX IF NOT EXISTS idx_message_corpus_sender
        ON message_corpus(sender_email, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_message_corpus_classification
        ON message_corpus(classification, created_at DESC);
    `);

    this.ensureApiClientPresetProjectScopeColumn();

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

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS nomenclature_dictionary_fts USING fts5(
        article,
        brand,
        product_name,
        description,
        synonyms,
        content='nomenclature_dictionary',
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

    try {
      const nomenclatureCount = this.db.prepare("SELECT COUNT(*) as n FROM nomenclature_dictionary").get().n;
      if (nomenclatureCount > 0) {
        this.db.exec("INSERT INTO nomenclature_dictionary_fts(nomenclature_dictionary_fts) VALUES('rebuild')");
      }
    } catch {
      // FTS rebuild is best-effort
    }

    this.seedDefaults();
    this.seedOwnBrands();
    this.seedBrandCatalog();
    this.seedNomenclatureCatalog();
    this.seedCompanyDirectory();
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

    const insertSenderProfile = this.db.prepare(`
      INSERT INTO sender_profiles (sender_email, sender_domain, classification, company_hint, brand_hint, notes)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM sender_profiles
        WHERE (sender_email = ? AND sender_email != '') OR (sender_domain = ? AND sender_domain != '')
      )
    `);
    for (const p of DEFAULT_SENDER_PROFILES) {
      insertSenderProfile.run(
        p.senderEmail, p.senderDomain, p.classification, p.companyHint || "", "", p.notes,
        p.senderEmail, p.senderDomain
      );
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

  seedNomenclatureCatalog() {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM nomenclature_dictionary").get().count;
    if (count > 0) return;

    const candidates = [
      path.join(this.dataDir, "nomenclature-dictionary.json"),
      path.resolve(process.cwd(), "data", "nomenclature-dictionary.json")
    ];

    for (const catalogPath of candidates) {
      if (!existsSync(catalogPath)) continue;
      try {
        const entries = JSON.parse(readFileSync(catalogPath, "utf8"));
        if (!Array.isArray(entries) || entries.length === 0) continue;
        const result = this.importNomenclatureCatalog(entries, {
          sourceFile: path.relative(process.cwd(), catalogPath)
        });
        if (result.imported > 0) {
          console.log(`[detection-kb] Nomenclature catalog: +${result.imported} items from ${catalogPath}`);
        }
        return;
      } catch (err) {
        console.error("[detection-kb] Failed to seed nomenclature catalog:", err.message);
      }
    }
  }

  seedCompanyDirectory() {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM company_directory WHERE is_active = 1").get().count;
    if (count > 0) return;

    const candidates = [
      path.join(this.dataDir, "company-directory.json"),
      path.resolve(process.cwd(), "data", "company-directory.json")
    ];

    for (const catalogPath of candidates) {
      if (!existsSync(catalogPath)) continue;
      try {
        const entries = JSON.parse(readFileSync(catalogPath, "utf8"));
        if (!Array.isArray(entries) || entries.length === 0) continue;
        const result = this.importCompanyDirectory(entries, {
          sourceFile: path.relative(process.cwd(), catalogPath)
        });
        if (result.imported > 0) {
          console.log(`[detection-kb] Company directory: +${result.imported} contacts from ${catalogPath}`);
        }
        return;
      } catch (err) {
        console.error("[detection-kb] Failed to seed company directory:", err.message);
      }
    }
  }

  getOwnBrands() {
    if (!this.cache.ownBrands) {
      this.cache.ownBrands = this.db.prepare("SELECT * FROM own_brands WHERE is_active = 1 ORDER BY name").all();
    }
    return this.cache.ownBrands;
  }

  getOwnBrandNames() {
    if (!this.cache.ownBrandNames) {
      this.cache.ownBrandNames = new Set(
        this.db.prepare("SELECT name FROM own_brands WHERE is_active = 1").all()
          .map((row) => row.name.toLowerCase())
      );
    }
    return this.cache.ownBrandNames;
  }

  addOwnBrand(payload) {
    const name = String(payload.name || "").trim().toLowerCase();
    if (!name) return null;
    const statement = this.db.prepare(`
      INSERT INTO own_brands (name, notes) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET is_active = 1, notes = excluded.notes
    `);
    statement.run(name, payload.notes || "");
    this.invalidateCache("ownBrands");
    return this.db.prepare("SELECT * FROM own_brands WHERE name = ?").get(name);
  }

  deactivateOwnBrand(id) {
    this.db.prepare("UPDATE own_brands SET is_active = 0 WHERE id = ?").run(Number(id));
    this.invalidateCache("ownBrands");
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

  listApiClientPresets(clientId, options = {}) {
    const projectId = normalizePresetProjectId(options.projectId);
    const rows = this.db.prepare(`
      SELECT * FROM api_client_presets
      WHERE client_id = ?
        AND is_active = 1
        AND (project_id = '' OR project_id = ?)
      ORDER BY CASE WHEN project_id = ? THEN 0 ELSE 1 END, updated_at DESC, preset_key ASC
    `).all(String(clientId || ""), projectId, projectId);

    const deduped = new Map();
    for (const row of rows.map(normalizeApiClientPresetRow)) {
      if (!deduped.has(row.presetKey)) {
        deduped.set(row.presetKey, row);
      }
    }
    return Array.from(deduped.values());
  }

  getApiClientPreset(clientId, presetKey, options = {}) {
    const projectId = normalizePresetProjectId(options.projectId);
    const row = this.db.prepare(`
      SELECT * FROM api_client_presets
      WHERE client_id = ?
        AND preset_key = ?
        AND is_active = 1
        AND (project_id = ? OR project_id = '')
      ORDER BY CASE WHEN project_id = ? THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1
    `).get(String(clientId || ""), normalizePresetKey(presetKey), projectId, projectId);
    return row ? normalizeApiClientPresetRow(row) : null;
  }

  upsertApiClientPreset(clientId, payload) {
    const key = normalizePresetKey(payload.presetKey || payload.id || payload.key || payload.name);
    if (!key) {
      throw new Error("preset_key is required");
    }
    const name = String(payload.name || key).trim();
    const description = String(payload.description || "").trim();
    const query = normalizePresetQuery(payload.query || payload.filters || {});
    const projectId = normalizePresetProjectId(payload.projectId || payload.project_id);
    const now = new Date().toISOString();

    const existing = this.db.prepare(`
      SELECT id FROM api_client_presets WHERE client_id = ? AND preset_key = ? AND project_id = ?
    `).get(String(clientId || ""), key, projectId);

    if (existing) {
      this.db.prepare(`
        UPDATE api_client_presets
        SET name = ?, description = ?, query_json = ?, is_active = 1, updated_at = ?
        WHERE client_id = ? AND preset_key = ? AND project_id = ?
      `).run(name, description, JSON.stringify(query), now, String(clientId || ""), key, projectId);
    } else {
      this.db.prepare(`
        INSERT INTO api_client_presets (client_id, project_id, preset_key, name, description, query_json, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(String(clientId || ""), projectId, key, name, description, JSON.stringify(query), now, now);
    }

    return this.getApiClientPreset(clientId, key, { projectId });
  }

  deleteApiClientPreset(clientId, presetKey, options = {}) {
    const projectId = normalizePresetProjectId(options.projectId);
    this.db.prepare(`
      UPDATE api_client_presets
      SET is_active = 0, updated_at = ?
      WHERE client_id = ? AND preset_key = ? AND project_id = ?
    `).run(new Date().toISOString(), String(clientId || ""), normalizePresetKey(presetKey), projectId);
    return { clientId, projectId: projectId || null, presetKey: normalizePresetKey(presetKey), deleted: true };
  }

  ensureApiClientPresetProjectScopeColumn() {
    const columns = this.db.prepare("PRAGMA table_info(api_client_presets)").all();
    const hasProjectId = columns.some((column) => String(column.name).toLowerCase() === "project_id");
    if (!hasProjectId) {
      this.db.prepare("ALTER TABLE api_client_presets ADD COLUMN project_id TEXT NOT NULL DEFAULT ''").run();
    }
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
    this.invalidateCache("brandAliases");
    return { added, skipped, total: this.db.prepare("SELECT COUNT(*) AS count FROM brand_aliases WHERE is_active = 1").get().count };
  }

  clearBrandAliases() {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM brand_aliases").get().count;
    this.db.prepare("DELETE FROM brand_aliases").run();
    this.invalidateCache("brandAliases");
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

    // Deactivate short standalone aliases that cause false positives:
    // "indu" matches inside "industrial", "amandus" matches as person name,
    // "industrial" (Industrial Scientific) is too generic
    for (const [brand, alias] of [
      ["Indu-Sol", "indu"],
      ["Amandus Kahl", "amandus"],
      ["Industrial Scientific", "industrial"]
    ]) {
      this.db.prepare(`
        UPDATE brand_aliases SET is_active = 0
        WHERE canonical_brand = ? AND LOWER(alias) = ?
      `).run(brand, alias);
    }
    this.invalidateCache("brandAliases");
  }

  getRules() {
    if (!this.cache.rules) {
      this.cache.rules = this.db.prepare("SELECT * FROM detection_rules WHERE is_active = 1 ORDER BY classifier, weight DESC, id ASC").all();
    }
    return this.cache.rules;
  }

  getBrandAliases() {
    if (!this.cache.brandAliases) {
      this.cache.brandAliases = this.db.prepare("SELECT * FROM brand_aliases WHERE is_active = 1 ORDER BY canonical_brand, alias").all();
    }
    return this.cache.brandAliases;
  }

  getFieldPatterns(fieldName) {
    const key = String(fieldName || "");
    if (!this.cache.fieldPatterns.has(key)) {
      this.cache.fieldPatterns.set(
        key,
        this.db.prepare("SELECT * FROM field_patterns WHERE is_active = 1 AND field_name = ? ORDER BY priority DESC, id ASC").all(fieldName)
      );
    }
    return this.cache.fieldPatterns.get(key) || [];
  }

  getSenderProfiles() {
    if (!this.cache.senderProfiles) {
      this.cache.senderProfiles = this.db.prepare("SELECT * FROM sender_profiles WHERE is_active = 1 ORDER BY id ASC").all();
    }
    return this.cache.senderProfiles;
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
    this.invalidateCache("rules");
    return this.db.prepare("SELECT * FROM detection_rules WHERE id = ?").get(Number(result.lastInsertRowid));
  }

  addBrandAlias(payload) {
    const statement = this.db.prepare(`
      INSERT INTO brand_aliases (canonical_brand, alias)
      VALUES (?, ?)
    `);
    const result = statement.run(payload.canonicalBrand, payload.alias);
    this.invalidateCache("brandAliases");
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
    this.invalidateCache("senderProfiles");
    return this.db.prepare("SELECT * FROM sender_profiles WHERE id = ?").get(Number(result.lastInsertRowid));
  }

  upsertSenderProfile(payload) {
    const senderEmail = String(payload.senderEmail || "").trim().toLowerCase();
    const senderDomain = String(payload.senderDomain || "").trim().toLowerCase();
    const companyHint = cleanup(payload.companyHint || "");
    const brandHints = dedupeCaseInsensitive(String(payload.brandHint || "").split(/[;,|]/).map((item) => cleanup(item)));
    const classification = String(payload.classification || "client").trim() || "client";
    const notes = cleanup(payload.notes || "");

    if (!senderEmail && !senderDomain) return null;

    const existing = this.getSenderProfiles().find((profile) => {
      const profileEmail = String(profile.sender_email || "").trim().toLowerCase();
      const profileDomain = String(profile.sender_domain || "").trim().toLowerCase();
      return (senderEmail && profileEmail === senderEmail) || (senderDomain && profileDomain === senderDomain);
    });

    if (!existing) {
      return this.addSenderProfile({
        senderEmail,
        senderDomain,
        classification,
        companyHint,
        brandHint: brandHints.join(", "),
        notes
      });
    }

    const mergedCompanyHint = companyHint || existing.company_hint || "";
    const mergedBrandHint = dedupeCaseInsensitive([
      ...String(existing.brand_hint || "").split(/[;,|]/),
      ...brandHints
    ]).join(", ");
    const mergedNotes = cleanup([existing.notes || "", notes].filter(Boolean).join(" | "));

    this.db.prepare(`
      UPDATE sender_profiles
      SET classification = ?,
          company_hint = ?,
          brand_hint = ?,
          notes = ?
      WHERE id = ?
    `).run(
      classification,
      mergedCompanyHint,
      mergedBrandHint,
      mergedNotes,
      Number(existing.id)
    );
    this.invalidateCache("senderProfiles");
    return this.db.prepare("SELECT * FROM sender_profiles WHERE id = ?").get(Number(existing.id));
  }

  deactivateRule(id) {
    this.db.prepare("UPDATE detection_rules SET is_active = 0 WHERE id = ?").run(Number(id));
    this.invalidateCache("rules");
    return { id, deactivated: true };
  }

  deactivateSenderProfile(id) {
    this.db.prepare("UPDATE sender_profiles SET is_active = 0 WHERE id = ?").run(Number(id));
    this.invalidateCache("senderProfiles");
    return { id, deactivated: true };
  }

  deactivateBrandAlias(id) {
    this.db.prepare("UPDATE brand_aliases SET is_active = 0 WHERE id = ?").run(Number(id));
    this.invalidateCache("brandAliases");
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
      companyDirectoryCount: this.db.prepare("SELECT COUNT(*) AS count FROM company_directory WHERE is_active = 1").get().count,
      corpusCount: this.db.prepare("SELECT COUNT(*) AS count FROM message_corpus").get().count,
      nomenclatureCount: this.db.prepare("SELECT COUNT(*) AS count FROM nomenclature_dictionary").get().count
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
    this.db.exec(`
      INSERT INTO nomenclature_dictionary_fts(nomenclature_dictionary_fts) VALUES('rebuild');
    `);
  }

  getNomenclatureStats() {
    return this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT brand) AS brands,
        SUM(source_rows) AS source_rows
      FROM nomenclature_dictionary
    `).get();
  }

  getNomenclature(limit = 50) {
    return this.db.prepare(`
      SELECT *
      FROM nomenclature_dictionary
      ORDER BY source_rows DESC, total_quantity DESC, article
      LIMIT ?
    `).all(Number(limit));
  }

  getLearnedNomenclature(limit = 100) {
    return this.db.prepare(`
      SELECT *
      FROM nomenclature_dictionary
      WHERE source_file LIKE 'manual_feedback:%'
      ORDER BY last_imported_at DESC, article
      LIMIT ?
    `).all(Number(limit));
  }

  deleteNomenclatureEntry(id) {
    const existing = this.db.prepare("SELECT id FROM nomenclature_dictionary WHERE id = ?").get(Number(id));
    if (!existing) return { id: Number(id), deleted: false };
    this.db.prepare("DELETE FROM nomenclature_dictionary WHERE id = ?").run(Number(id));
    this.db.exec("INSERT INTO nomenclature_dictionary_fts(nomenclature_dictionary_fts) VALUES('rebuild')");
    return { id: Number(id), deleted: true };
  }

  searchNomenclature(query, { limit = 20, brand = null } = {}) {
    const normalizedQuery = normalizeArticle(query);
    if (!normalizedQuery) {
      return this.getNomenclature(limit);
    }

    const exact = this.db.prepare(`
      SELECT *, 1000 AS relevance
      FROM nomenclature_dictionary
      WHERE article_normalized = ?
      LIMIT ?
    `).all(normalizedQuery, Number(limit));
    if (exact.length > 0) {
      return exact;
    }

    const sanitized = String(query || "")
      .replace(/['"*():^~{}[\]\\]/g, " ")
      .trim();
    if (!sanitized) {
      return [];
    }

    const ftsQuery = sanitized
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => `"${word}"*`)
      .join(" ");

    if (brand) {
      return this.db.prepare(`
        SELECT nd.*, bm25(nomenclature_dictionary_fts, 1.0, 1.2, 1.5, 0.8, 0.6) AS relevance
        FROM nomenclature_dictionary nd
        JOIN nomenclature_dictionary_fts fts ON nd.id = fts.rowid
        WHERE nomenclature_dictionary_fts MATCH ?
          AND lower(nd.brand) = lower(?)
        ORDER BY relevance, nd.source_rows DESC, nd.total_quantity DESC
        LIMIT ?
      `).all(ftsQuery, brand, Number(limit));
    }

    return this.db.prepare(`
      SELECT nd.*, bm25(nomenclature_dictionary_fts, 1.0, 1.2, 1.5, 0.8, 0.6) AS relevance
      FROM nomenclature_dictionary nd
      JOIN nomenclature_dictionary_fts fts ON nd.id = fts.rowid
      WHERE nomenclature_dictionary_fts MATCH ?
      ORDER BY relevance, nd.source_rows DESC, nd.total_quantity DESC
      LIMIT ?
    `).all(ftsQuery, Number(limit));
  }

  findNomenclatureByArticle(article) {
    const normalized = normalizeArticle(article);
    if (!normalized) return null;
    return this.db.prepare(`
      SELECT *
      FROM nomenclature_dictionary
      WHERE article_normalized = ?
      LIMIT 1
    `).get(normalized) || null;
  }

  findNomenclatureByArticleFragment(article, limit = 5) {
    const normalized = normalizeArticle(article);
    if (!isUsefulArticleQuery(normalized)) return [];
    return this.db.prepare(`
      SELECT *
      FROM nomenclature_dictionary
      WHERE article_normalized LIKE ?
      ORDER BY
        CASE
          WHEN article_normalized = ? THEN 0
          WHEN article_normalized LIKE ? THEN 1
          ELSE 2
        END,
        source_rows DESC,
        total_quantity DESC
      LIMIT ?
    `).all(`%${normalized}%`, normalized, `${normalized}%`, Number(limit));
  }

  findNomenclatureCandidates({ article = "", text = "", brands = [], limit = 8 } = {}) {
    const candidates = [];
    const exact = article ? this.findNomenclatureByArticle(article) : null;
    if (exact) {
      candidates.push({ ...exact, match_type: "article_exact" });
    }

    if (!exact && article) {
      for (const match of this.findNomenclatureByArticleFragment(article, limit)) {
        if (!candidates.some((item) => item.article_normalized === match.article_normalized)) {
          candidates.push({ ...match, match_type: "article_fragment" });
        }
      }
    }

    if (brands.length > 0 && article && !exact && candidates.length === 0) {
      for (const brand of brands) {
        if (!isUsefulArticleQuery(article)) continue;
        for (const match of this.searchNomenclature(article, { limit, brand })) {
          if (!candidates.some((item) => item.article_normalized === match.article_normalized)) {
            candidates.push({ ...match, match_type: "brand_semantic" });
          }
        }
      }
    }

    if (!article && text) {
      for (const match of this.searchNomenclature(String(text).slice(0, 180), { limit })) {
        if (!candidates.some((item) => item.article_normalized === match.article_normalized)) {
          candidates.push({ ...match, match_type: "semantic" });
        }
      }
    }

    return candidates.slice(0, limit);
  }

  importNomenclatureCatalog(entries, options = {}) {
    const now = new Date().toISOString();
    const sourceFile = String(options.sourceFile || "").trim();
    const insertDictionary = this.db.prepare(`
      INSERT INTO nomenclature_dictionary (
        article,
        article_normalized,
        brand,
        product_name,
        description,
        synonyms,
        source_deal_ids,
        source_rows,
        total_quantity,
        min_price,
        max_price,
        avg_price,
        last_imported_at,
        source_file
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(article_normalized) DO UPDATE SET
        article = excluded.article,
        brand = excluded.brand,
        product_name = excluded.product_name,
        description = excluded.description,
        synonyms = excluded.synonyms,
        source_deal_ids = excluded.source_deal_ids,
        source_rows = excluded.source_rows,
        total_quantity = excluded.total_quantity,
        min_price = excluded.min_price,
        max_price = excluded.max_price,
        avg_price = excluded.avg_price,
        last_imported_at = excluded.last_imported_at,
        source_file = excluded.source_file
    `);

    const grouped = new Map();
    let scanned = 0;
    for (const entry of entries || []) {
      scanned += 1;
      const rawArticle = cleanup(entry["Артикул"] || entry.article || entry.sku || "");
      const articleNormalized = normalizeArticle(rawArticle);
      if (!articleNormalized) continue;

      const key = articleNormalized;
      if (!grouped.has(key)) {
        grouped.set(key, {
          article: rawArticle,
          articleNormalized,
          brand: cleanup(entry["Бренд"] || entry.brand || ""),
          productName: cleanup(entry["Наименование"] || entry.product_name || entry.name || ""),
          description: cleanup(entry["Описание"] || entry.description || ""),
          sourceDealIds: new Set(),
          sourceRows: 0,
          totalQuantity: 0,
          minPrice: null,
          maxPrice: null,
          sumPrice: 0,
          priceCount: 0,
          synonyms: new Set()
        });
      }

      const bucket = grouped.get(key);
      const dealId = cleanup(entry["ID сделки"] || entry.deal_id || "");
      const qty = Number(entry["Кол-во"] || entry.quantity || 0);
      const price = Number(entry["Цена продажи 1 шт."] || entry.price || 0);
      const productName = cleanup(entry["Наименование"] || entry.product_name || entry.name || "");
      const description = cleanup(entry["Описание"] || entry.description || "");
      const brand = cleanup(entry["Бренд"] || entry.brand || "");

      bucket.sourceRows += 1;
      bucket.totalQuantity += Number.isFinite(qty) ? qty : 0;
      if (dealId) bucket.sourceDealIds.add(dealId);
      if (brand && !bucket.brand) bucket.brand = brand;
      if (productName && (!bucket.productName || productName.length > bucket.productName.length)) bucket.productName = productName;
      if (description && (!bucket.description || description.length > bucket.description.length)) bucket.description = description;
      if (brand) bucket.synonyms.add(brand);
      if (productName) bucket.synonyms.add(productName);
      if (description) bucket.synonyms.add(description);

      if (Number.isFinite(price) && price > 0) {
        bucket.minPrice = bucket.minPrice == null ? price : Math.min(bucket.minPrice, price);
        bucket.maxPrice = bucket.maxPrice == null ? price : Math.max(bucket.maxPrice, price);
        bucket.sumPrice += price;
        bucket.priceCount += 1;
      }
    }

    let imported = 0;
    for (const item of grouped.values()) {
      const synonyms = Array.from(item.synonyms)
        .map((value) => cleanup(value))
        .filter(Boolean)
        .filter((value, index, array) => array.indexOf(value) === index)
        .slice(0, 12);
      insertDictionary.run(
        item.article,
        item.articleNormalized,
        item.brand,
        item.productName,
        item.description,
        JSON.stringify(synonyms),
        JSON.stringify(Array.from(item.sourceDealIds).slice(0, 20)),
        item.sourceRows,
        Number(item.totalQuantity.toFixed(3)),
        item.minPrice,
        item.maxPrice,
        item.priceCount > 0 ? Number((item.sumPrice / item.priceCount).toFixed(2)) : null,
        now,
        sourceFile
      );
      if (item.brand) {
        const alias = item.brand.toLowerCase();
        this.db.prepare(`
          INSERT INTO brand_aliases (canonical_brand, alias)
          SELECT ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM brand_aliases WHERE canonical_brand = ? AND alias = ?
          )
        `).run(item.brand, alias, item.brand, alias);
      }
      imported += 1;
    }

    this.invalidateCache("brandAliases");
    this.db.exec("INSERT INTO nomenclature_dictionary_fts(nomenclature_dictionary_fts) VALUES('rebuild')");

    return {
      scanned,
      imported,
      stats: this.getNomenclatureStats()
    };
  }

  exportNomenclatureDictionary(limit = 100000) {
    return this.db.prepare(`
      SELECT *
      FROM nomenclature_dictionary
      ORDER BY source_rows DESC, total_quantity DESC, article
      LIMIT ?
    `).all(Number(limit));
  }

  learnNomenclatureFeedback(payload = {}) {
    const article = cleanup(payload.article || "");
    const articleNormalized = normalizeArticle(article);
    if (!articleNormalized) return null;

    const current = this.findNomenclatureByArticle(article);
    const brand = cleanup(payload.brand || current?.brand || "");
    const productName = cleanup(payload.productName || current?.product_name || "");
    const description = cleanup(payload.description || current?.description || "");
    const sourceFile = cleanup(payload.sourceFile || "manual_feedback");

    return this.importNomenclatureCatalog([{
      article,
      brand,
      product_name: productName,
      description,
      quantity: 1
    }], { sourceFile });
  }

  importCompanyDirectory(entries, options = {}) {
    const sourceFile = cleanup(options.sourceFile || "");
    const statement = this.db.prepare(`
      INSERT INTO company_directory (
        company_name,
        inn,
        okved,
        okved_title,
        contact_name,
        contact_position,
        email,
        email_domain,
        greeting,
        source_file,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(email) DO UPDATE SET
        company_name = excluded.company_name,
        inn = excluded.inn,
        okved = excluded.okved,
        okved_title = excluded.okved_title,
        contact_name = excluded.contact_name,
        contact_position = excluded.contact_position,
        email_domain = excluded.email_domain,
        greeting = excluded.greeting,
        source_file = excluded.source_file,
        is_active = 1
    `);

    let scanned = 0;
    let imported = 0;
    for (const entry of entries || []) {
      scanned += 1;
      const email = cleanup(entry.email || entry.Email || entry["Эл. почта"] || "").toLowerCase();
      const companyName = cleanup(entry.company_name || entry.name || entry["Наименование"] || "");
      const inn = cleanup(entry.inn || entry["ИНН"] || "");
      const okved = cleanup(entry.okved || entry["ОКВЭД"] || "");
      const okvedTitle = cleanup(entry.okved_title || entry["ОКВЭД название"] || "");
      const contactName = cleanup(entry.contact_name || entry.fio || entry["ФИО"] || "");
      const contactPosition = cleanup(entry.contact_position || entry.post || entry["Должность"] || "");
      const greeting = cleanup(entry.greeting || entry["Обращение"] || "");
      const emailDomain = getDomain(email);

      if (!email || !companyName) continue;

      statement.run(
        companyName,
        inn,
        okved,
        okvedTitle,
        contactName,
        contactPosition,
        email,
        emailDomain,
        greeting,
        sourceFile
      );
      imported += 1;
    }

    return {
      scanned,
      imported,
      total: this.db.prepare("SELECT COUNT(*) AS count FROM company_directory WHERE is_active = 1").get().count
    };
  }

  lookupCompanyDirectory({ email = "", inn = "", domain = "", companyName = "" } = {}) {
    const normalizedEmail = cleanup(email).toLowerCase();
    const normalizedInn = cleanup(inn);
    const normalizedDomain = cleanup(domain || getDomain(normalizedEmail)).toLowerCase();
    const normalizedCompany = normalizeComparableCompany(companyName);

    if (normalizedEmail) {
      const byEmail = this.db.prepare(`
        SELECT *
        FROM company_directory
        WHERE is_active = 1
          AND email = ?
        LIMIT 1
      `).get(normalizedEmail);
      if (byEmail) return byEmail;
    }

    if (normalizedInn) {
      const byInn = this.db.prepare(`
        SELECT *
        FROM company_directory
        WHERE is_active = 1
          AND inn = ?
        ORDER BY CASE WHEN email_domain = ? THEN 0 ELSE 1 END, id ASC
        LIMIT 1
      `).get(normalizedInn, normalizedDomain);
      if (byInn) return byInn;
    }

    if (!normalizedDomain || FREE_EMAIL_DOMAINS.has(normalizedDomain)) {
      if (!normalizedCompany) return null;
    } else {
      const byDomain = this.db.prepare(`
        SELECT *
        FROM company_directory
        WHERE is_active = 1
          AND email_domain = ?
        ORDER BY id ASC
        LIMIT 1
      `).get(normalizedDomain);
      if (byDomain) return byDomain;
    }

    if (!normalizedCompany) {
      return null;
    }

    const companyRows = this.db.prepare(`
      SELECT *
      FROM company_directory
      WHERE is_active = 1
        AND company_name <> ''
    `).all();

    for (const row of companyRows) {
      const candidate = normalizeComparableCompany(row.company_name);
      if (!candidate) continue;
      if (candidate === normalizedCompany || candidate.includes(normalizedCompany) || normalizedCompany.includes(candidate)) {
        return row;
      }
    }

    return null;
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
        if (BRAND_FALSE_POSITIVE_ALIASES.has(alias)) {
          return false;
        }
        // Short aliases (< 4 chars) or word-boundary-required aliases need strict word boundary
        if (alias.length < 4 || BRAND_WORD_BOUNDARY_ALIASES.has(alias)) {
          return new RegExp(`\\b${escapeRegex(alias)}\\b`, "i").test(lowered);
        }
        return padded.includes(alias);
      })
      .map((entry) => preferProjectBrandCase(entry.canonical_brand, projectBrands));

    const projectMatched = (projectBrands || []).filter((brand) => {
      const b = String(brand).toLowerCase();
      if (BRAND_FALSE_POSITIVE_ALIASES.has(b)) {
        return false;
      }
      if (b.length < 4 || BRAND_WORD_BOUNDARY_ALIASES.has(b)) {
        return new RegExp(`\\b${escapeRegex(b)}\\b`, "i").test(lowered);
      }
      return padded.includes(b);
    });

    if (projectMatched.length > 0) {
      return dedupeCaseInsensitive(projectMatched);
    }

    return dedupeCaseInsensitive([...matched, ...projectMatched]);
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

  invalidateCache(scope = "all") {
    if (scope === "all") {
      this.cache.rules = null;
      this.cache.brandAliases = null;
      this.cache.senderProfiles = null;
      this.cache.ownBrandNames = null;
      this.cache.ownBrands = null;
      this.cache.fieldPatterns.clear();
      return;
    }

    if (scope === "rules") this.cache.rules = null;
    if (scope === "brandAliases") this.cache.brandAliases = null;
    if (scope === "senderProfiles") this.cache.senderProfiles = null;
    if (scope === "ownBrands") {
      this.cache.ownBrands = null;
      this.cache.ownBrandNames = null;
    }
    if (scope === "fieldPatterns") this.cache.fieldPatterns.clear();
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
      if (!item.messageKey || item.pipelineStatus === "ignored_spam" || item.pipelineStatus === "ignored_duplicate" || item.error) {
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

function normalizeArticle(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[“”«»"]/g, "")
    .toUpperCase();
}

function normalizePresetKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function normalizePresetProjectId(value) {
  return String(value || "").trim();
}

function itemLooksExact(query, match) {
  const q = normalizeArticle(query);
  return q && (q === normalizeArticle(match.article) || q === normalizeArticle(match.article_normalized));
}

function cleanup(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeComparableCompany(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[«»"']/g, " ")
    .replace(/(?:^|\s)(?:ооо|ао|оао|зао|пао|ип|фгуп|муп|гуп|нпо|нпп|нпк|тоо|кт)(?=\s|$)/g, " ")
    .replace(/(?:^|\s)(?:юридический|фактический|почтовый|адрес|и)(?=\s|$)/g, " ")
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulArticleQuery(value) {
  const normalized = normalizeArticle(value);
  if (!normalized || normalized.length < 4) return false;
  if (!/\d/.test(normalized)) return false;
  if (/^\d{1,3}$/.test(normalized)) return false;
  return true;
}

function dedupeCaseInsensitive(items) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const normalized = String(item || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(String(item).trim());
  }
  return result;
}

function preferProjectBrandCase(brand, projectBrands = []) {
  const normalized = String(brand || "").trim().toLowerCase();
  const preferred = (projectBrands || []).find((item) => String(item || "").trim().toLowerCase() === normalized);
  return preferred || brand;
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

function normalizePresetQuery(query) {
  const result = {};
  for (const [key, value] of Object.entries(query || {})) {
    if (value == null) continue;
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    result[normalizedKey] = typeof value === "string" ? value : String(value);
  }
  return result;
}

function normalizeApiClientPresetRow(row) {
  let query = {};
  try {
    query = JSON.parse(String(row.query_json || "{}"));
  } catch {
    query = {};
  }
  return {
    id: Number(row.id),
    clientId: row.client_id,
    projectId: row.project_id || null,
    presetKey: row.preset_key,
    name: row.name,
    description: row.description || "",
    query,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export const detectionKb = new DetectionKnowledgeBase();
