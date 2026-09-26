/**
 * لما listener من بتوع `DataContext` يترفض (أغلب الوقت `permission-denied`)،
 * فايربيز بتقفله نهائي — مبيرجعش لوحده. قبل 2026-09-26 مكانش فيه ولا
 * listener عنده error callback، فالقايمة كانت بتفضل فاضية والمستخدم يفتكر
 * إن مفيش حاجة — ده اتكشف لما مجموعة `incomes` كانت مرفوضة في الإنتاج
 * (القواعد المنشورة كانت قديمة).
 *
 * الملف ده الكلام بس، من غير فايربيز، عشان يتختبر لوحده.
 */

/** اسم كل مجموعة بيقراها `DataContext` زي ما المستخدم يعرفه */
export const LISTENER_LABELS = {
  wallets: 'المحافظ',
  categories: 'الفئات',
  transactions: 'العمليات',
  budgets: 'الميزانية',
  shakhbata_income: 'دخل الشخبطة',
  shakhbata_settings: 'نسب الشخبطة',
  debts: 'الديون',
  subscriptions: 'الاشتراكات',
  gamiyas: 'الجمعيات',
  incomes: 'الدخل الثابت',
} as const;

export type ListenerName = keyof typeof LISTENER_LABELS;

export const LOAD_ERROR_TITLE = 'مقدرناش نجيب بياناتك';
export const LOAD_ERROR_RETRY = 'جرّب تاني';

/** "المحافظ" / "المحافظ والديون" / "المحافظ، العمليات، والديون" — بترتيب ثابت */
export function listenerNamesPhrase(names: ListenerName[]): string {
  const order = Object.keys(LISTENER_LABELS) as ListenerName[];
  const labels = order.filter(n => names.includes(n)).map(n => LISTENER_LABELS[n]);
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} و${labels[1]}`;
  return `${labels.slice(0, -1).join('، ')}، و${labels[labels.length - 1]}`;
}

/**
 * "بيانات" قبل الأسامي عشان الفعل يفضل مؤنث مهما كان الاسم — "الدخل الثابت"
 * مذكر مفرد، فـ"الدخل الثابت ما وصلتش" كانت غلط (arabic-copy-reviewer).
 *
 * الجسم بيقول تلات حاجات: **إيه** اللي ما وصلش، إن الفاضي هنا مش حقيقي
 * (وده أهم حاجة — القايمة الفاضية بتتقري "فلوسي راحت")، و**تعمل إيه**.
 */
export function loadErrorBody(names: ListenerName[]): string {
  return `بيانات ${listenerNamesPhrase(names)} ما وصلتش من السيرفر، فممكن تبان فاضية وهي مش فاضية — بياناتك مش ضايعة. دوس "${LOAD_ERROR_RETRY}"، ولو فضلت كده ابعتلنا من "شاركنا رأيك" في الإعدادات.`;
}

/**
 * المجموعات اللي رصيد المحفظة واللي مربوط بيها بيتحسبوا منها. لو واحدة منهم
 * ما وصلتش، مسح أو أرشفة المحفظة ممنوعين: "مفيش تاريخ" أو "الرصيد صفر" هيبقوا
 * محسوبين على قايمة ناقصة، فممكن تتمسح محفظة عليها عمليات أو تتأرشف ورصيدها
 * مش صفر (money-reviewer).
 */
export const WALLET_BALANCE_SOURCES: ListenerName[] = ['wallets', 'transactions', 'debts', 'subscriptions', 'gamiyas', 'incomes'];

export function walletActionBlockedBy(loadErrors: ListenerName[]): ListenerName[] {
  return loadErrors.filter(n => WALLET_BALANCE_SOURCES.includes(n));
}

/**
 * نفس الفكرة للفئة: "مفيش تاريخ" و"مربوطة بإيه" بيتحسبوا من العمليات
 * والاشتراكات والديون والميزانية (`categoryReferences`). لو ناقصين، ممكن تتمسح
 * فئة عليها عمليات فتفضل عملياتها بفئة ممسوحة (silent-failure-hunter).
 */
export const CATEGORY_USAGE_SOURCES: ListenerName[] = ['categories', 'transactions', 'subscriptions', 'debts', 'budgets'];

export function categoryActionBlockedBy(loadErrors: ListenerName[]): ListenerName[] {
  return loadErrors.filter(n => CATEGORY_USAGE_SOURCES.includes(n));
}

export function categoryBlockedBody(missing: ListenerName[]): string {
  return `بيانات ${listenerNamesPhrase(missing)} ما وصلتش، فمش هنقدر نتأكد إيه اللي مربوط بالفئة. دوس "${LOAD_ERROR_RETRY}" فوق، وهتقدر تكمل بعد ما البيانات توصل.`;
}

export const WALLET_BLOCKED_TITLE = 'استنى البيانات توصل';
export function walletBlockedBody(missing: ListenerName[]): string {
  return `بيانات ${listenerNamesPhrase(missing)} ما وصلتش، فمش هنقدر نتأكد من رصيد المحفظة ولا إيه اللي مربوط بيها. دوس "${LOAD_ERROR_RETRY}" فوق، وهتقدر تكمل بعد ما البيانات توصل.`;
}
