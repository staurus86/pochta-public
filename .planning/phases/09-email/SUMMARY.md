# Phase 9 — Email extractor refactor

**Status:** ✅ Shipped 2026-04-20 · 42/42 new tests green · 141 email-analyzer PASS / 3 FAIL (pre-existing unrelated: R.Stahl KB alias, docx/xlsx tar на Windows) · 174/174 extractor unit tests green

## Goal

Закрыть defect категории Email (1826 строк):
- email = 100% present, но НЕ как типизированная сущность — substring в «От»
- 35 строк — duplicate-in-display формат `"email" <email>` / `email <email>`
- 497 публичных ящиков (gmail/mail.ru/yandex.ru/bk.ru/list.ru/inbox.ru/ya.ru/…)
- 227 role-ящиков (sales/info/manager/zakaz/support/procurement)
- 4 noreply/system
- Отсутствие sub-полей, классификации email/domain, source-of-truth-правил

Цели:
1. Структурировать email в полноценную сущность со sub-полями:
   `email_primary` / `email_display_name` / `email_local` / `email_domain` /
   `email_type` / `email_domain_type` / `email_source` / `email_confidence` /
   `email_needs_review` / `email_deduplicated` / `email_can_define_person` /
   `email_can_define_company` / `email_rejected[]`
2. Парсер sender-заголовка: `Name <email>`, `"Name" <email>`, `bare@email`,
   `"email" <email>` (dedup), `email <email>` (dedup).
3. Классификация local-part: `person_email` / `role_mailbox` / `system_email` /
   `noreply_email` / `unknown`.
4. Классификация domain: `public_provider` / `corporate` / `platform` / `unknown`.
5. Source-of-truth rules: public/role/system email не могут определять Company/ФИО.

## 3 новых модуля (зеркало в `.railway-deploy/src/services/`)

### `src/services/email-filters.js`
- `ROLE_KEYWORDS` — 40+ role-tokens (sales/info/manager/zakaz/support/procurement/
  office/admin/secretary/reception/hr/buh/accounting/finance/tender/marketing/pr/
  otdel/dispatcher/logist/warehouse/sklad/purchase/trade/…).
- `SYSTEM_KEYWORDS_NOREPLY` — noreply/no-reply/no_reply/donotreply.
- `SYSTEM_KEYWORDS_DAEMON` — mailer-daemon/postmaster/bounce/notification/robot/
  bot/daemon/system/automailer/alert.
- `PUBLIC_PROVIDER_DOMAINS` (Set) — 40+ RU/intl публичных почтовых провайдеров
  (mail.ru/bk.ru/list.ru/inbox.ru/yandex.*/rambler.ru/gmail.com/hotmail.com/
  outlook.com/yahoo.com/icloud.com/protonmail.com/aol/gmx/zoho/fastmail/tutanota).
- `PLATFORM_DOMAINS` (Set) — tilda.ws/wildberries/ozon/tenderpro/sbis/b2b-center/
  zakupki.gov.ru.
- `classifyLocalPart(local)` — token-boundary lookup (не startsWith — избегает
  false positives на "salesperson"/"information").
- `classifyDomain(domain)` — public/platform lookup → corporate fallback
  (with domain-shape validation: `[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}$`).
- `canUseAsTruthSource({type, domainType}, field)`:
  - system/noreply → никогда,
  - role_mailbox → нельзя для person,
  - public_provider/platform/unknown → нельзя для company.

### `src/services/email-normalizer.js`
- `EMAIL_RE` — permissive pre-validation pattern.
- `normalizeEmail(raw)` — trim + lowercase + валидация формы.
- `splitLocalDomain(email)` → `{local, domain}`.
- `extractEmailsFromText(text)` — дедуп (lowercase) + сохранение порядка.
- `parseSenderHeader(raw)` — возвращает `{email, displayName, deduplicated}`:
  - Chevron branch: `<addr>` → email, prefix → display.
  - Bare branch: email без chevron, remainder → display.
  - Dedup detection: display содержит тот же email → `deduplicated=true`,
    `displayName=""`.

