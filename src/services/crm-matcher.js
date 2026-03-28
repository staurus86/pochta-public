function normalizeDomain(email) {
  return String(email || "")
    .split("@")[1]
    ?.toLowerCase()
    .trim() || "";
}

function extractRootDomain(domain) {
  const parts = String(domain || "").split(".");
  if (parts.length <= 2) return domain;
  // Handle co.uk, com.ru etc.
  const tld = parts.slice(-2).join(".");
  if (["co.uk", "co.jp", "com.au", "com.br", "com.ru"].includes(tld)) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function inferWebsite(domain) {
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) {
    return null;
  }

  return `https://${domain}`;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[«»"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArticle(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[“”«»"]/g, "")
    .toUpperCase();
}

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "mail.ru", "bk.ru", "list.ru", "inbox.ru", "yandex.ru", "ya.ru",
  "hotmail.com", "outlook.com", "icloud.com", "me.com", "live.com", "yahoo.com",
  "rambler.ru", "ro.ru", "autorambler.ru", "myrambler.ru", "lenta.ru",
  "aol.com", "protonmail.com", "proton.me", "zoho.com"
]);

export function matchCompanyInCrm(project, analysis) {
  const companyCandidates = project.knownCompanies || [];
  const senderDomain = normalizeDomain(analysis.sender.email);
  const normalizedCompany = normalizeText(analysis.sender.companyName);
  const senderName = normalizeText(analysis.sender.fullName);
  const senderEmail = String(analysis.sender.email || "").toLowerCase();
  const senderInn = analysis.sender.inn;
  const detectedBrands = unique((analysis.detectedBrands || []).map(normalizeText).filter(Boolean));
  const detectedArticles = collectDetectedArticles(analysis);

  const exactMatch =
    companyCandidates.find((company) => senderInn && company.inn && company.inn === senderInn) ||
    companyCandidates.find((company) => senderDomain && company.domain && normalizeText(company.domain) === senderDomain) ||
    companyCandidates.find((company) => {
      if (!senderDomain || !company.website) return false;
      try {
        const wsHost = new URL(company.website).hostname.replace(/^www\./, "");
        // Exact domain match or root domain match (subdomain.example.com → example.com)
        return wsHost === senderDomain || extractRootDomain(wsHost) === extractRootDomain(senderDomain);
      } catch {
        return false;
      }
    }) ||
    companyCandidates.find((company) => normalizedCompany && normalizedCompany.length > 3 && normalizeText(company.legalName).includes(normalizedCompany)) ||
    companyCandidates.find((company) => {
      const crmName = normalizeText(company.legalName).replace(/^(ооо|ао|зао|пао|ип)\s+/i, "").trim();
      return crmName.length > 3 && normalizedCompany.includes(crmName);
    }) ||
    companyCandidates.find((company) =>
      (company.contacts || []).some((contact) => {
        const sameEmail = senderEmail && normalizeText(contact.email) === senderEmail;
        const sameName = senderName.length > 4 && normalizeText(contact.fullName) === senderName;
        return sameEmail || sameName;
      })
    );

  if (exactMatch) {
    const managers = resolveManagerOwners(project, { brands: analysis.detectedBrands, articles: detectedArticles });
    return buildMatchedResult(project, exactMatch, {
      method: "exact",
      score: 100,
      managers
    });
  }

  const historyMatch = scoreCompanyByNomenclature(companyCandidates, {
    senderDomain,
    detectedBrands,
    detectedArticles
  });

  if (historyMatch) {
    const managers = resolveManagerOwners(project, { brands: analysis.detectedBrands, articles: detectedArticles });
    const isWeakMatch = historyMatch.score < 50;
    const actions = isWeakMatch
      ? [
          "Совпадение по номенклатуре слабое — проверьте соответствие артикулов вручную",
          "Подтвердите привязку к клиенту перед синхронизацией в CRM",
          `Основание: ${historyMatch.reasons.join(", ")}`
        ]
      : [
          "Привязать письмо к клиенту по совпадению номенклатуры",
          "Создать запрос и назначить профильных менеджеров",
          `Основание: ${historyMatch.reasons.join(", ")}`
        ];
    if (historyMatch.multiCompanySignal) {
      actions.push("Внимание: несколько компаний совпадают по брендам — возможен трейдер");
    }
    return buildMatchedResult(project, historyMatch.company, {
      method: historyMatch.method,
      score: historyMatch.score,
      managers,
      actions
    });
  }

  const managers = resolveManagerOwners(project, { brands: analysis.detectedBrands, articles: detectedArticles });
  const inferredWebsite = analysis.sender.website || inferWebsite(senderDomain);
  const missingLegalData = !analysis.sender.inn && !analysis.sender.companyName;
  const actions = [
    "Проверить контактное лицо и домен на совпадение с CRM",
    inferredWebsite ? `Использовать сайт ${inferredWebsite} для поиска реквизитов` : "Сайт не найден автоматически",
    detectedArticles.length > 0 ? `Сверить запрос по артикулам: ${detectedArticles.slice(0, 5).join(", ")}` : "Сверить номенклатуру вручную не требуется",
    "Если ИНН не найден, запросить реквизиты ответным письмом",
    "После получения реквизитов создать карточку клиента и контактное лицо"
  ];

  return {
    company: null,
    isExistingCompany: false,
    curatorMop: managers.mop || project.managerPool?.defaultMop || "Не назначен",
    curatorMoz: managers.moz || project.managerPool?.defaultMoz || "Не назначен",
    needsClarification: missingLegalData,
    actions,
    suggestedReply: missingLegalData
      ? [
          "Добрый день.",
          "",
          "Для регистрации вашей заявки в CRM и назначения ответственного менеджера пришлите, пожалуйста, реквизиты организации.",
          "Нам нужен минимум: наименование юридического лица, ИНН и контактные данные ответственного лица.",
          "",
          "После получения данных мы сразу заведем карточку клиента и продолжим обработку заявки."
        ].join("\n")
      : null,
    inferredWebsite,
    matchMethod: "none",
    matchConfidence: 0
  };
}

