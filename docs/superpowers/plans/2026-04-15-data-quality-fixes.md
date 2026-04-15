# Data Quality Fixes — Pack 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить 7 системных дефектов качества данных: вложения (auth), дубли артикулов/товаров/брендов, должности (неполные), телефоны siderus в Re:, форм-заявка (полный артикул), ложный мультибренд, флаг массового запроса.

**Architecture:** Все правки в существующих файлах без реструктуризации. Добавляются новые функции-нормализаторы и расширяются паттерны. Каждый блок — независимый коммит.

**Tech Stack:** Node.js 25 ESM, `node:assert/strict`, `node:test`, Python 3 (imaplib), plain regex.

---

## Файлы затронутые планом

| Файл | Изменение |
|------|-----------|
| `src/server.js` | Блок 1: перенос attachment-маршрута до auth gate |
| `public/app.js` | Блок 1: `?token=` в attachment URL |
| `src/services/email-analyzer.js` | Блоки 2–7 |
| `project 3/mailbox_file_runner.py` | Блок 7: CC/To поля |
| `.railway-deploy/src/server.js` | синхронизация |
| `.railway-deploy/src/services/email-analyzer.js` | синхронизация |
| `.railway-deploy/public/app.js` | синхронизация |
| `tests/email-analyzer.test.js` | тесты для блоков 2–7 |

---

## Task 1: Блок 1 — Вложения: Authentication required

**Files:**
- Modify: `src/server.js` (маршрут `/api/attachments/` ~строка 980, global auth gate ~572)
- Modify: `public/app.js` (~строка 2738)
- Sync: `.railway-deploy/src/server.js`, `.railway-deploy/public/app.js`

- [ ] **Step 1: Найти и переместить attachment-маршрут в `src/server.js`**

  Найти строку с `requireAuth(req);` (глобальный gate, ~572). Найти блок `const attachMatch = ...` (~980).
  
  Вырезать весь блок `const attachMatch ... }` (строки ~980–1019) и вставить его **до** строки с `requireAuth(req)` (до строки ~572).
  
  Заменить внутри перенесённого блока начало обработчика:
  ```js
  if (req.method === "GET" && attachMatch) {
    // auth: Bearer header OR ?token= query param
    const attachUser = extractAuthUser(req) || (() => {
      const qt = url.searchParams.get("token");
      return qt ? managerAuth.verifyToken(qt) : null;
    })();
    if (!attachUser) return sendJson(res, 401, { error: "Authentication required" });
    const messageKey = decodeURIComponent(attachMatch[1]);
    // ... остальной код без изменений
  ```

- [ ] **Step 2: Обновить URL вложений в `public/app.js`**

  Найти строку ~2738:
  ```js
  const attUrl = hasFile ? `/api/attachments/${encodeURIComponent(msgKey)}/${encodeURIComponent(att)}` : null;
  ```
  Заменить на:
  ```js
  const attUrl = hasFile ? `/api/attachments/${encodeURIComponent(msgKey)}/${encodeURIComponent(att)}?token=${encodeURIComponent(getAuthToken() || '')}` : null;
  ```

- [ ] **Step 3: Проверить вручную (нет автотеста для auth flow)**

  ```bash
  npm run dev
  ```
  Открыть браузер, залогиниться, открыть письмо с вложением, нажать на него — файл должен открыться (не 401).

- [ ] **Step 4: Синхронизировать railway-deploy**

  ```bash
  cp src/server.js .railway-deploy/src/server.js
  cp public/app.js .railway-deploy/public/app.js
  ```

- [ ] **Step 5: Коммит**

  ```bash
  git add src/server.js public/app.js .railway-deploy/src/server.js .railway-deploy/public/app.js
  git commit -m "fix: attachments — support ?token= query auth for browser direct download"
  ```

---

## Task 2: Блок 4 — Фильтр собственных реквизитов компании

> Делаем раньше блока 2 — другие тесты зависят от корректной фильтрации телефонов.

**Files:**
- Modify: `src/services/email-analyzer.js` (~строка 179 и функции ~1192, ~2227, ~2571, ~2716, ~4192)
- Test: `tests/email-analyzer.test.js`

- [ ] **Step 1: Написать падающий тест**

  Добавить в конец `tests/email-analyzer.test.js`:

  ```js
  runTest("Фильтр: телефон siderus не попадает в sender из Re: письма", () => {
    const result = analyzeEmail(project, {
      subject: "Re: Запрос",
      fromEmail: "client@somecompany.ru",
      fromName: "Иван Петров",
      body: `Добрый день, спасибо за ответ!\n\nС уважением,\nИван Петров\n+7 (916) 123-45-67\n\n> От: Менеджер Сайдерус <manager@siderus.ru>\n> Тел: +7 (499) 647-47-07\n> 8 (800) 777-47-07`,
      attachments: []
    });
    assert.ok(
      result.sender?.mobilePhone !== "+7 (499) 647-47-07",
      `Телефон siderus не должен быть в sender, получили: ${result.sender?.mobilePhone}`
    );
    assert.ok(
      result.sender?.cityPhone !== "+7 (800) 777-47-07",
      `Телефон 800 не должен быть в sender, получили: ${result.sender?.cityPhone}`
    );
  });

  runTest("Фильтр: ИНН коловрата не попадает в sender", () => {
    const result = analyzeEmail(project, {
      subject: "Запрос",
      fromEmail: "buyer@factory.ru",
      fromName: "Покупатель",
      body: `Прошу выставить КП.\n\nООО Коловрат\nИНН 9701077015\nКПП 773101001\nОГРН 1177746518740`,
      attachments: []
    });
    assert.equal(result.sender?.inn, null, `ИНН коловрата не должен быть в sender, получили: ${result.sender?.inn}`);
    assert.ok(
      !/коловрат/i.test(result.sender?.companyName || ""),
      `Название коловрата не должно быть в companyName, получили: ${result.sender?.companyName}`
    );
  });
  ```