### `src/services/email-extractor.js`
Facade каскад `sender_header(0.9) > body(0.5) > signature(0.6)`:
- Primary selection через cascade.
- Per-candidate: `splitLocalDomain` → `classifyLocalPart` + `classifyDomain` →
  `canUseAsTruthSource` для person/company.
- `scoreConfidence` — domain adjustments ДО type caps (иначе domain=corporate
  восстановил бы system/noreply confidence к базе 0.9).
- `needsReview` = `confidence < 0.6 || system_email || noreply_email`.

Output: `{primary, displayName, localPart, domain, type, domainType, source,
confidence, needsReview, deduplicated, canDefinePerson, canDefineCompany,
rawCandidates[], rejected[]}`.

## Интеграция в `email-analyzer.js`

1. **Sender header parsing** — заменил crude `chevronMatch` regex на
   `parseSenderHeader`:
   ```js
   const senderParsed = parseSenderHeader(rawFrom);
   if (senderParsed.email) {
     fromEmail = senderParsed.email;
     if (!fromName && senderParsed.displayName && !senderParsed.deduplicated) {
       fromName = senderParsed.displayName;
     }
     // drop fromName if it carries the same email (duplicate-in-display)
     if (fromName && (fromName.toLowerCase() === fromEmail
                      || fromName.toLowerCase().includes(fromEmail))) fromName = "";
   }
   ```
2. **extractSender** — добавлен вызов `extractEmailV2({rawFrom, fromEmail,
   fromName, body, signature})` перед остальной extraction.
3. **Sender output schema** — 13 новых полей: `emailPrimary`, `emailDisplayName`,
   `emailLocal`, `emailDomain`, `emailType`, `emailDomainType`, `emailSource`,
   `emailConfidence`, `emailNeedsReview`, `emailDeduplicated`,
   `emailCanDefinePerson`, `emailCanDefineCompany`, `emailRejected[]`.

**Примечание о source-of-truth guards:** `isFreeDomain(email)` в
`inferCompanyFromDomain` уже блокировал публичные провайдеры de-facto. Новая
классификация делает это правило явным (domainType=public_provider/platform
→ `canDefineCompany=false`), и CRM-маршрутизация может теперь дисциплинированно
проверять флаг вместо inline-проверки.

## Тесты

`tests/email-extractor.test.js` — 42 теста:
- 11 filter: classifyLocalPart (role/system/noreply/person/unknown),
  classifyDomain (public/platform/corporate/unknown),
  canUseAsTruthSource (5 cross-field rules).
- 9 normalizer: parseSenderHeader (Name/quoted/bare/dedup/mixed-case/empty),
  normalizeEmail, splitLocalDomain, extractEmailsFromText (multi/dedup).
- 22 facade: sender header primary / dedup flag / public provider / role /
  noreply / mailer-daemon / person-like / source-of-truth rules / confidence
  high/low / raw candidates / empty / invalid / deduplicated display /
  preserved real displayName.

## Key gotchas

1. **Type cap должен быть ПОСЛЕ domain-adjustment** — иначе
   `Math.min(conf, 0.35)` для noreply затем переписывается
   `Math.max(conf, 0.9)` для corporate домена.
2. **fromName может дублировать email** — если `parseSenderHeader` вернул
   `deduplicated=true`, не восстанавливать displayName из payload.fromName.
3. **Role keywords matched via token boundary**, не startsWith — иначе
   "salesperson" попадёт в role_mailbox.
4. **Domain sanity validation** — `corporate` фallback проверяет
   `[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}$`; без этого "ivan" (локальная часть
   без домена) получил бы classification `corporate`.
5. **Deduplicated display**: не только `displayLower === email`, но и
   `displayLower.includes(email)` (для форм `"email " <email>`).

## Git

Commit: `<pending>` · diff: +3 modules (~330 lines) + email-analyzer
integration (~30 lines) + tests (~350 lines) + SUMMARY.
