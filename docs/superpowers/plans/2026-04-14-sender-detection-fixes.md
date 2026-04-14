# Sender Detection Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить 5 багов детекции сендера в `email-analyzer.js`: ФИО не определяется из подписи, org-unit display name используется как имя, форма перебивает полное имя, ЭДО-идентификатор попадает в артикулы, должность не извлекается.

**Architecture:** Все правки — точечные изменения в одном файле `src/services/email-analyzer.js`. Порядок: от простых и независимых (ЭДО-фильтр, форма-override) к более сложным (ФИО-паттерны, позиция). Каждый таск — отдельный коммит.

**Tech Stack:** Node.js ESM, `node:assert`, `node:test` (plain test runner), `node tests/email-analyzer.test.js`

---

## Task 1: Fix — ЭДО-идентификатор не попадает в артикулы

**Files:**
- Modify: `src/services/email-analyzer.js:279` (ARTICLE_GARBAGE_PATTERNS)
- Modify: `src/services/email-analyzer.js:3792` (isGarbage runtime check)
- Test: `tests/email-analyzer.test.js`

**Проблема:** `2BM-0278106553-2012052808163395382630000000000` попадает в артикулы. Существующий паттерн `/^BM-\d{7,}(?:-\d{7,})+$/i` не покрывает `2BM-...` и длинные сегменты произвольной длины.

- [ ] **Шаг 1: Написать падающий тест**

Добавить в конец `tests/email-analyzer.test.js` (перед последней строкой, если есть):

```js
runTest("ЭДО-идентификатор Диадок не попадает в артикулы", async () => {
  const result = await analyzeEmail({
    subject: "Запрос",
    fromEmail: "artur@oilgis.ru",
    fromName: "",
    body: `Добрый день\nИнтересует поставка:\n1. Насос Bieri AKP20-0,012-300-V\n\nАлик Шарифгалиев М.\nООО ОйлГИС\n8 903 351 9285\n\nНаше предприятие работает в ЭДО Диадок\nИдентификатор 2BM-0278106553-2012052808163395382630000000000\nОжидаем приглашения на обмен`,
    attachments: []
  }, project);
  const articles = result.lead?.articles || [];
  const edoInArticles = articles.some(a => /^2BM-/i.test(a));
  assert.equal(edoInArticles, false, `ЭДО-идентификатор не должен быть артикулом, найдено: ${articles.join(", ")}`);
});
```

- [ ] **Шаг 2: Запустить тест — убедиться что падает**

```bash
node tests/email-analyzer.test.js 2>&1 | grep -E "PASS|FAIL|ЭДО"
```

Ожидаем: `FAIL ЭДО-идентификатор Диадок не попадает в артикулы`

- [ ] **Шаг 3: Исправить ARTICLE_GARBAGE_PATTERNS**

В `src/services/email-analyzer.js`, строка ~279, заменить:

```js
  // Diadoc/EDO document numbers: BM-9701077015-770101001
  /^BM-\d{7,}(?:-\d{7,})+$/i
```

на:

```js
  // Diadoc/EDO document numbers: BM-..., 2BM-... (любая длина сегментов)
  /^[02]?[A-ZА-ЯЁ]{1,3}-\d{7,}(?:-\d+)*$/i
```

- [ ] **Шаг 4: Исправить runtime-проверку в isGarbage**

В `src/services/email-analyzer.js`, строка ~3792, заменить:

```js
  // Russian PFR (pension fund) registration codes: 2BM-9701077015-770101001, BM-9701077015
  if (/^[02]?[A-ZА-Я]{1,2}-\d{10}(?:-\d{9})?$/i.test(normalized)) return true;
```

на:

```js
  // Diadoc/EDO/PFR registration codes: 2BM-INN-TIMESTAMP, BM-INN, etc.
  if (/^[02]?[A-ZА-ЯЁ]{1,3}-\d{7,}(?:-\d+)*$/i.test(normalized)) return true;
```

- [ ] **Шаг 5: Запустить тест — убедиться что проходит**

```bash
node tests/email-analyzer.test.js 2>&1 | grep -E "PASS|FAIL|ЭДО"
```