- [ ] **Step 2: Запустить и убедиться что тест падает**

  ```bash
  node tests/email-analyzer.test.js 2>&1 | tail -20
  ```
  Ожидаем: FAIL — телефоны siderus попадают в sender.

- [ ] **Step 3: Добавить `OWN_COMPANY_IDENTITY` в `email-analyzer.js`**

  Найти строку ~179 (`const OWN_INNS = new Set([...`). Заменить весь блок OWN_DOMAINS + OWN_INNS:

  ```js
  const OWN_DOMAINS = new Set([
    "siderus.su", "siderus.online", "siderus.ru", "klvrt.ru",
    "ersab2b.ru", "itec-rus.ru", "paulvahle.ru", "petersime-rus.ru",
    "rstahl.ru", "schimpfdrive.ru", "schischekrus.ru", "sera-rus.ru",
    "serfilco-ru.ru", "vega-automation.ru", "waldner-ru.ru", "kiesel-rus.ru",
    "maximator-ru.ru", "stromag-ru.ru", "endress-hauser.pro"
  ]);

  const OWN_COMPANY_IDENTITY = {
    phones: ["+7 (499) 647-47-07", "+7 (800) 777-47-07"],
    inn: new Set(["9701077015"]),
    kpp: new Set(["773101001"]),
    ogrn: new Set(["1177746518740"]),
    domains: OWN_DOMAINS,
    nameParts: ["сайдерус", "siderus", "коловрат", "kolovrat"],
  };

  // Own company INNs — never treat as client INN
  const OWN_INNS = OWN_COMPANY_IDENTITY.inn;
  function isOwnInn(inn) { return OWN_INNS.has(String(inn || '')); }

  function isOwnDomain(domain) { return OWN_DOMAINS.has(String(domain || '').toLowerCase()); }

  function isOwnCompanyData(field, value) {
    if (!value) return false;
    const v = String(value).trim();
    switch (field) {
      case "phone": {
        const normalized = normalizePhoneNumber(v);
        return normalized ? OWN_COMPANY_IDENTITY.phones.includes(normalized) : false;
      }
      case "inn":  return OWN_COMPANY_IDENTITY.inn.has(v.replace(/\D/g, ""));
      case "kpp":  return OWN_COMPANY_IDENTITY.kpp.has(v.replace(/\D/g, ""));
      case "ogrn": return OWN_COMPANY_IDENTITY.ogrn.has(v.replace(/\D/g, ""));
      case "email": {
        const domain = v.split("@")[1]?.toLowerCase();
        return domain ? OWN_COMPANY_IDENTITY.domains.has(domain) : false;
      }
      case "company":
        return OWN_COMPANY_IDENTITY.nameParts.some((p) => v.toLowerCase().includes(p));
      default: return false;
    }
  }
  ```

  > Важно: `normalizePhoneNumber` определена позже (~2462) — это нормально для ESM, функции hoistятся. Но поскольку `isOwnCompanyData` — обычная функция (не const-стрелка), обращение к `normalizePhoneNumber` работает.

- [ ] **Step 4: Применить фильтр в `splitPhones` (~2716)**

  Найти функцию `splitPhones`. В начале цикла нормализации добавить фильтр:

  ```js
  function splitPhones(phones, body = "") {
    const validated = unique((phones || []).map((phone) => normalizePhoneNumber(phone)).filter(Boolean))
      .filter((phone) => !isOwnCompanyData("phone", phone));  // ← добавить эту строку
  ```

- [ ] **Step 5: Применить фильтр в `extractSender` (~1192)**

  После строк извлечения компании и ИНН (~1207) добавить:

  ```js
  const companyName = sanitizeCompanyName(extractedCompanyName || inferredCompanyName || domainCompanyName);
  // Фильтр собственных реквизитов
  const filteredCompanyName = isOwnCompanyData("company", companyName) ? null : companyName;

  // ... далее заменить companyName на filteredCompanyName:
  ```

  И в `extractRequisites` результат — после получения inn/kpp/ogrn:
  ```js
  const requisites = extractRequisites(body);
  if (isOwnCompanyData("inn", requisites?.inn)) requisites.inn = null;
  if (isOwnCompanyData("kpp", requisites?.kpp)) requisites.kpp = null;
  if (isOwnCompanyData("ogrn", requisites?.ogrn)) requisites.ogrn = null;
  ```

- [ ] **Step 6: Применить фильтр в `mergeQuotedSenderFallback` (~2571)**

  ```js
  function mergeQuotedSenderFallback(sender, quotedSender) {
    if (!sender || !quotedSender) return;

    if ((!sender.mobilePhone && !sender.cityPhone) && (quotedSender.mobilePhone || quotedSender.cityPhone)) {
      const qMobile = isOwnCompanyData("phone", quotedSender.mobilePhone) ? null : quotedSender.mobilePhone;
      const qCity   = isOwnCompanyData("phone", quotedSender.cityPhone)   ? null : quotedSender.cityPhone;
      sender.mobilePhone = qMobile || sender.mobilePhone;
      sender.cityPhone   = qCity   || sender.cityPhone;
      if (qMobile || qCity) sender.sources.phone = quotedSender.sources?.phone || "quoted_body";
    }
    // ... остальное без изменений, но добавить guard на inn и company аналогично
    if (!sender.inn && quotedSender.inn && !isOwnCompanyData("inn", quotedSender.inn)) {
      sender.inn = quotedSender.inn;
      sender.sources.inn = quotedSender.sources?.inn || "quoted_body";
    }
  ```