function buildMatchedResult(project, company, options = {}) {
  const managers = options.managers || resolveManagerOwners(project, { brands: [], articles: [] });
  return {
    company,
    isExistingCompany: true,
    curatorMop: managers.mop || company.curatorMop || project.managerPool?.defaultMop || "Не назначен",
    curatorMoz: managers.moz || company.curatorMoz || project.managerPool?.defaultMoz || "Не назначен",
    needsClarification: false,
    actions: options.actions || [
      "Разложить письмо по полям CRM",
      "Привязать заявку к существующему юрлицу",
      "Создать запрос и назначить менеджеров"
    ],
    suggestedReply: null,
    matchMethod: options.method || "exact",
    matchConfidence: Number(((options.score || 100) / 100).toFixed(2))
  };
}

function resolveManagerOwners(project, { brands = [], articles = [] } = {}) {
  const pool = project.managerPool || {};
  const articleOwners = pool.articleOwners || pool.nomenclatureOwners || [];
  const normalizedArticles = articles.map(normalizeArticle).filter(Boolean);
  for (const article of normalizedArticles) {
    const owner = articleOwners.find((item) => normalizeArticle(item.article) === article);
    if (owner) {
      return {
        mop: owner.mop || pool.defaultMop,
        moz: owner.moz || pool.defaultMoz,
        reason: `article:${article}`
      };
    }
  }

  const owners = pool.brandOwners || [];
  const normalizedBrands = (brands || []).map(normalizeText).filter(Boolean);
  for (const brand of normalizedBrands) {
    const owner = owners.find((item) => normalizeText(item.brand) === brand);
    if (owner) {
      return {
        mop: owner.mop || pool.defaultMop,
        moz: owner.moz || pool.defaultMoz,
        reason: `brand:${brand}`
      };
    }
  }

  return {
    mop: pool.defaultMop,
    moz: pool.defaultMoz,
    reason: "default"
  };
}

function collectDetectedArticles(analysis) {
  const leadArticles = analysis.lead?.articles || [];
  const nomenclatureArticles = (analysis.lead?.nomenclatureMatches || []).map((item) => item.article);
  return unique([...leadArticles, ...nomenclatureArticles].map(normalizeArticle).filter(Boolean));
}

function scoreCompanyByNomenclature(companies, { senderDomain, detectedBrands = [], detectedArticles = [] }) {
  if (companies.length === 0 || (detectedBrands.length === 0 && detectedArticles.length === 0 && !senderDomain)) {
    return null;
  }

  let best = null;
  for (const company of companies) {
    let score = 0;
    const reasons = [];
    const companyBrands = collectCompanyBrands(company);
    const companyArticles = collectCompanyArticles(company);

    for (const brand of detectedBrands) {
      if (companyBrands.has(brand)) {
        score += 18;
        reasons.push(`brand:${brand}`);
      }
    }

    for (const article of detectedArticles) {
      if (companyArticles.has(article)) {
        score += 32;
        reasons.push(`article:${article}`);
      }
    }

    if (senderDomain && company.domain && normalizeText(company.domain) === senderDomain) {
      score += 12;
      reasons.push(`domain:${senderDomain}`);
    }

    if (score > (best?.score || 0)) {
      best = { company, score, reasons };
    }
  }

  if (!best || best.score < 35) {
    return null;
  }

  // Multi-company signal: if >2 brands detected and they point to different companies,
  // lower confidence since this might be a trader, not a single-brand customer
  const matchedCompanyCount = companies.filter((c) => {
    const cb = collectCompanyBrands(c);
    return detectedBrands.some((b) => cb.has(b));
  }).length;
  const multiCompanySignal = matchedCompanyCount > 1 && detectedBrands.length >= 2;

  return {
    company: best.company,
    score: Math.min(best.score, 95),
    method: best.reasons.some((reason) => reason.startsWith("article:"))
      ? "nomenclature_history"
      : "brand_history",
    reasons: best.reasons,
    multiCompanySignal
  };
}

function collectCompanyBrands(company) {
  return new Set(
    [
      ...(company.brands || []),
      ...(company.brandHistory || []),
      ...(company.detectedBrands || [])
    ]
      .map(normalizeText)
      .filter(Boolean)
  );
}

function collectCompanyArticles(company) {
  return new Set(
    [
      ...(company.articles || []),
      ...(company.articleHistory || []),
      ...(company.nomenclatureHints || [])
    ]
      .map(normalizeArticle)
      .filter(Boolean)
  );
}

function unique(items) {
  return [...new Set(items)];
}
