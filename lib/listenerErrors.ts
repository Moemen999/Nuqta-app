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
  shakhbata_income: 'دخل الشهر في توزيع الدخل',
  shakhbata_settings: 'نسب توزيع الدخل',
  debts: 'الديون',
  subscriptions: 'الاشتراكات',
  gamiyas: 'الجمعيات',
  incomes: 'الدخل الثابت',
} as const;

export type ListenerName = keyof typeof LISTENER_LABELS;

/**
 * snapshot وصل لـlistener (مراجعة التطبيق كله، الميزة 7 — الجولة الأخيرة، H1-B): لو كان واقع، بيتشال من `loadErrors` بس
 * لما الـsnapshot من السيرفر. «جرّب تاني» من غير نت بيفتح الـlistener من الكاش (فاضي أو قديم) — ده مش رجوع، و«بياناتك
 * وصلت» كانت بتتقال كدب. نفس المصفوفة لو مفيش تغيير (مفيش render زيادة مع كل snapshot عادي).
 * **حد معروف:** listener من غير `includeMetadataChanges` اتفتح من غير نت ومحتواه على السيرفر زي الكاش (مجموعة فاضية
 * مثلًا) مبيرميش snapshot تاني لما النت يرجع — فالبانر بيفضل لحد «جرّب تاني» والنت شغال. إنذار زيادة، مش بلع.
 */
export function loadErrorsAfterSnapshot(prev: ListenerName[], name: ListenerName, fromCache: boolean): ListenerName[] {
  if (!prev.includes(name) || fromCache) return prev;
  return prev.filter(n => n !== name);
}

export const LOAD_ERROR_TITLE = 'مقدرناش نجيب بياناتك';
export const LOAD_ERROR_RETRY = 'جرّب تاني';

/** "المحافظ" / "المحافظ والديون" / "المحافظ والعمليات والديون" — بترتيب ثابت، من غير فاصلة قبل الواو (arabic-copy-reviewer) */
export function listenerNamesPhrase(names: ListenerName[]): string {
  const order = Object.keys(LISTENER_LABELS) as ListenerName[];
  const labels = order.filter(n => names.includes(n)).map(n => LISTENER_LABELS[n]);
  return labels.join(' و');
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

/**
 * قبل ما شاشة الدفع/الاستلام تحكم إن المحفظة "اتمسحت أو اتأرشفت": `wallets` فاضية لحد ما الـlistener يوصّل
 * (وبتفضل قديمة لو وقع)، فمحفظة سليمة كانت هتتقال عليها مفقودة. `null` = المحافظ معروفة، كمّل الفحص.
 * العنوان والـlistener-error من نفس نصوص المسح (`WALLET_BLOCKED_TITLE`, `loadErrorBody`).
 */
export function walletsNotReadyNotice(loadErrors: ListenerName[], figuresPending: ListenerName[]): { title: string; body: string } | null {
  if (loadErrors.includes('wallets')) return { title: WALLET_BLOCKED_TITLE, body: `${loadErrorBody(['wallets'])} مفيش حاجة اتسجلت.` };
  if (figuresPending.includes('wallets')) {
    return { title: WALLET_BLOCKED_TITLE, body: `بيانات ${LISTENER_LABELS.wallets} لسه بتوصل، فمش قادرين نتأكد من المحفظة. مفيش حاجة اتسجلت — استنى ثواني وجرب تاني.` };
  }
  return null;
}
export function walletBlockedBody(missing: ListenerName[]): string {
  return `بيانات ${listenerNamesPhrase(missing)} ما وصلتش، فمش هنقدر نتأكد من رصيد المحفظة ولا إيه اللي مربوط بيها. دوس "${LOAD_ERROR_RETRY}" فوق، وهتقدر تكمل بعد ما البيانات توصل.`;
}

/**
 * H1 (الميزة 10، الجولة الأخيرة): الفحص كان على `loadErrors` بس — بس قبل ما المجموعة توصل أصلاً القايمة فاضية **ومش
 * مرفوضة**، فـ"مفيش تاريخ" و"الرصيد صفر" كانوا بيتحسبوا على قايمة لسه ما وصلتش. نفس فكرة `loading` في
 * `cascadeDeleteBlock`: `figuresPending` (المحافظ/العمليات لسه ما جاش منها snapshot من السيرفر) + `undelivered` (أي
 * listener لسه مرماش أول snapshot — `DataContext`). الشباك ضيّق (أول ثواني بعد الفتح)، بس لو اتداس فيه كان ممكن تتمسح
 * محفظة عليها عمليات نهائي.
 */
export function walletActionLoading(figuresPending: readonly ListenerName[], undelivered: readonly ListenerName[]): ListenerName[] {
  const fromFigures: ListenerName[] = figuresPending.filter(n => n === 'wallets' || n === 'transactions');
  const rest = undelivered.filter(n => WALLET_BALANCE_SOURCES.includes(n) && !fromFigures.includes(n));
  return [...fromFigures, ...rest];
}

export function categoryActionLoading(figuresPending: readonly ListenerName[], undelivered: readonly ListenerName[]): ListenerName[] {
  const fromFigures: ListenerName[] = figuresPending.filter(n => n === 'transactions');
  const rest = undelivered.filter(n => CATEGORY_USAGE_SOURCES.includes(n) && !fromFigures.includes(n));
  return [...fromFigures, ...rest];
}

/** المسح/الأرشفة اتداسوا والبيانات لسه بتوصل — العنوان نفسه بتاع `WALLET_BLOCKED_TITLE` */
export const DATA_LOADING_BODY = 'بياناتك لسه بتوصل — استنى شوية وجرّب تاني.';