- [ ] **Step 7: Применить фильтр в `parseRobotFormBody` (~4192)**

  После извлечения company и inn (строки ~4235–4238) добавить:
  ```js
  const company = companyMatch?.[1]?.trim() || null;
  const filteredCompany = isOwnCompanyData("company", company) ? null : company;
  const inn = (!innMatch?.[1] || isOwnInn(innMatch[1])) ? null : innMatch[1];
  // ...
  return { ..., company: filteredCompany, ... };
  ```

- [ ] **Step 8: Запустить тесты**

  ```bash
  node tests/email-analyzer.test.js 2>&1 | tail -20
  ```
  Ожидаем: все тесты PASS, новые два — PASS.

- [ ] **Step 9: Синхронизировать и коммитить**

  ```bash
  cp src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js
  git add src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js tests/email-analyzer.test.js
  git commit -m "feat: strict own-company identity filter — OWN_COMPANY_IDENTITY blocks siderus/kolorat data in sender fields"
  ```

---

## Task 3: Блок 2 — Дедупликация артикулов, названий товаров и брендов

**Files:**
- Modify: `src/services/email-analyzer.js` (~4080 новая функция, ~1278 статьи, ~1290 бренды, ~1282 lineItems)
- Test: `tests/email-analyzer.test.js`

- [ ] **Step 1: Написать падающие тесты**

  ```js
  runTest("Дедуп: одна строка с А99L-0159-0409#SSET Novotec Ultra-Clean — 1 артикул", () => {
    const result = analyzeEmail(project, {
      subject: "Запрос",
      fromEmail: "buyer@factory.ru",
      fromName: "",
      body: "Прошу выставить КП:\nФильтроэлемент гидравлический А99L-0159-0409#SSET Novotec Ultra-Clean — 30 шт.",
      attachments: []
    });
    const articles = result.lead?.articles || [];
    // Не должно быть 99L-0159-0409 (усечённый) если есть A99L-0159-0409 (полный)
    const hasTruncated = articles.some((a) => a === "99L-0159-0409");
    const hasFull = articles.some((a) => /A99L-0159-0409/i.test(a));
    assert.ok(!hasTruncated, `Усечённый артикул 99L-0159-0409 не должен присутствовать, articles: ${articles}`);
    assert.ok(hasFull, `Полный A99L-0159-0409 должен быть, articles: ${articles}`);
  });

  runTest("Дедуп: Ultra-Clean не является артикулом (CamelWord-CamelWord без цифр)", () => {
    const result = analyzeEmail(project, {
      subject: "Запрос",
      fromEmail: "buyer@factory.ru",
      fromName: "",
      body: "Фильтроэлемент А99L-0159-0409 Novotec Ultra-Clean — 30 шт.",
      attachments: []
    });
    const articles = result.lead?.articles || [];
    assert.ok(
      !articles.some((a) => /^Ultra-Clean$/i.test(a)),
      `Ultra-Clean не должен быть артикулом, articles: ${articles}`
    );
  });

  runTest("Дедуп lineItems: одна физическая позиция не дублируется", () => {
    const result = analyzeEmail(project, {
      subject: "Запрос",
      fromEmail: "buyer@factory.ru",
      fromName: "",
      body: "Запрашиваю:\nФильтроэлемент А99L-0159-0409 Novotec Ultra-Clean — 30 шт.",
      attachments: []
    });
    const items = result.lead?.lineItems || [];
    const a99Items = items.filter((i) => /A99L-0159-0409/i.test(i.article || ""));
    assert.ok(a99Items.length <= 1, `Должна быть одна позиция A99L-0159-0409, получили ${a99Items.length}: ${JSON.stringify(a99Items)}`);
  });
  ```

- [ ] **Step 2: Запустить и убедиться что тесты падают**

  ```bash
  node tests/email-analyzer.test.js 2>&1 | grep -E "FAIL|PASS|Error" | tail -20
  ```

- [ ] **Step 3: Добавить `deduplicateByAbsorption` рядом с `unique` (~4080)**

  ```js
  /**
   * Deduplicates strings by substring absorption.
   * mode 'keep-longest': if A ⊂ B → remove A (артикулы, описания)
   * mode 'keep-shortest': if A ⊂ B → remove B (бренды — длинный = ошибочный захват)
   */
  function deduplicateByAbsorption(items, mode = "keep-longest") {
    if (!items || items.length <= 1) return items || [];
    const normalized = items.map((s) => String(s || "").toLowerCase().trim());
    return items.filter((item, i) => {
      const ni = normalized[i];
      if (!ni) return false;
      return !normalized.some((nj, j) => {
        if (i === j || !nj || nj === ni) return false;
        const absorbed = mode === "keep-longest"
          ? (nj.includes(ni) && nj.length > ni.length + 1)   // ni is shorter — drop ni
          : (ni.includes(nj) && ni.length > nj.length + 1);  // ni is longer — drop ni
        return absorbed;
      });
    });
  }
  ```

- [ ] **Step 4: Добавить `[CamelWord]-[CamelWord]` в `ARTICLE_NEGATIVE_PATTERNS` (~261)**

  Найти `const ARTICLE_NEGATIVE_PATTERNS = [`. Добавить в массив:
  ```js
  // CamelCase-CamelCase без цифр — торговое наименование, не артикул (Ultra-Clean, Super-Flow)
  /^[A-ZА-ЯЁ][a-zа-яё]{2,}-[A-ZА-ЯЁ][a-zа-яё]{2,}$/,
  ```

