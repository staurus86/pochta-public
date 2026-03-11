function normalizeDomain(email) {
  return String(email || "")
    .split("@")[1]
    ?.toLowerCase()
    .trim() || "";
}

function inferWebsite(domain) {
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) {
    return null;
  }

  return `https://${domain}`;
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
  const normalizedCompany = String(analysis.sender.companyName || "").toLowerCase();
  const senderName = String(analysis.sender.fullName || "").toLowerCase();

  const senderEmail = String(analysis.sender.email || "").toLowerCase();
  const senderInn = analysis.sender.inn;

  const match =
    // 1. Exact INN match (most reliable)
    companyCandidates.find((company) => senderInn && company.inn && company.inn === senderInn) ||
    // 2. Exact domain match
    companyCandidates.find((company) => senderDomain && company.domain && company.domain === senderDomain) ||
    // 3. Website domain match (extract domain from website URL)
    companyCandidates.find((company) => {
      if (!senderDomain || !company.website) return false;
      try {
        const wsHost = new URL(company.website).hostname.replace(/^www\./, "");
        return wsHost === senderDomain;
      } catch { return false; }
    }) ||
    // 4. Company name contains match
    companyCandidates.find((company) => normalizedCompany && normalizedCompany.length > 3 && company.legalName.toLowerCase().includes(normalizedCompany)) ||
    // 5. Reverse: CRM company name found in sender company name
    companyCandidates.find((company) => {
      const crmName = company.legalName.toLowerCase().replace(/[ооо|ао|зао|пао|ип]\s*/i, "").replace(/[«»"]/g, "").trim();
      return crmName.length > 3 && normalizedCompany.includes(crmName);
    }) ||
    // 6. Contact email or name match
    companyCandidates.find((company) =>
      (company.contacts || []).some((contact) => {
        const sameEmail = senderEmail && contact.email?.toLowerCase() === senderEmail;
        const sameName = senderName.length > 4 && contact.fullName?.toLowerCase() === senderName;
        return sameEmail || sameName;
      })
    );

  if (match) {
    const brandOwners = resolveBrandOwners(project, analysis.detectedBrands);
    return {
      company: match,
      isExistingCompany: true,
      curatorMop: brandOwners.mop || match.curatorMop || project.managerPool?.defaultMop || "Не назначен",
      curatorMoz: brandOwners.moz || match.curatorMoz || project.managerPool?.defaultMoz || "Не назначен",
      needsClarification: false,
      actions: [
        "Разложить письмо по полям CRM",
        "Привязать заявку к существующему юрлицу",
        "Создать запрос и назначить менеджеров"
      ],
      suggestedReply: null
    };
  }

  const brandOwners = resolveBrandOwners(project, analysis.detectedBrands);
  const inferredWebsite = analysis.sender.website || inferWebsite(senderDomain);
  const missingLegalData = !analysis.sender.inn && !analysis.sender.companyName;
  const actions = [
    "Проверить контактное лицо и домен на совпадение с CRM",
    inferredWebsite ? `Использовать сайт ${inferredWebsite} для поиска реквизитов` : "Сайт не найден автоматически",
    "Если ИНН не найден, запросить реквизиты ответным письмом",
    "После получения реквизитов создать карточку клиента и контактное лицо"
  ];

  return {
    company: null,
    isExistingCompany: false,
    curatorMop: brandOwners.mop || project.managerPool?.defaultMop || "Не назначен",
    curatorMoz: brandOwners.moz || project.managerPool?.defaultMoz || "Не назначен",
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
    inferredWebsite
  };
}

function resolveBrandOwners(project, brands) {
  const owners = project.managerPool?.brandOwners || [];
  const firstBrand = brands[0];
  if (!firstBrand) {
    return {
      mop: project.managerPool?.defaultMop,
      moz: project.managerPool?.defaultMoz
    };
  }

  const owner = owners.find((item) => item.brand.toLowerCase() === firstBrand.toLowerCase());
  return {
    mop: owner?.mop || project.managerPool?.defaultMop,
    moz: owner?.moz || project.managerPool?.defaultMoz
  };
}
