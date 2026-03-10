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
  "gmail.com",
  "mail.ru",
  "bk.ru",
  "list.ru",
  "inbox.ru",
  "yandex.ru",
  "ya.ru",
  "hotmail.com",
  "outlook.com"
]);

export function matchCompanyInCrm(project, analysis) {
  const companyCandidates = project.knownCompanies || [];
  const senderDomain = normalizeDomain(analysis.sender.email);
  const normalizedCompany = String(analysis.sender.companyName || "").toLowerCase();
  const senderName = String(analysis.sender.fullName || "").toLowerCase();

  const match =
    companyCandidates.find((company) => company.inn && company.inn === analysis.sender.inn) ||
    companyCandidates.find((company) => company.domain && company.domain === senderDomain) ||
    companyCandidates.find((company) => normalizedCompany && company.legalName.toLowerCase().includes(normalizedCompany)) ||
    companyCandidates.find((company) =>
      (company.contacts || []).some((contact) => {
        const sameEmail = contact.email?.toLowerCase() === analysis.sender.email.toLowerCase();
        const sameName = contact.fullName?.toLowerCase() === senderName;
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