- [ ] **Step 5: Применить `deduplicateByAbsorption` для артикулов (~1278)**

  Найти строку:
  ```js
  const allArticles = unique([...subjectArticles, ...prefixedArticles, ...standaloneArticles, ...numericArticles, ...strongContextArticles, ...trailingMixedArticles, ...productContextArticles, ...attachmentArticles, ...brandAdjacentCodes].filter(Boolean));
  ```
  Заменить на:
  ```js
  const allArticles = deduplicateByAbsorption(
    unique([...subjectArticles, ...prefixedArticles, ...standaloneArticles, ...numericArticles, ...strongContextArticles, ...trailingMixedArticles, ...productContextArticles, ...attachmentArticles, ...brandAdjacentCodes].filter(Boolean)),
    "keep-longest"
  );
  ```

- [ ] **Step 6: Применить для брендов (~1290)**

  Найти строку:
  ```js
  let detectedBrands = detectionKb.filterOwnBrands(rawBrands);
  ```
  Заменить на:
  ```js
  let detectedBrands = detectionKb.filterOwnBrands(deduplicateByAbsorption(rawBrands, "keep-shortest"));
  ```

- [ ] **Step 7: Дедуп lineItems по нормализованному артикулу (~1282)**

  После блока `const lineItems = extractLineItems(body).filter(...)` добавить:

  ```js
  // Dedup lineItems: объединить позиции с совпадающим нормализованным артикулом
  const lineItemMap = new Map();
  for (const item of lineItems) {
    const key = normalizeArticleCode(item.article || "").toLowerCase();
    if (!key) { lineItemMap.set(Symbol(), item); continue; }
    const existing = lineItemMap.get(key);
    if (!existing) { lineItemMap.set(key, { ...item }); continue; }
    // Оставить наиболее длинное описание
    if ((item.descriptionRu || "").length > (existing.descriptionRu || "").length) {
      existing.descriptionRu = item.descriptionRu;
    }
    if ((item.sourceLine || "").length > (existing.sourceLine || "").length) {
      existing.sourceLine = item.sourceLine;
    }
  }
  const lineItemsDeduped = [...lineItemMap.values()];
  // Заменить lineItems на lineItemsDeduped ниже по коду
  ```

  И заменить все дальнейшие обращения `lineItems` на `lineItemsDeduped` в этой функции (строки ~1296–1365).

  > Примечание: Поскольку переменная `lineItems` используется как `const` + `push` ниже (freetextItems, bridge), сделать её через `let lineItems = lineItemsDeduped` вместо `const`.

- [ ] **Step 8: Запустить все тесты**

  ```bash
  node tests/email-analyzer.test.js 2>&1 | grep -c PASS && node tests/email-analyzer.test.js 2>&1 | grep FAIL
  ```
  Ожидаем: новые тесты PASS, регрессий нет.

- [ ] **Step 9: Коммит**

  ```bash
  cp src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js
  git add src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js tests/email-analyzer.test.js
  git commit -m "feat: deduplicateByAbsorption — articles/brands/lineItems dedup by substring absorption"
  ```

---

## Task 4: Блок 3 — Должности: расширенные паттерны

**Files:**
- Modify: `src/services/email-analyzer.js` (~2331 POSITION_KEYWORDS, ~2444 POSITION_SIGNATURE_PATTERN, ~2446 extractPosition)
- Test: `tests/email-analyzer.test.js`

- [ ] **Step 1: Написать падающие тесты**

  ```js
  runTest("Должность: юрист перед именем извлекается", () => {
    const result = analyzeEmail(project, {
      subject: "Запрос",
      fromEmail: "oksana@law-firm.ru",
      fromName: "",
      body: "Прошу выставить КП.\n\nС уважением,\nюрист\nКаратун Оксана Юрьевна\n8 (3462) 33-04-05",
      attachments: []
    });
    assert.ok(
      /юрист/i.test(result.sender?.position || ""),
      `Должность юрист не извлечена, получили: "${result.sender?.position}"`
    );
  });

  runTest("Должность: Менеджер отдела продаж — полная, не обрезанная", () => {
    const result = analyzeEmail(project, {
      subject: "Запрос",
      fromEmail: "irina@kolvrat.ru",
      fromName: "",
      body: "Прошу КП.\n\nС уважением,\nТарасова Ирина\nМенеджер отдела продаж\nООО КОЛОВРАТ",
      attachments: []
    });
    assert.ok(
      /Менеджер отдела продаж/i.test(result.sender?.position || ""),
      `Должность должна быть полной "Менеджер отдела продаж", получили: "${result.sender?.position}"`
    );
  });

  runTest("Должность: Procurement manager of ITER PPTF Project — латинская многословная", () => {
    const result = analyzeEmail(project, {
      subject: "Request",
      fromEmail: "a.zimmermann@gkmp32.com",
      fromName: "Anna Zimmermann",
      body: "Dear team,\n\nPlease quote for our project.\n\nAnna Zimmermann\n\nProcurement manager of ITER PPTF Project\nLLC\n\ntel. +7 (495) 150-14-50",
      attachments: []
    });
    assert.ok(
      /Procurement manager/i.test(result.sender?.position || ""),
      `Должность Procurement manager не извлечена, получили: "${result.sender?.position}"`
    );
  });
  ```

- [ ] **Step 2: Запустить и убедиться что тесты падают**

  ```bash
  node tests/email-analyzer.test.js 2>&1 | grep -E "юрист|Менеджер отдела|Procurement"
  ```