Ожидаем: `PASS ЭДО-идентификатор Диадок не попадает в артикулы`

- [ ] **Шаг 6: Прогнать все тесты**

```bash
npm test 2>&1 | tail -20
```

Ожидаем: все ранее проходившие тесты всё ещё проходят.

- [ ] **Шаг 7: Коммит**

```bash
git add src/services/email-analyzer.js tests/email-analyzer.test.js
git commit -m "fix: filter Diadoc/EDO identifiers (2BM-...) from articles"
```

---

## Task 2: Fix — Форма не перезаписывает полное display name

**Files:**
- Modify: `src/services/email-analyzer.js:388`
- Test: `tests/email-analyzer.test.js`

**Проблема:** `quotedRobotFormData.name = "Алиса"` (одно слово из "Имя посетителя: Алиса") перезаписывает `fromName = "Алиса Гурьева"` (два слова из From-заголовка).

- [ ] **Шаг 1: Написать падающий тест**

Добавить в `tests/email-analyzer.test.js`:

```js
runTest("Форма не перезаписывает полное display name (Алиса Гурьева → Алиса)", async () => {
  // Симулируем ответ на форму: fromName из заголовка — полное имя,
  // но цитированная форма содержит только имя
  const result = await analyzeEmail({
    subject: "Re: FW: Вопрос через обратную связь с сайта SIDERUS",
    fromEmail: "gurevaa18@mail.ru",
    fromName: "Алиса Гурьева",
    body: `-\nАлиса Гурьева\nОтправлено из Почты Mail\n\n> Четверг, 9 апреля 2026, 17:30 +03:00 от SIDERUS:\n>\n> -----Original Message-----\n> From: robot@siderus.ru\n> Subject: Вопрос через обратную связь с сайта SIDERUS\n>\n> Новый вопрос на сайте SIDERUS (8391)\n> Имя посетителя: Алиса\n> Телефон:+7 917 908-14-54\n> Email: gurevaa18@mail.ru\n> Вопрос: Прошу указать цену\n> Модуль управления MV2067512015 IGEL - 2шт`,
    attachments: []
  }, project);
  assert.equal(result.sender?.fullName, "Алиса Гурьева", `Ожидали "Алиса Гурьева", получили "${result.sender?.fullName}"`);
});
```

- [ ] **Шаг 2: Запустить тест — убедиться что падает**

```bash
node tests/email-analyzer.test.js 2>&1 | grep -E "PASS|FAIL|Форма не перезаписывает"
```

Ожидаем: `FAIL Форма не перезаписывает полное display name`

- [ ] **Шаг 3: Исправить override логику**

В `src/services/email-analyzer.js`, строка ~388, заменить:

```js
    if (quotedRobotFormData.name) fromName = quotedRobotFormData.name;
```

на:

```js
    if (quotedRobotFormData.name) {
      const currentWords = fromName.trim().split(/\s+/).filter(Boolean).length;
      const formWords = quotedRobotFormData.name.trim().split(/\s+/).filter(Boolean).length;
      // Перезаписываем только если форма даёт больше информации (больше слов)
      if (formWords > currentWords) fromName = quotedRobotFormData.name;
    }
```

- [ ] **Шаг 4: Запустить тест — убедиться что проходит**

```bash
node tests/email-analyzer.test.js 2>&1 | grep -E "PASS|FAIL|Форма не перезаписывает"
```

Ожидаем: `PASS Форма не перезаписывает полное display name`

- [ ] **Шаг 5: Прогнать все тесты**

```bash
npm test 2>&1 | tail -20
```

- [ ] **Шаг 6: Коммит**

```bash
git add src/services/email-analyzer.js tests/email-analyzer.test.js
git commit -m "fix: quoted form name doesn't override longer display name"
```

---

## Task 3: Fix — Org-unit display name не используется как ФИО

**Files:**
- Modify: `src/services/email-analyzer.js:1191` (extractSender)
- Test: `tests/email-analyzer.test.js`

**Проблема:** `fromName = "филиал «НТИИМ»"` — это подразделение, не человек. Система использует его как ФИО напрямую, реальное имя "Бастрыкова Мария" из подписи игнорируется.

