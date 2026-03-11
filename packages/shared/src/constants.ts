/** Email processing pipeline states */
export const EMAIL_STATUS = {
  RECEIVED: 'received',
  NORMALIZED: 'normalized',
  PARSED: 'parsed',
  CLASSIFIED: 'classified',
  ENTITIES_EXTRACTED: 'entities_extracted',
  CRM_MATCHED: 'crm_matched',
  AWAITING_REVIEW: 'awaiting_review',
  AWAITING_CLIENT_DETAILS: 'awaiting_client_details',
  READY_TO_SYNC: 'ready_to_sync',
  SYNCED: 'synced',
  FAILED: 'failed',
  QUARANTINED: 'quarantined',
} as const;

export const EMAIL_STATUS_LABELS: Record<string, string> = {
  received: 'Получено',
  normalized: 'Нормализовано',
  parsed: 'Разобрано',
  classified: 'Классифицировано',
  entities_extracted: 'Сущности извлечены',
  crm_matched: 'CRM совпадение',
  awaiting_review: 'На проверке',
  awaiting_client_details: 'Ожидание реквизитов',
  ready_to_sync: 'Готово к синхронизации',
  synced: 'Синхронизировано',
  failed: 'Ошибка',
  quarantined: 'Карантин',
};

/** Classification labels */
export const CLASSIFICATION = {
  NEW_CLIENT_REQUEST: 'new_client_request',
  EXISTING_CLIENT: 'existing_client',
  SPAM: 'spam',
  VENDOR_OFFER: 'vendor_offer',
  SYSTEM_NOTIFICATION: 'system_notification',
  CLARIFICATION_REPLY: 'clarification_reply',
  ATTACHMENT_ONLY: 'attachment_only',
  MULTI_BRAND_REQUEST: 'multi_brand_request',
  MONO_BRAND_REQUEST: 'mono_brand_request',
  UNCLASSIFIED: 'unclassified',
} as const;

export const CLASSIFICATION_LABELS: Record<string, string> = {
  new_client_request: 'Новый клиентский запрос',
  existing_client: 'Существующий клиент',
  spam: 'Спам',
  vendor_offer: 'Поставщик / КП',
  system_notification: 'Системное уведомление',
  clarification_reply: 'Ответ на уточнение',
  attachment_only: 'Только вложения',
  multi_brand_request: 'Мультибрендовая заявка',
  mono_brand_request: 'Монобрендовая заявка',
  unclassified: 'Не классифицировано',
};

/** Processing modes */
export const PROCESSING_MODE = {
  AUTOMATIC: 'automatic',
  SEMI_AUTOMATIC: 'semi_automatic',
  MANUAL: 'manual',
} as const;

/** User roles */
export const USER_ROLE = {
  ADMIN: 'admin',
  OPERATOR: 'operator',
  MOP: 'mop',
  SALES_HEAD: 'sales_head',
  ANALYST: 'analyst',
  INTEGRATOR: 'integrator',
} as const;

/** Queue names */
export const QUEUES = {
  EMAIL_FETCH: 'email:fetch',
  EMAIL_PARSE: 'email:parse',
  EMAIL_CLASSIFY: 'email:classify',
  EMAIL_EXTRACT: 'email:extract',
  EMAIL_CRM_MATCH: 'email:crm-match',
  EMAIL_SYNC: 'email:sync',
  ATTACHMENT_PROCESS: 'attachment:process',
} as const;

/** Confidence thresholds */
export const CONFIDENCE = {
  AUTO_APPROVE: 0.85,
  REVIEW_REQUIRED: 0.60,
  LOW: 0.40,
} as const;

/** Attachment categories */
export const ATTACHMENT_CATEGORY = {
  REQUISITES: 'requisites',
  COMPANY_CARD: 'company_card',
  NAMEPLATE_PHOTO: 'nameplate_photo',
  ARTICLE_PHOTO: 'article_photo',
  PRICE_LIST: 'price_list',
  SPECIFICATION: 'specification',
  COMMERCIAL_OFFER: 'commercial_offer',
  OTHER: 'other',
} as const;

/** CRM match methods */
export const MATCH_METHOD = {
  INN: 'inn',
  COMPANY_NAME: 'company_name',
  CONTACT_EMAIL: 'contact_email',
  DOMAIN: 'domain',
  MANUAL: 'manual',
} as const;

/** Extracted field names */
export const EXTRACTED_FIELDS = [
  'sender_email',
  'sender_name',
  'sender_position',
  'company_name',
  'website',
  'domain',
  'inn',
  'kpp',
  'ogrn',
  'city_phone',
  'mobile_phone',
  'brand',
  'article',
  'description_ru',
  'quantity',
  'unit',
  'request_type',
] as const;

export const EXTRACTED_FIELD_LABELS: Record<string, string> = {
  sender_email: 'Email отправителя',
  sender_name: 'ФИО',
  sender_position: 'Должность',
  company_name: 'Компания',
  website: 'Сайт',
  domain: 'Домен',
  inn: 'ИНН',
  kpp: 'КПП',
  ogrn: 'ОГРН',
  city_phone: 'Городской телефон',
  mobile_phone: 'Мобильный телефон',
  brand: 'Бренд',
  article: 'Артикул',
  description_ru: 'Описание',
  quantity: 'Количество',
  unit: 'Единица измерения',
  request_type: 'Тип запроса',
};

/** Free email domains — not corporate */
export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru',
  'yandex.ru', 'ya.ru', 'hotmail.com', 'outlook.com',
  'rambler.ru', 'icloud.com', 'yahoo.com',
]);