- [ ] **Step 3: Добавить шаг "должность перед именем" в `extractPosition` (~2446)**

  Найти функцию `extractPosition(body)`. После существующего KB-шага и label-шага добавить новый шаг:

  ```js
  // Новый шаг: должность-слово стоит ПЕРЕД именем (после приветствия)
  // Паттерн: "С уважением,\n<ПОЗИЦИЯ-СТРОКА>\nФамилия Имя"
  const GREETING_RE = /(?:С уважением|Best regards|Regards|Спасибо|Благодарю|Kind regards|Sincerely)[,.\s]*/i;
  const bodyLines = body.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < bodyLines.length - 1; i++) {
    if (!GREETING_RE.test(bodyLines[i])) continue;
    // Следующие 1-2 строки могут быть должностью
    const candidates = [bodyLines[i + 1], bodyLines[i + 2]].filter(Boolean);
    for (const candidate of candidates) {
      if (!candidate || candidate.length < 3 || candidate.length > 120) continue;
      // Пропустить строки-имена (Фамилия Имя)
      const looksLikeName = /^[А-ЯЁA-Z][а-яёa-z]+\s+[А-ЯЁA-Z][а-яёa-z]+/.test(candidate);
      if (looksLikeName) continue;
      // Строка начинается со слова должности или с заглавной латинской буквы (англ. должность)
      if (POSITION_KEYWORDS.test(candidate) || /^[A-Z][a-z]/.test(candidate)) {
        // Валидация: следующая строка после кандидата — имя или телефон
        const lineAfter = bodyLines[bodyLines.indexOf(candidate) + 1] || "";
        const looksLikeContext = /^[А-ЯЁA-Z][а-яёa-z]+/.test(lineAfter) || /\+7|8[-\s(]|\d{3}/.test(lineAfter);
        if (looksLikeContext) return cleanup(candidate);
      }
    }
  }
  ```

- [ ] **Step 4: Исправить `POSITION_SIGNATURE_PATTERN` (~2444) — расширить до полной строки**

  Текущий паттерн заканчивается на `\s*[^\n,]{0,50}` — это захватывает до 50 символов после должности. Увеличить до 80 и убрать ограничение по запятой:

  ```js
  const POSITION_SIGNATURE_PATTERN = /(?:^|\n)\s*((?:начальник|заместитель\s+начальника?|главный\s+(?:инженер|технолог|бухгалтер|специалист|механик)|зав\.\s*(?:отделом|кафедрой|лабораторией|складом)|заведующ(?:ий|ая)\s+\S+|руководитель\s+(?:отдела|направления|группы|проекта|службы)|ведущий\s+(?:инженер|специалист|менеджер)|генеральный\s+директор|коммерческий\s+директор|технический\s+директор|финансовый\s+директор|исполнительный\s+директор|директор\s+по\s+\S+)[^\n]{0,80})/im;
  ```
  > Убрана запятая из символов-стопов `[^\n,]` → `[^\n]` — должность может содержать запятую ("руководитель отдела закупок, снабжение").

- [ ] **Step 5: Добавить паттерн для латинских многословных должностей в `extractPosition`**

  После блока POSITION_SIGNATURE_PATTERN добавить:

  ```js
  // Латинская многословная должность: строка 10-120 символов только из латиницы, пробелов, дефисов
  // Соседняя строка — имя (2 слова с заглавными) или телефон
  const latinLines = body.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < latinLines.length; i++) {
    const line = latinLines[i];
    if (!/^[A-Za-z][A-Za-z\s\-,.\/]{9,119}$/.test(line)) continue;
    if (/@|https?:\/\//.test(line)) continue;  // не email и не URL
    if (/^(?:LLC|Ltd|Inc|Corp|GmbH|ООО|АО)$/i.test(line)) continue;  // не юрформа
    const prev = latinLines[i - 1] || "";
    const next = latinLines[i + 1] || "";
    const neighborIsName = /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(prev) || /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(next);
    const neighborIsPhone = /\+7|\+\d{1,3}\s*\(/.test(next) || /\+7|\+\d{1,3}\s*\(/.test(prev);
    if (neighborIsName || neighborIsPhone) return cleanup(line);
  }
  ```

- [ ] **Step 6: Запустить тесты**

  ```bash
  node tests/email-analyzer.test.js 2>&1 | grep -E "юрист|Менеджер отдела|Procurement|FAIL|PASS" | tail -20
  ```
  Ожидаем: все три новых теста PASS.

- [ ] **Step 7: Коммит**

  ```bash
  cp src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js
  git add src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js tests/email-analyzer.test.js
  git commit -m "feat: position extraction — single-word titles, full multi-word, latin multi-word positions"
  ```

---

## Task 5: Блок 5 — Форм-заявка: полное название товара

**Files:**
- Modify: `src/services/email-analyzer.js` (~4192 `parseRobotFormBody`, ~405 использование form-данных)
- Test: `tests/email-analyzer.test.js`

- [ ] **Step 1: Написать падающий тест**

  ```js
  runTest("Форм-заявка: полное название товара AT 051 DA F04 N 11 DS Пневмопривод", () => {
    const result = analyzeEmail(project, {
      subject: "Заполнена форма \"Товар под заказ\" на сайте SIDERUS (8413)",
      fromEmail: "robot@siderus.ru",
      fromName: "",
      body: `Заполнена форма "Товар под заказ" на сайте SIDERUS (8413)