- [ ] **Шаг 1: Написать падающий тест**

Добавить в `tests/email-analyzer.test.js`:

```js
runTest("Org-unit display name не используется как ФИО — находим Бастрыкову Марию", async () => {
  // Тест намеренно использует подпись с телефоном-соседом (не зависит от Task 4),
  // чтобы убедиться что isOrgUnitName работает независимо
  const result = await analyzeEmail({
    subject: "Запрос коммерческого предложения",
    fromEmail: "sfkzc@ntiim.ru",
    fromName: "филиал «НТИИМ»",
    body: `Доброе утро!\nПросьба выставить коммерческое предложение на поставку:\n1. Считывающей головки RA26BTA104B50F - 2 шт.\n\n--\nБастрыкова Мария\n+7(3435)47-51-24\nФилиал «НТИИМ» ФКП«НИО«ГБИП России»\nНижний Тагил, ул. Гагарина, д. 29\nИНН 5023002050`,
    attachments: []
  }, project);
  assert.equal(
    result.sender?.fullName, "Бастрыкова Мария",
    `Ожидали "Бастрыкова Мария", получили "${result.sender?.fullName}"`
  );
});
```

> **Примечание:** этот тест использует упрощённую подпись (телефон сразу после имени). Полный случай "С уважением,\nначальник СФКЗЦ\nБастрыкова Мария" покрывается в Task 4 (тест "С уважением + строка должности + имя").

- [ ] **Шаг 2: Запустить тест — убедиться что падает**

```bash
node tests/email-analyzer.test.js 2>&1 | grep -E "PASS|FAIL|Org-unit"
```

Ожидаем: `FAIL Org-unit display name не используется как ФИО`

- [ ] **Шаг 3: Добавить функцию isOrgUnitName**

В `src/services/email-analyzer.js`, найти строку `function extractSender(` (~строка 1175) и **перед ней** добавить:

```js
const ORG_UNIT_PREFIXES = /^(?:филиал|отдел|цех|управление|департамент|служба|лаборатория|сектор|группа|подразделение|division|department|branch)\b/i;

function isOrgUnitName(str) {
  if (!str) return false;
  const s = str.trim();
  // Начинается с названия подразделения
  if (ORG_UNIT_PREFIXES.test(s)) return true;
  // Одно слово полностью в верхнем регистре / аббревиатура (СФКЗЦ, НТИИМ и т.п.)
  if (/^[«"]?[А-ЯЁA-Z][А-ЯЁA-Z0-9\-«»"']+[»"]?$/.test(s) && !/\s/.test(s)) return true;
  return false;
}
```

- [ ] **Шаг 4: Изменить логику fullName в extractSender**

В `src/services/email-analyzer.js`, строка ~1191, заменить:

```js
  const fullName = fromName || extractFullNameFromBody(body) || inferNameFromEmail(fromEmail) || "Не определено";
```

на:

```js
  const nameFromDisplay = isOrgUnitName(fromName) ? null : fromName;
  const fullName = nameFromDisplay || extractFullNameFromBody(body) || inferNameFromEmail(fromEmail) || "Не определено";
```

- [ ] **Шаг 5: Запустить тест — убедиться что проходит**

```bash
node tests/email-analyzer.test.js 2>&1 | grep -E "PASS|FAIL|Org-unit"
```

Ожидаем: `PASS Org-unit display name не используется как ФИО`

- [ ] **Шаг 6: Прогнать все тесты**

```bash
npm test 2>&1 | tail -20
```

- [ ] **Шаг 7: Коммит**

```bash
git add src/services/email-analyzer.js tests/email-analyzer.test.js
git commit -m "fix: skip org-unit display names as fullName, extract real name from signature"
```

---

## Task 4: Fix — ФИО: паттерны для "Имя Фамилия И." и компания как контекст

**Files:**
- Modify: `src/services/email-analyzer.js:2317-2366` (extractFullNameFromBody)
- Test: `tests/email-analyzer.test.js`

