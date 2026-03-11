export const EMAIL_STATUSES = {
  new: { label: 'Новое', color: 'bg-accent-blue/10 text-accent-blue' },
  processing: { label: 'Обработка', color: 'bg-accent-violet/10 text-accent-violet' },
  classified: { label: 'Классифицировано', color: 'bg-accent-emerald/10 text-accent-emerald' },
  review: { label: 'На проверке', color: 'bg-accent-amber/10 text-accent-amber' },
  confirmed: { label: 'Подтверждено', color: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Отклонено', color: 'bg-accent-rose/10 text-accent-rose' },
  error: { label: 'Ошибка', color: 'bg-red-100 text-red-700' },
  spam: { label: 'Спам', color: 'bg-steel-100 text-steel-500' },
} as const;

export const CLASSIFICATIONS = {
  client_request: { label: 'Запрос клиента', color: 'bg-blue-100 text-blue-700', icon: '📋' },
  price_request: { label: 'Запрос цены', color: 'bg-emerald-100 text-emerald-700', icon: '💰' },
  complaint: { label: 'Рекламация', color: 'bg-rose-100 text-rose-700', icon: '⚠' },
  technical: { label: 'Техническое', color: 'bg-violet-100 text-violet-700', icon: '🔧' },
  logistics: { label: 'Логистика', color: 'bg-amber-100 text-amber-700', icon: '🚛' },
  payment: { label: 'Оплата', color: 'bg-cyan-100 text-cyan-700', icon: '💳' },
  spam: { label: 'Спам', color: 'bg-steel-100 text-steel-500', icon: '🗑' },
  internal: { label: 'Внутреннее', color: 'bg-steel-100 text-steel-600', icon: '🏢' },
  unknown: { label: 'Не определено', color: 'bg-steel-100 text-steel-400', icon: '❓' },
} as const;

export type EmailStatus = keyof typeof EMAIL_STATUSES;
export type Classification = keyof typeof CLASSIFICATIONS;

export const CONFIDENCE_THRESHOLDS = {
  autoPass: 0.95,
  highConfidence: 0.85,
  mediumConfidence: 0.7,
  lowConfidence: 0.5,
} as const;

export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Дашборд', href: '/', icon: 'LayoutDashboard' },
  { key: 'inbox', label: 'Входящие', href: '/inbox', icon: 'Inbox' },
  { key: 'analytics', label: 'Аналитика', href: '/analytics', icon: 'BarChart3' },
  { key: 'templates', label: 'Шаблоны', href: '/templates', icon: 'FileCode' },
  { key: 'settings', label: 'Настройки', href: '/settings', icon: 'Settings' },
] as const;

export const EXTRACTED_FIELDS = [
  { key: 'company_name', label: 'Компания' },
  { key: 'inn', label: 'ИНН' },
  { key: 'contact_name', label: 'Контактное лицо' },
  { key: 'phone', label: 'Телефон' },
  { key: 'email', label: 'Email' },
  { key: 'product', label: 'Товар/Продукт' },
  { key: 'brand', label: 'Бренд' },
  { key: 'quantity', label: 'Количество' },
  { key: 'delivery_address', label: 'Адрес доставки' },
  { key: 'deadline', label: 'Срок' },
] as const;

export const BRANDS = [
  'Grundfos', 'Danfoss', 'Wilo', 'KSB', 'Ebara',
  'Siemens', 'ABB', 'Schneider Electric', 'Honeywell',
  'Bosch Rexroth', 'Parker', 'Festo', 'SMC',
] as const;

export const KEYBOARD_SHORTCUTS = [
  { key: 'j/k', description: 'Следующее/предыдущее письмо' },
  { key: 'Enter', description: 'Открыть письмо' },
  { key: 'x', description: 'Выделить письмо' },
  { key: 'e', description: 'Подтвердить' },
  { key: 'r', description: 'На проверку' },
  { key: '#', description: 'Спам' },
  { key: '/', description: 'Поиск' },
  { key: 'Esc', description: 'Назад' },
] as const;