Имя посетителя: ООО"РЕЦЕПС" Николай
Телефон:
Email: recepson@mail.ru
WhatsApp:
Название товара: AT 051 DA F04 N 11 DS Пневмопривод
Ссылка на товар: https://siderus.ru/orders/processed/at-051-da-f04-n-11-ds-pnevmoprivod/
ID товара: 1056655
Название организации:
ИНН:
Сообщение:
Страница отправки: https://siderus.ru/orders/processed/at-051-da-f04-n-11-ds-pnevmoprivod/
Запрос отправлен: 13.04.2026 12:52:24`,
      attachments: []
    });
    const items = result.lead?.lineItems || [];
    const descriptions = items.map((i) => i.descriptionRu || i.description || "").join(" ");
    assert.ok(
      /AT 051 DA F04 N 11 DS Пневмопривод/i.test(descriptions),
      `Полное название товара не найдено в lineItems, получили: ${JSON.stringify(items.map((i) => ({ article: i.article, desc: i.descriptionRu })))}`
    );
  });
  ```

- [ ] **Step 2: Запустить и убедиться что тест падает**

  ```bash
  node tests/email-analyzer.test.js 2>&1 | grep "AT 051"
  ```

- [ ] **Step 3: Добавить `extractFirstArticleToken` (~4080 рядом с утилитами)**

  ```js
  /**
   * Из строки вида "AT 051 DA F04 N 11 DS Пневмопривод" берёт всё до первого кириллического слова.
   * Возвращает { article: "AT 051 DA F04 N 11 DS", description: "Пневмопривод" }
   */
  function splitProductNameFromArticle(text) {
    if (!text) return { article: null, description: text };
    const t = text.trim();
    // Найти первое кириллическое слово — оно начинает текстовое описание
    const cyrMatch = t.match(/^([\s\S]*?)\s+([А-ЯЁа-яё].*)$/);
    if (cyrMatch && cyrMatch[1].trim()) {
      return { article: cyrMatch[1].trim(), description: t };
    }
    return { article: t, description: t };
  }
  ```

- [ ] **Step 4: Обновить `parseRobotFormBody` (~4192)**

  Найти строки:
  ```js
  const productMatch = formSection.match(/(?:Название\s+товара|Продукт|Товар|Запрос|Артикул|Наименование):\s*(.+?)[\r\n]/i);
  const product = productMatch?.[1]?.trim() || null;
  ```
  Заменить на:
  ```js
  const productMatch = formSection.match(
    /(?:Название\s+товара|Наименование\s+товара|Наименование|Продукт|Товар|Запрос|Артикул\s+товара|Артикул|Модель|Позиция):\s*(.+?)[\r\n]/i
  );
  const productRaw = productMatch?.[1]?.trim() || null;
  const { article: product, description: productFullName } = splitProductNameFromArticle(productRaw);
  ```

  И в `return` этой функции (~4253) добавить `productFullName`:
  ```js
  return { name, email, phone, product, productFullName, message, company: filteredCompany, inn, quantity, kpForm: kpFormMatch, hasAttachmentForm, formSection, isResume };
  ```

- [ ] **Step 5: Использовать `productFullName` при построении lineItems (~405)**

  Найти блок где form-данные создают lineItem. Найти `activeFormData` в использовании (~строка 404–470). В месте где из формы строится lineItem (обычно через `freetextItems` или напрямую), убедиться что description берётся из `productFullName`:

  ```js
  // После: const activeFormData = robotFormData || tildaFormData || quotedRobotFormData;
  // При построении lineItems из формы добавить:
  if (activeFormData?.productFullName && activeFormData?.product) {
    // Если в lineItems нет позиции с этим артикулом — добавить с полным описанием
    const formArticle = normalizeArticleCode(activeFormData.product);
    if (formArticle && !lineItems.some((i) => normalizeArticleCode(i.article || "") === formArticle)) {
      lineItems.push({
        article: activeFormData.product,
        descriptionRu: activeFormData.productFullName,
        source: "form",
        explicitArticle: true,
        quantity: activeFormData.quantity?.value ? Number(activeFormData.quantity.value) : null,
        unit: activeFormData.quantity?.unit || null
      });
    } else if (formArticle) {
      // Обновить описание существующей позиции
      const existing = lineItems.find((i) => normalizeArticleCode(i.article || "") === formArticle);
      if (existing && (!existing.descriptionRu || existing.descriptionRu === existing.article)) {
        existing.descriptionRu = activeFormData.productFullName;
      }
    }
  }
  ```

- [ ] **Step 6: Запустить тесты**

  ```bash
  node tests/email-analyzer.test.js 2>&1 | grep -E "AT 051|FAIL|форм" | tail -20
  ```
  Ожидаем: тест PASS.

- [ ] **Step 7: Коммит**

  ```bash
  cp src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js
  git add src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js tests/email-analyzer.test.js
  git commit -m "feat: form product name — preserve full description alongside article code"
  ```

---

## Task 6: Блок 6 — Мультибренд: ложный флаг из тела

**Files:**
- Modify: `src/services/email-analyzer.js` (~1410 requestType, новые функции)
- Test: `tests/email-analyzer.test.js`