**Проблема:** "Алик Шарифгалиев М." не матчится: `cyrillic2words` не принимает заглавную с точкой, `hasContext` не принимает "ООО ОйлГИС" как контекст. Также "С уважением" + позиция-строка + имя не парсится.

- [ ] **Шаг 1: Написать падающие тесты**

Добавить в `tests/email-analyzer.test.js`:

```js
runTest("ФИО: Имя Фамилия И. из подписи без приветствия (oilgis)", async () => {
  const result = await analyzeEmail({
    subject: "Re: Запрос",
    fromEmail: "artur@oilgis.ru",
    fromName: "",
    body: `Добрый день\nИнтересует поставка:\n1. Насос Bieri AKP20-0,012-300-V\n\n--\nАлик Шарифгалиев М.\nООО ОйлГИС\n8 903 351 9285`,
    attachments: []
  }, project);
  assert.equal(
    result.sender?.fullName, "Алик Шарифгалиев М.",
    `Ожидали "Алик Шарифгалиев М.", получили "${result.sender?.fullName}"`
  );
});

runTest("ФИО: С уважением + строка должности + имя (ntiim)", async () => {
  const result = await analyzeEmail({
    subject: "Запрос",
    fromEmail: "test@example.ru",
    fromName: "",
    body: `Прошу выставить КП на поставку деталей.\n\nС уважением,\nначальник отдела закупок\nИванов Сергей\n+7 912 345-67-89`,
    attachments: []
  }, project);
  assert.equal(
    result.sender?.fullName, "Иванов Сергей",
    `Ожидали "Иванов Сергей", получили "${result.sender?.fullName}"`
  );
});
```

- [ ] **Шаг 2: Запустить тесты — убедиться что падают**

```bash
node tests/email-analyzer.test.js 2>&1 | grep -E "PASS|FAIL|Имя Фамилия|С уважением"
```

Ожидаем: оба FAIL

- [ ] **Шаг 3: Расширить cyrillic2words и hasContext в структурном блоке**

В `src/services/email-analyzer.js`, строки 2352-2362, заменить:

```js
    // Candidate: 2-3 words, each Title-cased, no digits/special chars
    const cyrillic2words = /^([А-ЯЁ][а-яё]{1,19})(?:\s+([А-ЯЁ][а-яё]{1,19})){1,2}$/u.test(line);
    const latin2words = /^([A-Z][a-z]{1,19})(?:\s+([A-Z][a-z]{1,19})){1,2}$/.test(line);
    // "Фамилия И.В." or "Фамилия И. В." — surname + initials (very common in RU business email)
    const surnameInitials = /^([А-ЯЁ][а-яё]{2,20})\s+([А-ЯЁ]\.\s*[А-ЯЁ]\.?)$/.test(line);

    if (!cyrillic2words && !latin2words && !surnameInitials) continue;

    // Verify next or previous line looks like context (position, phone, email, company)
    const neighbor = lines[i + 1] || lines[i - 1] || "";
    const hasContext = /(?:\+7|8[-\s(]|tel:|mob:|e-?mail:|@|менеджер|инженер|директор|специалист|manager|engineer|sales)/i.test(neighbor);
```

на:

```js
    // Candidate: 2-3 words, each Title-cased, no digits/special chars
    const cyrillic2words = /^([А-ЯЁ][а-яё]{1,19})(?:\s+([А-ЯЁ][а-яё]{1,19})){1,2}$/u.test(line);
    const latin2words = /^([A-Z][a-z]{1,19})(?:\s+([A-Z][a-z]{1,19})){1,2}$/.test(line);
    // "Фамилия И.В." or "Фамилия И. В." — surname + initials (very common in RU business email)
    const surnameInitials = /^([А-ЯЁ][а-яё]{2,20})\s+([А-ЯЁ]\.\s*[А-ЯЁ]\.?)$/.test(line);
    // "Имя Фамилия И." or "Фамилия И.О." — два слова + один инициал с точкой
    const cyrillicWithInitial = /^([А-ЯЁ][а-яё]{1,19})\s+([А-ЯЁ][а-яё]{1,19})\s+([А-ЯЁ]\.(?:\s*[А-ЯЁ]\.)?)$/.test(line);
    // "Ф. И. О." — только инициалы (не достаточно для имени, пропускаем)
    const onlyInitials = /^([А-ЯЁ]\.\s*){2,3}$/.test(line);

    if (onlyInitials) continue;
    if (!cyrillic2words && !cyrillicWithInitial && !latin2words && !surnameInitials) continue;

    // Verify next or previous line looks like context (position, phone, email, company)
    const neighbor = lines[i + 1] || lines[i - 1] || "";
    const hasContext = /(?:\+7|8[-\s(]|tel:|mob:|e-?mail:|@|менеджер|инженер|директор|специалист|начальник|заместитель|руководитель|главный|бухгалтер|manager|engineer|sales|ООО|АО\b|ОАО|ЗАО|ПАО|ИП\b|ГК\b|НПО|НПП|Филиал|ФГУП|МУП)/i.test(neighbor);
```