- [ ] **Step 1: Написать падающие тесты**

  ```js
  runTest("Мультибренд: каталожный текст с несколькими брендами — не Мультибрендовая", () => {
    const result = analyzeEmail(project, {
      subject: "Вопрос",
      fromEmail: "buyer@plant.ru",
      fromName: "",
      body: "Добрый день! Мы также работаем с такими производителями как ABB, Siemens, Schneider Electric. Можем предложить широкий ассортимент. Пожалуйста, уточните наличие.",
      attachments: []
    });
    assert.notEqual(
      result.lead?.requestType, "Мультибрендовая",
      `Каталожный текст не должен давать Мультибрендовую, получили: "${result.lead?.requestType}"`
    );
  });

  runTest("Мультибренд: два артикула разных брендов в теме — Мультибрендовая", () => {
    // Используем бренды из project.brands
    const result = analyzeEmail(project, {
      subject: "Запрос ABB ACS580-01 и Schneider Electric ATV320",
      fromEmail: "buyer@plant.ru",
      fromName: "",
      body: "Прошу КП на ABB ACS580-01 — 1 шт. и Schneider Electric ATV320U07M2B — 1 шт.",
      attachments: []
    });
    assert.equal(
      result.lead?.requestType, "Мультибрендовая",
      `Два бренда с артикулами должны дать Мультибрендовую, получили: "${result.lead?.requestType}"`
    );
  });
  ```

- [ ] **Step 2: Запустить и убедиться что первый тест падает**

  ```bash
  node tests/email-analyzer.test.js 2>&1 | grep "Каталожный текст"
  ```

- [ ] **Step 3: Добавить константу и функцию перед `buildIntakeFlow` (~2139)**

  ```js
  // Фразы каталожного контекста — бренды из этих предложений считаются weak
  const CATALOG_CONTEXT_PHRASES = /(?:также\s+работаем|можем\s+предложить|есть\s+в\s+наличии|поставляем|в\s+том\s+числе|широкий\s+ассортимент|официальный\s+дилер|дистрибьютор|представитель|authorized\s+dealer|distributor)/i;

  /**
   * Оценивает силу сигнала бренда в тексте.
   * Возвращает 'strong' (реальный запрос) или 'weak' (каталожный / упоминание).
   */
  function classifyBrandSignal(brand, bodyText, subjectText = "") {
    // strong: бренд в теме письма
    if (subjectText && new RegExp(escapeRegExp(brand), "i").test(subjectText)) return "strong";

    const brandRe = new RegExp(escapeRegExp(brand), "i");
    const lines = bodyText.split(/\n/);
    for (const line of lines) {
      if (!brandRe.test(line)) continue;
      // strong: рядом с артикулом или количеством
      if (ARTICLE_CONTEXT_POSITIVE_PATTERNS.some((p) => p.test(line))) return "strong";
      if (/\b\d+\s*(?:шт|штук|ед|компл|пар|м|кг|л)\b/i.test(line)) return "strong";
      // weak: в каталожном предложении
      if (CATALOG_CONTEXT_PHRASES.test(line)) return "weak";
    }
    // По умолчанию: бренд в теле без артикула — weak
    return "weak";
  }
  ```

- [ ] **Step 4: Заменить логику `requestType` (~1410)**

  Найти строку:
  ```js
  requestType: detectedBrands.length > 1 ? "Мультибрендовая" : detectedBrands.length === 1 ? "Монобрендовая" : ...
  ```
  Заменить на:
  ```js
  requestType: (() => {
    if (detectedBrands.length === 0) {
      return finalArticles.length > 0 || detectedProductTypes.length > 0
        ? "Не определено (есть артикулы)" : "Не определено";
    }
    if (detectedBrands.length === 1) return "Монобрендовая";
    // Несколько брендов: проверить силу сигнала
    const signals = detectedBrands.map((b) => classifyBrandSignal(b, body, subject));
    const strongCount = signals.filter((s) => s === "strong").length;
    if (strongCount >= 2) return "Мультибрендовая";
    if (strongCount >= 1 && signals.some((s) => s === "weak")) return "Мультибрендовая";
    return "Монобрендовая"; // все weak — считаем монобрендовой по основному бренду
  })()
  ```

- [ ] **Step 5: Запустить тесты**

  ```bash
  node tests/email-analyzer.test.js 2>&1 | grep -E "Каталожный|два артикула|FAIL" | tail -20
  ```
  Ожидаем: оба теста PASS.

- [ ] **Step 6: Коммит**

  ```bash
  cp src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js
  git add src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js tests/email-analyzer.test.js
  git commit -m "feat: classifyBrandSignal — weak catalog brands no longer trigger multi_brand flag"
  ```

---

## Task 7: Блок 7 — Флаг массового запроса по CC/To

**Files:**
- Modify: `project 3/mailbox_file_runner.py` (~187 dict сообщения)
- Modify: `src/services/email-analyzer.js` (~316 `analyzeEmail` payload, ~2139 `buildIntakeFlow`)
- Modify: `src/server.js` (~вызовы analyzeEmail, передача cc/toRecipients)
- Test: `tests/email-analyzer.test.js`

- [ ] **Step 1: Написать падающий тест**

  ```js
  runTest("Флаг массового запроса: CC с двумя внешними адресами", () => {
    const result = analyzeEmail(project, {
      subject: "Запрос КП",
      fromEmail: "buyer@somecompany.ru",
      fromName: "Иван",
      body: "Прошу КП на ABB ACS580-01 — 1 шт.",
      attachments: [],
      cc: ["supplier2@other.ru", "supplier3@third.ru"]
    });
    assert.ok(
      result.intakeFlow?.flags?.includes("mass_request"),
      `Ожидался флаг mass_request при CC >= 2, intakeFlow: ${JSON.stringify(result.intakeFlow)}`
    );
  });

  runTest("Флаг массового запроса: CC пустой — флага нет", () => {
    const result = analyzeEmail(project, {
      subject: "Запрос КП",
      fromEmail: "buyer@somecompany.ru",
      fromName: "Иван",
      body: "Прошу КП на ABB ACS580-01.",
      attachments: [],
      cc: []
    });
    assert.ok(
      !(result.intakeFlow?.flags || []).includes("mass_request"),
      `Флаг mass_request не должен быть при пустом CC`
    );
  });
  ```

- [ ] **Step 2: Запустить и убедиться что тесты падают**

  ```bash
  node tests/email-analyzer.test.js 2>&1 | grep "mass_request"
  ```

- [ ] **Step 3: Обновить `analyzeEmail` — принять `cc` и `toRecipients` из payload (~316)**

  В начале `analyzeEmail` после парсинга `fromEmail`:
  ```js
  const rawCc = (payload.cc || []).map((a) => String(a).toLowerCase().trim());
  const rawToRecipients = (payload.toRecipients || []).map((a) => String(a).toLowerCase().trim());
  // Фильтруем собственные адреса
  const externalCc = rawCc.filter((a) => !isOwnCompanyData("email", a) && a !== fromEmail);
  const externalTo = rawToRecipients.filter((a) => !isOwnCompanyData("email", a) && a !== fromEmail);
  const isMassRequest = externalCc.length >= 2
    || (externalCc.length >= 1 && externalCc.some((a) => a.split("@")[1] !== fromEmail.split("@")[1]));
  ```

- [ ] **Step 4: Передать `isMassRequest` в `buildIntakeFlow` (~713)**

  Найти строку:
  ```js
  intakeFlow: buildIntakeFlow(classification.label, crm, lead),
  ```
  Заменить на:
  ```js
  intakeFlow: buildIntakeFlow(classification.label, crm, lead, { isMassRequest }),
  ```

- [ ] **Step 5: Обновить `buildIntakeFlow` (~2139)**

  ```js
  function buildIntakeFlow(classification, crm, lead, meta = {}) {
    // ... существующий код ...
    const flags = [];
    if (meta.isMassRequest) flags.push("mass_request");

    return {
      parseToFields: !isSpam,
      requestClarification: crm.needsClarification,
      createClientInCrm: isClient && !crm.isExistingCompany && !requiresReview,
      createRequestInCrm: isClient && !requiresReview,
      assignMop: crm.curatorMop,
      assignMoz: crm.curatorMoz,
      requestType: lead.requestType,
      requiresReview,
      reviewReason: requiresReview
        ? blockingConflicts.length > 0 ? "detection_conflicts" : "low_completeness"
        : null,
      isVendorInquiry: isVendor,
      skipCrmSync: isSpam || isVendor,
      flags,                              // ← новое поле
      syncPriority: flags.includes("mass_request") ? "low" : "normal"  // ← новое поле
    };
  }
  ```

- [ ] **Step 6: Обновить Python runner — добавить CC/To поля**

  В `project 3/mailbox_file_runner.py` найти dict сообщения (~строка 187). Добавить поля:
  ```python
  import email.utils  # добавить в импорты вверху файла если нет

  # В fetch_account_emails, после строки "references": ...
  "cc": [addr for name, addr in email.utils.getaddresses([decode_value(message.get("Cc", ""))]) if addr],
  "toRecipients": [addr for name, addr in email.utils.getaddresses([decode_value(message.get("To", ""))]) if addr],
  ```

- [ ] **Step 7: Проверить что python импорт есть**

  ```bash
  head -20 "project 3/mailbox_file_runner.py"
  ```
  Если `import email.utils` отсутствует, добавить в начало файла.

- [ ] **Step 8: Запустить тесты**

  ```bash
  node tests/email-analyzer.test.js 2>&1 | grep -E "mass_request|FAIL" | tail -20
  ```
  Ожидаем: оба теста PASS.

- [ ] **Step 9: Коммит**

  ```bash
  cp src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js
  git add src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js \
       "project 3/mailbox_file_runner.py" tests/email-analyzer.test.js
  git commit -m "feat: mass_request flag — CC/To >= 2 external recipients marks bulk tender inquiry"
  ```

---

## Task 8: Финальный прогон тестов и проверка регрессий

**Files:** нет изменений кода

- [ ] **Step 1: Полный прогон тестов**

  ```bash
  node tests/email-analyzer.test.js 2>&1
  ```
  Ожидаем: все тесты PASS. Допустимы только 3 pre-existing failure (docx/xlsx/company-directory).

- [ ] **Step 2: Проверить синхронизацию railway-deploy**

  ```bash
  diff src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js
  diff src/server.js .railway-deploy/src/server.js
  diff public/app.js .railway-deploy/public/app.js
  ```
  Ожидаем: нет различий.

- [ ] **Step 3: Итоговый коммит если нужен**

  ```bash
  git status
  ```
  Если есть несинхронизированные файлы — добавить и закоммитить.

---

## Self-Review Checklist

- [x] Блок 1 (вложения): перенос маршрута + `?token=` в frontend
- [x] Блок 2 (дедуп): `deduplicateByAbsorption` для артикулов, брендов, lineItems
- [x] Блок 3 (должности): шаг "позиция перед именем", латинский паттерн, полная строка
- [x] Блок 4 (реквизиты): `OWN_COMPANY_IDENTITY` + `isOwnCompanyData` в 5 точках
- [x] Блок 5 (форм-товар): `splitProductNameFromArticle`, `productFullName` в return + lineItems
- [x] Блок 6 (мультибренд): `classifyBrandSignal`, новая логика `requestType`
- [x] Блок 7 (CC-флаг): Python CC/To, `isMassRequest`, `flags`, `syncPriority` в `buildIntakeFlow`
- [x] Все тесты используют `runTest()` паттерн
- [x] Все изменённые файлы синхронизируются в `.railway-deploy/`
- [x] `normalizePhoneNumber` используется в `isOwnCompanyData` — определена позже в файле, но это нормально (не const-стрелка)