- [ ] **Шаг 4: Расширить паттерн "С уважением + должность + имя"**

В `src/services/email-analyzer.js`, строки 2317-2321, заменить:

```js
  // "С уважением, [ООО/АО/...] Фамилия Имя [Отчество]" — company before name
  const signatureWithCompany = body.match(
    /(?:С уважением|Благодарю|Спасибо)[,.\s]*\n?\s*(?:(?:ООО|АО|ОАО|ЗАО|ПАО|ГК|НПО|НПП|ИП)\s+[^\n,]{2,40}[,\n]\s*)?([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/i
  );
  if (signatureWithCompany) return signatureWithCompany[1].trim();
```

на:

```js
  // "С уважением, [ООО/АО/...] Фамилия Имя [Отчество]" — company before name
  const signatureWithCompany = body.match(
    /(?:С уважением|Благодарю|Спасибо)[,.\s]*\n?\s*(?:(?:ООО|АО|ОАО|ЗАО|ПАО|ГК|НПО|НПП|ИП)\s+[^\n,]{2,40}[,\n]\s*)?([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/i
  );
  if (signatureWithCompany) return signatureWithCompany[1].trim();

  // "С уважением,\n[строка должности]\nФамилия Имя" — позиция между приветствием и именем
  const signatureWithPosition = body.match(
    /(?:С уважением|Благодарю|Спасибо)[,.\s]*\r?\n\s*[^\n]{3,60}\r?\n\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})/i
  );
  if (signatureWithPosition) {
    const candidate = signatureWithPosition[1].trim();
    // Пропустить если это название юрлица, а не имя
    if (!/^(?:ООО|АО|ОАО|ЗАО|ПАО|ИП|ГК|НПО|НПП|ФГУП|МУП|Филиал)\b/i.test(candidate)) {
      return candidate;
    }
  }
```

- [ ] **Шаг 5: Запустить тесты — убедиться что проходят**

```bash
node tests/email-analyzer.test.js 2>&1 | grep -E "PASS|FAIL|Имя Фамилия|С уважением"
```

Ожидаем: оба PASS

- [ ] **Шаг 6: Прогнать все тесты**

```bash
npm test 2>&1 | tail -20
```

- [ ] **Шаг 7: Коммит**

```bash
git add src/services/email-analyzer.js tests/email-analyzer.test.js
git commit -m "fix: extract name with initial (Имя Фамилия И.), company as context, position between greeting and name"
```

---

## Task 5: Fix — Должность из структуры подписи (fallback)

**Files:**
- Modify: `src/services/email-analyzer.js:2391-2395` (extractPosition)
- Test: `tests/email-analyzer.test.js`

**Проблема:** "начальник СФКЗЦ" не извлекается — KB не содержит паттерна для "начальник [аббревиатура]". Нужен regex-fallback для типичных должностей в подписи.

- [ ] **Шаг 1: Написать падающий тест**

Добавить в `tests/email-analyzer.test.js`:

```js
runTest("Должность: начальник СФКЗЦ извлекается из подписи", async () => {
  const result = await analyzeEmail({
    subject: "Запрос КП",
    fromEmail: "sfkzc@ntiim.ru",
    fromName: "",
    body: `Просьба выставить КП на поставку:\n1. Считывающая головка RA26BTA104B50F - 2 шт.\n\n--\nС уважением,\nначальник СФКЗЦ\nБастрыкова Мария\n+7(3435)47-51-24\nИНН 5023002050`,
    attachments: []
  }, project);
  assert.ok(
    result.sender?.position,
    `Должность не должна быть пустой, получили: "${result.sender?.position}"`
  );
  assert.match(
    result.sender?.position,
    /начальник/i,
    `Должность должна содержать "начальник", получили: "${result.sender?.position}"`
  );
});
```

- [ ] **Шаг 2: Запустить тест — убедиться что падает**

```bash
node tests/email-analyzer.test.js 2>&1 | grep -E "PASS|FAIL|начальник СФКЗЦ"
```

Ожидаем: `FAIL Должность: начальник СФКЗЦ извлекается из подписи`

- [ ] **Шаг 3: Расширить extractPosition**

В `src/services/email-analyzer.js`, строки 2391-2395, заменить:

```js
function extractPosition(body) {
  // Improvement 4: use matchFieldBest to prefer longest match among similar-priority candidates
  const position = detectionKb.matchFieldBest("position", body);
  return position ? cleanup(position) : null;
}
```

на:

```js
// Должности, которые часто встречаются в подписях (fallback если KB не нашёл)
const POSITION_SIGNATURE_PATTERN = /(?:^|\n)\s*((?:начальник|заместитель\s+начальника?|главный\s+(?:инженер|технолог|бухгалтер|специалист|механик)|зав\.\s*(?:отделом|кафедрой|лабораторией|складом)|заведующ(?:ий|ая)\s+\S+|руководитель\s+(?:отдела|направления|группы|проекта|службы)|ведущий\s+(?:инженер|специалист|менеджер)|генеральный\s+директор|коммерческий\s+директор|технический\s+директор|финансовый\s+директор|исполнительный\s+директор|директор\s+по\s+\S+)\s*[^\n,]{0,50})/im;

function extractPosition(body) {
  // KB match: приоритет (обучаемые паттерны)
  const position = detectionKb.matchFieldBest("position", body);
  if (position) return cleanup(position);

  // Fallback: явный лейбл "Должность: X"
  const labelMatch = body.match(/(?:должность|position)\s*[:\-–]\s*([^\n,]{3,80})/i);
  if (labelMatch) return cleanup(labelMatch[1]);

  // Fallback: строка должности в подписи
  const signatureMatch = POSITION_SIGNATURE_PATTERN.exec(body);
  if (signatureMatch) return cleanup(signatureMatch[1]);

  return null;
}
```

- [ ] **Шаг 4: Запустить тест — убедиться что проходит**

```bash
node tests/email-analyzer.test.js 2>&1 | grep -E "PASS|FAIL|начальник СФКЗЦ"
```

Ожидаем: `PASS Должность: начальник СФКЗЦ извлекается из подписи`

- [ ] **Шаг 5: Прогнать все тесты**

```bash
npm test 2>&1 | tail -20
```

- [ ] **Шаг 6: Коммит**

```bash
git add src/services/email-analyzer.js tests/email-analyzer.test.js
git commit -m "fix: extract position from signature block as fallback (начальник, главный инженер, etc.)"
```

---

## Итоговая проверка

После всех 5 тасков:

- [ ] **Прогнать полный suite**

```bash
npm test
```

Ожидаем: 0 новых падений, 5+ новых PASS тестов.

- [ ] **Проверить на реальных письмах** (опционально)

Если есть доступ к продакшн-данным, прогнать `data/prod-messages-p4-fresh.json` через анализатор и убедиться что:
- письмо от artur@oilgis.ru → ФИО: "Алик Шарифгалиев М."
- письмо от sfkzc@ntiim.ru → ФИО: "Бастрыкова Мария", Должность: "начальник СФКЗЦ"
- письмо от gurevaa18@mail.ru → ФИО: "Алиса Гурьева"
- ни одно из писем не имеет "2BM-0278106553-..." в артикулах
