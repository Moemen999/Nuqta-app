import type { Debt, Gamiya, Subscription, Transaction } from '@/context/DataContext';
import type { RecurringIncome } from '@/lib/recurringIncome';
import { walletBalance } from '@/lib/finance';
import type { AmountFormatter } from '@/lib/money';
import { gamiyaInstallmentTxId, gamiyaMonthTxIds, gamiyaTxId } from '@/lib/autoCharge';
import { LOAD_ERROR_RETRY, listenerNamesPhrase, type ListenerName } from '@/lib/listenerErrors';

/**
 * أرشفة المحافظ والفئات.
 *
 * الخلفية: `deleteWallet` و`deleteCategory` كانوا `deleteDoc` واحدة من غير أي
 * فحص، فالمحفظة بتتمسح ومئة عملية بتفضل مربوطة بمعرّف مش موجود. المستخدم
 * بيشوف إجمالي رصيده نقص فجأة (الإجمالي بيجمع المحافظ الموجودة بس) ومفيش
 * سطر واحد بيقوله ليه.
 *
 * الحل مش منع الحذف — الحل التفرقة: اللي مالوش تاريخ يتمسح فعلاً، واللي ليه
 * تاريخ يتأرشف (يختفي من الاختيارات ويفضل في التاريخ). والمستخدم لسه يقدر
 * يمسح برضه، بس بعد ما يشوف بالأرقام إيه اللي هيحصل.
 *
 * كل الأعداد هنا بتتحسب من الداتا اللي محمّلة في `DataContext` أصلاً — مفيش
 * ولا قراية زيادة من فايرستور.
 */

/** فرق أصغر من كده بنعتبره صفر — نفس منطق MONEY_EPS في الحسابات */
const BALANCE_EPS = 0.005;

export type NamedRef = { id: string; name: string };

export type WalletRefs = {
  /** عمليات بتشاور على المحفظة دي (المصدر أو الوجهة في السحب) */
  transactions: number;
  /** ديون ليها أي أثر على المحفظة: المبلغ الأساسي، دفعة، أو زيادة */
  debts: number;
  /** اشتراكات شغالة — دي بتولّد عمليات جديدة، فلازم تتنقل قبل الأرشفة */
  activeSubscriptions: NamedRef[];
  /** جمعيات لسه فيها شهور ما اتسددتش — نفس الكلام */
  activeGamiyas: NamedRef[];
  /** اشتراكات/جمعيات خلصت — تاريخ بس، مش بتمنع حاجة */
  inactiveSubscriptions: number;
  inactiveGamiyas: number;
  /**
   * دخل ثابت مش متوقف خالص (شغال أو واقف مؤقتًا — المؤقت هيرجع يسجل) — زي
   * الاشتراك: بيولّد عمليات جديدة، فلازم يتنقل قبل الأرشفة
   */
  activeIncomes: NamedRef[];
  inactiveIncomes: number;
};

export type CategoryRefs = {
  transactions: number;
  activeSubscriptions: NamedRef[];
  inactiveSubscriptions: number;
  /** دفعات ديون اتسجلت على الفئة دي */
  debtPayments: number;
  hasBudget: boolean;
};

export function walletReferences(
  walletId: string,
  data: {
    /** العمليات البايظة كمان (بند B) — المحفظة اللي عليها عملية بايظة ليها تاريخ، فمتتمسحش نهائي */
    transactions: Pick<Transaction, 'walletId' | 'toWalletId'>[] | { walletId?: string; toWalletId?: string }[];
    debts: Debt[]; subscriptions: Subscription[]; gamiyas: Gamiya[];
    incomes?: RecurringIncome[];
  },
): WalletRefs {
  const transactions = (data.transactions as { walletId?: string; toWalletId?: string }[]).filter(
    t => t.walletId === walletId || t.toWalletId === walletId
  ).length;

  const debts = data.debts.filter(d =>
    d.initialWalletId === walletId
    || (d.payments || []).some(p => p.walletId === walletId)
    || (d.increases || []).some(e => e.walletId === walletId)
  ).length;

  const subs = data.subscriptions.filter(s => s.walletId === walletId);
  const gamiyas = data.gamiyas.filter(g => g.walletId === walletId);
  const incomes = (data.incomes || []).filter(i => i.walletId === walletId);

  // الاشتراك "شغّال" لو `active` مش false صراحةً — الاشتراكات القديمة مالهاش
  // الحقل ده، وافتراض إنها واقفة كان هيسيبها تولّد عمليات على محفظة مؤرشفة
  const isActiveSub = (s: Subscription) => s.active !== false;
  const isActiveGamiya = (g: Gamiya) => (g.months || []).some(m => m.status === 'pending');

  return {
    transactions,
    debts,
    activeSubscriptions: subs.filter(isActiveSub).map(s => ({ id: s.id, name: s.name })),
    activeGamiyas: gamiyas.filter(isActiveGamiya).map(g => ({ id: g.id, name: g.name })),
    inactiveSubscriptions: subs.filter(s => !isActiveSub(s)).length,
    inactiveGamiyas: gamiyas.filter(g => !isActiveGamiya(g)).length,
    activeIncomes: incomes.filter(i => i.status !== 'stopped').map(i => ({ id: i.id, name: i.name })),
    inactiveIncomes: incomes.filter(i => i.status === 'stopped').length,
  };
}

export function categoryReferences(
  categoryId: string,
  data: {
    /** العمليات البايظة كمان (بند B) */
    transactions: { categoryId?: string }[];
    subscriptions: Subscription[];
    debts: Debt[];
    budgets: Record<string, number>;
  },
): CategoryRefs {
  const subs = data.subscriptions.filter(s => s.categoryId === categoryId);
  const isActiveSub = (s: Subscription) => s.active !== false;

  return {
    transactions: data.transactions.filter(t => t.categoryId === categoryId).length,
    activeSubscriptions: subs.filter(isActiveSub).map(s => ({ id: s.id, name: s.name })),
    inactiveSubscriptions: subs.filter(s => !isActiveSub(s)).length,
    debtPayments: data.debts.reduce(
      (n, d) => n + (d.payments || []).filter(p => p.categoryId === categoryId).length,
      0
    ),
    hasBudget: data.budgets[categoryId] != null,
  };
}

/** فيه أي أثر خالص؟ لو لأ، الحذف الحقيقي آمن ومفيش سبب نأرشف */
export function walletHasHistory(refs: WalletRefs) {
  return refs.transactions > 0 || refs.debts > 0
    || refs.activeSubscriptions.length > 0 || refs.activeGamiyas.length > 0
    || refs.inactiveSubscriptions > 0 || refs.inactiveGamiyas > 0
    || refs.activeIncomes.length > 0 || refs.inactiveIncomes > 0;
}

export function categoryHasHistory(refs: CategoryRefs) {
  return refs.transactions > 0 || refs.activeSubscriptions.length > 0
    || refs.inactiveSubscriptions > 0 || refs.debtPayments > 0;
}

export type ArchiveBlock =
  /** آخر محفظة شغالة — لو أرشفناها المستخدم مش هيقدر يسجّل ولا عملية */
  | { kind: 'last-active' }
  /** الرصيد لازم يبقى صفر: الأرشفة مش بتحرّك فلوس، والفلوس اللي جواها هتختفي من الإجمالي */
  | { kind: 'balance'; balance: number }
  /** مفيش مكان تنقل له الاشتراكات/الجمعيات الشغالة */
  | { kind: 'no-target' }
  /**
   * المكان اللي اتختار للنقل اتأرشف أو اتمسح والشيت مفتوح (الميزة 10، بند 3) — الاختيارات كانت بتتجمّد وقت فتح الشيت،
   * فالاشتراك كان بيتنقل لمحفظة/فئة مؤرشفة ويفضل يترفض كل شهر
   */
  | { kind: 'target-gone' };

/**
 * هل نقدر نأرشف المحفظة دي؟ `null` يعني ماشي.
 *
 * الرصيد **بيتقرّب لخانتين عشريتين** قبل المقارنة: جمع كسور في جافاسكريبت
 * ممكن يسيب 0.000000001 فنقول للمستخدم "رصيدك مش صفر" وهو شايفه صفر.
 */
export function walletArchiveBlock(opts: {
  walletId: string;
  balance: number;
  refs: WalletRefs;
  activeWalletCount: number;
  otherActiveWalletCount: number;
}): ArchiveBlock | null {
  if (opts.activeWalletCount <= 1) return { kind: 'last-active' };
  if (Math.abs(opts.balance) >= BALANCE_EPS) return { kind: 'balance', balance: opts.balance };
  const needsTarget = opts.refs.activeSubscriptions.length > 0 || opts.refs.activeGamiyas.length > 0
    || opts.refs.activeIncomes.length > 0;
  if (needsTarget && opts.otherActiveWalletCount === 0) return { kind: 'no-target' };
  return null;
}

/**
 * المسح النهائي لآخر محفظة شغالة ممنوع **دايمًا** — نفس قاعدة الأرشفة
 * (`last-active`)، سواء فيه مؤرشفة ولا لأ. من غيره المستخدم كان بيمسحها
 * ويفضل من غير ولا محفظة يسجّل عليها، والمؤرشفة من غير مكان لتسويتها.
 * المؤرشفة نفسها بتتمسح عادي: مسحها مبيغيّرش عدد الشغالة.
 */
export function walletDeleteBlock(
  walletId: string,
  wallets: { id: string; archived?: boolean }[],
): ArchiveBlock | null {
  const w = wallets.find(x => x.id === walletId);
  if (!w || w.archived) return null;
  return wallets.filter(x => !x.archived).length <= 1 ? { kind: 'last-active' } : null;
}

export function categoryArchiveBlock(opts: {
  refs: CategoryRefs;
  activeCategoryCount: number;
  otherActiveCategoryCount: number;
}): ArchiveBlock | null {
  if (opts.activeCategoryCount <= 1) return { kind: 'last-active' };
  if (opts.refs.activeSubscriptions.length > 0 && opts.otherActiveCategoryCount === 0) {
    return { kind: 'no-target' };
  }
  return null;
}

/**
 * آخر فئة شغالة مبتتمسحش (الميزة 10، بند 2) — نفس `walletDeleteBlock`. من غيرها المستخدم كان يمسحها ومودال العملية
 * يفضل من غير ولا فئة يصنّف بيها. المؤرشفة بتتمسح عادي.
 */
export function categoryDeleteBlock(
  categoryId: string,
  categories: { id: string; archived?: boolean }[],
): ArchiveBlock | null {
  const c = categories.find(x => x.id === categoryId);
  if (!c || c.archived) return null;
  return categories.filter(x => !x.archived).length <= 1 ? { kind: 'last-active' } : null;
}

/**
 * الأماكن اللي الشيت اختارها للنقل لسه شغالة؟ (بند 3) — بتتفحص في الشاشة لحظة التأكيد وفي `DataContext` لحظة الكتابة.
 * `null` = كلها شغالة.
 */
export function reassignTargetsBlock(
  targetIds: string[],
  items: { id: string; archived?: boolean }[],
  archivingId: string,
): ArchiveBlock | null {
  const ok = targetIds.every(t => t !== archivingId && items.some(i => i.id === t && !i.archived));
  return ok ? null : { kind: 'target-gone' };
}

/** رصيد المحفظة مقرّب لخانتين — نفس الرقم اللي المستخدم شايفه */
export function roundedWalletBalance(transactions: Transaction[], walletId: string, opening: number) {
  return Math.round(walletBalance(transactions, walletId, opening) * 100) / 100;
}

/* ─────────────────────────  النصوص  ───────────────────────── */

/**
 * "مربوط بيها 12 عملية و3 ديون" — الأجزاء الصفر بتتشال خالص بدل ما نقول
 * "و0 دين"، والصيغة بتتغيّر مع العدد عشان الجملة تطلع عربي طبيعي.
 */
function countPhrase(n: number, zero: string, one: string, two: string, many: string, plural: string) {
  // الصفر كان بيطلع "0 محافظ" — ده رقم مرمي في جملة، مش عربي. وبيبان فعلاً
  // في صف الإعدادات أول ما تفتح التطبيق من غير نت قبل ما البيانات توصل.
  if (n <= 0) return zero;
  if (n === 1) return one;
  if (n === 2) return two;
  if (n <= 10) return `${n} ${many}`;
  return `${n} ${plural}`;
}

/** "شهر واحد" / "شهرين" / "3 شهور" / "13 شهر" — عدد شهور الجمعية */
export function monthsPhrase(n: number) {
  return countPhrase(n, 'مفيش شهور', 'شهر واحد', 'شهرين', 'شهور', 'شهر');
}

/** "فترة واحدة" / "فترتين" / "3 فترات" / "11 فترة" — فترات الدخل الثابت الأسبوعي */
export function periodsPhrase(n: number) {
  return countPhrase(n, 'مفيش فترات', 'فترة واحدة', 'فترتين', 'فترات', 'فترة');
}

/** "قسط واحد" / "قسطين" / "3 أقساط" / "13 قسط" — سؤال الباقي بعد الزيادة (D1، 2026-10-30) */
export function installmentsPhrase(n: number) {
  return countPhrase(n, 'مفيش أقساط', 'قسط واحد', 'قسطين', 'أقساط', 'قسط');
}

export function resultsPhrase(n: number) {
  return countPhrase(n, 'مفيش نتايج', 'نتيجة واحدة', 'نتيجتين', 'نتايج', 'نتيجة');
}

export function contactsPhrase(n: number) {
  return countPhrase(n, 'مفيش جهات اتصال', 'جهة اتصال واحدة', 'جهتين اتصال', 'جهات اتصال', 'جهة اتصال');
}

/**
 * «فيه N تعديل لسه بيترفع» بالاتفاق مع العدد (arabic-copy-reviewer، الميزة 11): 1 / 2 / 3–10 جمع / 11+ مفرد. كانت في
 * `settings.tsx` لوحدها و«11 تعديلات» غلط؛ دلوقتي الإعدادات و«نسيت الكود؟» من هنا
 */
export function pendingWritesSentence(n: number) {
  if (n === 1) return 'فيه تعديل واحد لسه بيترفع';
  if (n === 2) return 'فيه تعديلين لسه بيترفعوا';
  if (n >= 3 && n <= 10) return `فيه ${n} تعديلات لسه بتترفع`;
  return `فيه ${n} تعديل لسه بيترفع`;
}

export function transactionsPhrase(n: number) {
  return countPhrase(n, 'مفيش عمليات', 'عملية واحدة', 'عمليتين', 'عمليات', 'عملية');
}

export function debtsPhrase(n: number) {
  return countPhrase(n, 'مفيش ديون', 'دين واحد', 'دينين', 'ديون', 'دين');
}

export function subscriptionsPhrase(n: number) {
  return countPhrase(n, 'مفيش اشتراكات', 'اشتراك واحد', 'اشتراكين', 'اشتراكات', 'اشتراك');
}

export function gamiyasPhrase(n: number) {
  return countPhrase(n, 'مفيش جمعيات', 'جمعية واحدة', 'جمعيتين', 'جمعيات', 'جمعية');
}

/** "دخل ثابت واحد" / "دخلين ثابتين" / "3 دخول ثابتة" / "11 دخل ثابت" */
export function incomesPhrase(n: number) {
  return countPhrase(n, 'مفيش دخل ثابت', 'دخل ثابت واحد', 'دخلين ثابتين', 'دخول ثابتة', 'دخل ثابت');
}

export function walletsPhrase(n: number) {
  return countPhrase(n, 'مفيش محافظ', 'محفظة واحدة', 'محفظتين', 'محافظ', 'محفظة');
}

export function categoriesPhrase(n: number) {
  return countPhrase(n, 'مفيش فئات', 'فئة واحدة', 'فئتين', 'فئات', 'فئة');
}

/** سطر فلتر الفئات المطوي: «فئة واحدة مختارة» / «فئتين مختارتين» / «3 فئات مختارة» */
export function selectedCategoriesPhrase(n: number) {
  return n === 2 ? 'فئتين مختارتين' : `${categoriesPhrase(n)} مختارة`;
}

/** بيتقال لقارئ الشاشة بعد «مسح الفلتر» (الزرار بيختفي والتركيز بيضيع) */
export const FILTER_CLEARED_ANNOUNCEMENT = 'اتمسح فلتر الفئات، والتقرير بقى على كل الفئات';

export function lettersPhrase(n: number) {
  return countPhrase(n, 'مفيش حروف', 'حرف واحد', 'حرفين', 'حروف', 'حرف');
}

/** بيوصّل الأجزاء الموجودة بس بـ"و" */
export function joinParts(parts: string[]) {
  return parts.filter(Boolean).join(' و');
}

export function walletHistoryPhrase(refs: WalletRefs) {
  return joinParts([
    refs.transactions > 0 ? transactionsPhrase(refs.transactions) : '',
    refs.debts > 0 ? debtsPhrase(refs.debts) : '',
  ]);
}

/**
 * جملة "مربوط بيها ..." في تنبيه الحذف.
 *
 * العمليات والديون هما اللي بيهموا المستخدم الأول، فلو فيه منهم بنقولهم
 * وبس. لو مفيش خالص لكن فيه اشتراك أو جمعية أو دخل ثابت، بنقع عليهم — الجملة
 * لازم تقول حاجة، مش تسيب فراغ بعد "مربوط بيها" (الدخل الثابت كان بيتنسي فتطلع
 * "مربوط بيها ." — الميزة 10).
 */
export function walletLinkSummary(refs: WalletRefs) {
  const history = walletHistoryPhrase(refs);
  if (history) return history;
  const subs = refs.activeSubscriptions.length + refs.inactiveSubscriptions;
  const gams = refs.activeGamiyas.length + refs.inactiveGamiyas;
  const incs = refs.activeIncomes.length + refs.inactiveIncomes;
  return joinParts([
    subs > 0 ? subscriptionsPhrase(subs) : '',
    gams > 0 ? gamiyasPhrase(gams) : '',
    incs > 0 ? incomesPhrase(incs) : '',
  ]) || 'حاجات قديمة';
}

export function categoryLinkSummary(refs: CategoryRefs) {
  const txs = refs.transactions + refs.debtPayments;
  if (txs > 0) return transactionsPhrase(txs);
  const subs = refs.activeSubscriptions.length + refs.inactiveSubscriptions;
  return subs > 0 ? subscriptionsPhrase(subs) : 'حاجات قديمة';
}

export function namesList(items: NamedRef[]) {
  return items.map(i => i.name).join('، ');
}

/** "3 عمليات هتظهر" / "عمليتين هيظهروا" / "عملية واحدة هتظهر" — المثنى بالجمع في العامية (arabic-copy-reviewer) */
function txWillShow(n: number) {
  return `${transactionsPhrase(n)} ${n === 2 ? 'هيظهروا' : 'هتظهر'}`;
}

/** "الاشتراك ده هيقف" / "الاشتراكات دي هتقف" — المفرد بمفرده */
function stopLine(items: NamedRef[], one: string, many: string, pick: string) {
  return `${items.length === 1 ? one : many} لحد ما ${pick}: ${namesList(items)}.`;
}

/**
 * الرصيد اللي هيختفي من الإجمالي بالكلام (الميزة 10، بند 5 و6): موجب ← الإجمالي هيقل، سالب ← هيزيد. من غير علامة "-"
 * على الرقم — "رصيدها -250 هيختفي" بتطلب من المستخدم يترجم العلامة بنفسه.
 */
export function walletBalanceGoneLine(balance: number, money: AmountFormatter) {
  const amount = money(Math.abs(balance));
  return balance > 0
    ? `رصيدها ${amount} ج.م هيختفي من الإجمالي، يعني إجمالي فلوسك هيقل ${amount} ج.م.`
    : `رصيدها سالب ${amount} ج.م هيختفي من الإجمالي، يعني إجمالي فلوسك هيزيد ${amount} ج.م.`;
}

/**
 * سطور "هيحصل إيه لو مسحتها نهائي" — الحقيقة بالأرقام، والسطر اللي مالوش
 * رقم مبيتكتبش أصلاً. المستخدم بياخد القرار وهو شايف التمن، مش بعد ما يدفعه.
 * **عمرها ما بترجع فاضية** (الميزة 10): تأكيد "مسح نهائي" من غير جملة كان بيتقري زي ما يكون مفيش حاجة هتحصل.
 */
export function walletDeleteConsequences(opts: { balance: number; refs: WalletRefs; money: AmountFormatter }): string[] {
  const { balance, refs, money } = opts;
  const lines: string[] = [];
  if (Math.abs(balance) >= BALANCE_EPS) lines.push(walletBalanceGoneLine(balance, money));
  if (refs.transactions > 0) lines.push(`${txWillShow(refs.transactions)} باسم محفظة ممسوحة.`);
  if (refs.debts > 0) lines.push(`مربوط بيها ${debtsPhrase(refs.debts)}.`);
  if (refs.activeSubscriptions.length > 0) {
    lines.push(stopLine(refs.activeSubscriptions, 'الاشتراك ده هيقف', 'الاشتراكات دي هتقف', 'تختارله محفظة'));
  }
  if (refs.activeGamiyas.length > 0) {
    lines.push(stopLine(refs.activeGamiyas, 'الجمعية دي هتقف', 'الجمعيات دي هتقف', 'تختارلها محفظة'));
  }
  if (refs.activeIncomes.length > 0) {
    lines.push(stopLine(refs.activeIncomes, 'الدخل الثابت ده هيقف', 'الدخول الثابتة دي هتقف', 'تختارله محفظة'));
  }
  if (lines.length === 0) lines.push('المحفظة هتتمسح نهائي، ومش هتقدر ترجّعها.');
  return lines;
}

/**
 * مسح الفئة **مبيوقفش** الاشتراكات (الميزة 10، بند 4): الاشتراك بيفضل يتخصم عادي، وعملياته الجديدة بتطلع باسم
 * "فئة ممسوحة" (`DELETED_CATEGORY_LABEL`). الكلام القديم كان بيقول "هتقف" — كدب.
 */
export function categoryDeleteConsequences(refs: CategoryRefs): string[] {
  const lines: string[] = [];
  if (refs.transactions > 0) lines.push(`${txWillShow(refs.transactions)} باسم فئة ممسوحة.`);
  if (refs.debtPayments > 0) lines.push(`${txWillShow(refs.debtPayments)} في الديون باسم فئة ممسوحة.`);
  const subs = refs.activeSubscriptions;
  if (subs.length > 0) {
    lines.push(subs.length === 1
      ? `الاشتراك ده هيفضل يتخصم عادي، بس عملياته الجديدة هتظهر باسم "فئة ممسوحة": ${namesList(subs)}.`
      : `الاشتراكات دي هتفضل تتخصم عادي، بس عملياتها الجديدة هتظهر باسم "فئة ممسوحة": ${namesList(subs)}.`);
  }
  if (refs.hasBudget) lines.push('ميزانيتها الشهرية هتتمسح.');
  if (lines.length === 0) lines.push('الفئة هتتمسح نهائي، ومش هتقدر ترجّعها.');
  return lines;
}

/**
 * منع الأرشفة لأن الرصيد مش صفر (بند 6): السالب بكلامه ("رصيدها سالب X — حوّل فلوس ليها")، والموجب "حوّله لمحفظة تانية".
 * الرقم من `money` (الإخفاء) — الرفض مش تأكيد على رقم.
 */
export function walletBalanceBlockNotice(name: string, balance: number, money: AmountFormatter): [string, string] {
  const amount = money(Math.abs(balance));
  return ['رصيدها لسه مش صفر', balance < 0
    ? `رصيد "${name}" لازم يبقى صفر قبل الأرشفة، ورصيدها سالب ${amount} — حوّل فلوس ليها الأول عشان يبقى صفر.`
    : `رصيد "${name}" ${amount} ج.م، لازم يبقى صفر قبل الأرشفة. حوّله لمحفظة تانية الأول.`];
}

/**
 * الاختيارات اللي تظهر في قايمة (محفظة أو فئة) وقت إنشاء أو تعديل سجل.
 *
 * المؤرشف بيختفي من الاختيارات — ده كل معنى الأرشفة. بس `selectedId` بيفضل
 * ظاهر لو كان مختار خلاص: المستخدم بيعدّل اشتراك قديم مربوط بمحفظة اتأرشفت،
 * ولو شيلناها من القايمة كان هيلاقي المودال فاتح من غير أي اختيار — يعني
 * تعديل الاسم بس كان هيغيّر المحفظة من تحته من غير ما ينتبه.
 */
export function selectableOptions<T extends { id: string; archived?: boolean }>(
  items: T[],
  selectedId?: string,
): T[] {
  return items.filter(i => !i.archived || i.id === selectedId);
}

/* ───────────────  تسوية رصيد المحفظة المؤرشفة  ─────────────── */

/**
 * المحفظة المؤرشفة رصيدها صفر بشرط الأرشفة — بس تعديل أو حذف عملية قديمة
 * عليها بيحرّك الرصيد ده، وهي مخفية من الإجمالي. يعني فلوس بتتحرك في السكوت:
 * تعدّل مصروف قديم من 500 لـ400 على محفظة مؤرشفة، فـ100 جنيه "بتظهر" في
 * محفظة محدش شايفها، والإجمالي بتاعك ما اتغيرش.
 *
 * القاعدة: رصيد المحفظة المؤرشفة لازم يفضل صفر دايمًا. الفرق بيروح لمحفظة
 * شغالة المستخدم بيختارها — فالفلوس بتفضل في مكان هو شايفه.
 */

type TxLike = { type: string; amount: number; walletId: string; toWalletId?: string };

/**
 * أثر عملية واحدة على رصيد محفظة معيّنة. نفس قواعد `walletBalance` بالظبط —
 * لو اتغيّرت هناك لازم تتغيّر هنا، وإلا التسوية هتحسب رقم غير اللي المستخدم
 * شايفه.
 */
export function walletContribution(t: TxLike | undefined, walletId: string): number {
  if (!t) return 0;
  if (t.type === 'income') return t.walletId === walletId ? t.amount : 0;
  if (t.type === 'withdraw') {
    let r = 0;
    if (t.walletId === walletId) r -= t.amount;
    if (t.toWalletId === walletId) r += t.amount;
    return r;
  }
  return t.walletId === walletId ? -t.amount : 0;
}

/** تغيير مقترح على عملية: `after` غايبة = حذف، `before` غايبة = إضافة */
export type TxChange = { before?: TxLike; after?: TxLike };

export type ArchivedDelta = { walletId: string; name: string; delta: number };

/**
 * الفرق اللي التغييرات دي هتعمله في رصيد كل محفظة مؤرشفة.
 *
 * موجب = المحفظة المؤرشفة هتزيد، فالزيادة لازم تخرج منها لمحفظة شغالة.
 * سالب = هتنقص، فالنقص لازم يتغطى من محفظة شغالة.
 *
 * بيتحسب من الداتا المحمّلة، ومقرّب لخانتين عشان مقارنة الصفر متتكسرش من
 * جمع كسور.
 */
export function archivedWalletDeltas(
  changes: TxChange[],
  archivedWallets: { id: string; name: string }[],
): ArchivedDelta[] {
  return archivedWallets
    .map(w => {
      const raw = changes.reduce(
        (s, c) => s + walletContribution(c.after, w.id) - walletContribution(c.before, w.id),
        0
      );
      return { walletId: w.id, name: w.name, delta: Math.round(raw * 100) / 100 };
    })
    .filter(d => Math.abs(d.delta) >= BALANCE_EPS);
}

/** ملاحظة عملية التسوية في التاريخ */
export function settlementNote(archivedWalletName: string) {
  return `تسوية رصيد ${archivedWalletName} (مؤرشفة)`;
}

/**
 * مسح دين/اشتراك/جمعية بيمسح معاه كل العمليات اللي اتولّدت منه
 * (`deleteWithTransactions` في `DataContext`). المسح ده **مبيعملش تسوية**:
 * لو عملية منهم على محفظة مؤرشفة، رصيد المؤرشفة كان بيبعد عن الصفر ومحدش
 * شايفه (المؤرشفة برّه الإجمالي وبرّه الاختيارات). نفس قرار مسح الدفعة
 * الواحدة (`debtEntryArchivedWalletBlock`، 2026-09-22): **بنمنع ونقول الطريق**
 * — رجّع المحفظة الأول — لحد ما يبقى فيه تسوية حقيقية زي `ArchivedSettlement`.
 *
 * الدوال هنا بتتنادى مرتين: من الشاشة قبل التأكيد (عشان المستخدم يعرف قبل ما
 * يدوس)، ومن `DataContext` لحظة المسح (لو المحفظة اتأرشفت والتأكيد مفتوح).
 */
export type CascadeKind = 'debt' | 'subscription' | 'gamiya';

export function debtTransactionIds(d: Pick<Debt, 'initialTransactionId' | 'payments' | 'increases'> | undefined): string[] {
  if (!d) return [];
  return [
    d.initialTransactionId,
    ...(d.payments || []).map(p => p.transactionId),
    ...(d.increases || []).map(inc => inc.transactionId),
  ].filter((x): x is string => !!x);
}

/**
 * كل عمليات الاشتراك (بند H، 2026-11-17): من `history`، ومن `closed` (عملية قفلت فترة وسطرها ضاع من `history`)،
 * ولو اتبعتت `transactions`: أي عملية عليها `subscriptionId` بتاعه — مسح الاشتراك كان بيسيبهم يتامى بيحرّكوا الرصيد.
 */
export function subscriptionTransactionIds(
  s: (Pick<Subscription, 'history'> & { id?: string; closed?: Record<string, { txId?: string }> }) | undefined,
  transactions: { id: string; subscriptionId?: string }[] = [],
): string[] {
  if (!s) return [];
  const ids = [
    ...(s.history || []).map(h => h.transactionId),
    ...Object.values(s.closed || {}).map(c => c?.txId),
    ...(s.id ? transactions.filter(t => t.subscriptionId === s.id).map(t => t.id) : []),
  ].filter((x): x is string => typeof x === 'string' && !!x);
  return [...new Set(ids)];
}

/**
 * كل عمليات الجمعية (بند C، مراجعة 2026-11-18 — نفس `subscriptionTransactionIds`): `months[].transactionId`، والمعرّف
 * الثابت لكل شهر (`gamiyaTxId` — شهر سجّله جهاز تاني والتحديث لسه ما وصلناش)، ولو اتبعتت `transactions`: أي عملية
 * عليها `gamiyaId` بتاعها. مسح معرّف مش موجود في الدفعة مبيعملش حاجة؛ والعدّ في التأكيد بيعدّي على `linkedTransactions`.
 */
export function gamiyaTransactionIds(
  g: (Pick<Gamiya, 'months'> & { id?: string }) | undefined,
  transactions: { id: string; gamiyaId?: string }[] = [],
): string[] {
  if (!g) return [];
  const months = Array.isArray(g.months) ? g.months : [];
  const ids = [
    // شهر الاستلام عليه عمليتين: الاستلام وقسطك (`gamiyaInstallmentTxId` — اختيار أ، 2026-11-18)
    ...months.flatMap(m => gamiyaMonthTxIds(m)),
    ...(g.id ? months.filter(m => typeof m?.id === 'string').map(m => gamiyaTxId(g.id!, m.id)) : []),
    ...(g.id ? months.filter(m => typeof m?.id === 'string' && m.isPayoutMonth).map(m => gamiyaInstallmentTxId(g.id!, m.id)) : []),
    ...(g.id ? transactions.filter(t => t.gamiyaId === g.id).map(t => t.id) : []),
  ].filter((x): x is string => typeof x === 'string' && !!x);
  return [...new Set(ids)];
}

/**
 * العمليات التانية في نفس شهر الجمعية (شهر الاستلام: الاستلام ↔ قسطك). مسح واحدة بيمسح التانية في نفس الذرة
 * (`deleteGamiyaLinkedTransaction`)، فمودال العملية بيحسب تسوية المحفظة المؤرشفة على الاتنين.
 */
export function gamiyaPairedTxIds(gamiyas: Pick<Gamiya, 'months'>[], txId: string): string[] {
  for (const g of gamiyas) {
    const m = (g.months || []).find(x => gamiyaMonthTxIds(x).includes(txId));
    if (m) return gamiyaMonthTxIds(m).filter(x => x !== txId);
  }
  return [];
}

/** العمليات المربوطة اللي لسه موجودة فعلاً — المعرّف ممكن يكون لعملية اتمسحت قبل كده */
export function linkedTransactions<T extends { id: string }>(txIds: string[], transactions: T[]): T[] {
  const wanted = new Set(txIds);
  return transactions.filter(t => wanted.has(t.id));
}

/**
 * المجموعات اللي الفحص محتاجها: المحافظ (مين مؤرشفة) والعمليات (على أنهي
 * محفظة). لو واحدة منهم ما وصلتش، الفرق هيتحسب على قايمة فاضية ويطلع صفر —
 * يعني الفحص هيعدّي والمسح يلمس مؤرشفة من غير ما حد يعرف. فبنمنع.
 */
const CASCADE_SOURCES: ListenerName[] = ['wallets', 'transactions'];

const CASCADE_SUBJECT: Record<CascadeKind, { label: (name: string) => string; withIt: string; feminine: boolean }> = {
  debt: { label: name => `دين "${name}"`, withIt: 'معاه', feminine: false },
  subscription: { label: name => `الاشتراك "${name}"`, withIt: 'معاه', feminine: false },
  gamiya: { label: name => `الجمعية "${name}"`, withIt: 'معاها', feminine: true },
};

export type CascadeDeleteBlock = {
  reason: 'wallet-archived' | 'data-missing' | 'data-loading' | 'charge-in-flight' | 'no-account' | 'no-connection' | 'failed' | 'uncertain' | 'data-broken';
  title: string; body: string;
};

/** بند H: خصم شغال على نفس الاشتراك ("سدّد"/الكارت/التلقائي) ← المسح بيستنى لحد ما يخلص */
export const CHARGE_IN_FLIGHT_DELETE_BLOCK: CascadeDeleteBlock = {
  reason: 'charge-in-flight',
  title: 'استنى ثواني',
  body: 'فيه خصم بيتسجل للاشتراك ده دلوقتي. استنى لحد ما يخلص وبعدين امسح.',
};

/** نفس `CHARGE_IN_FLIGHT_DELETE_BLOCK` للجمعية (بند C): قسط أو استلام بيتسجل دلوقتي */
export const CHARGE_IN_FLIGHT_DELETE_BLOCK_GAMIYA: CascadeDeleteBlock = {
  reason: 'charge-in-flight',
  title: 'استنى ثواني',
  body: 'فيه شهر بيتسجل للجمعية دي دلوقتي. استنى لحد ما يخلص وبعدين امسح.',
};

/** مسح الجمعية ونسخة الحساب مش جاهزة (`uid` فاضي) — كان بيرجع "تم" ومفيش حاجة اتمسحت */
export const NO_ACCOUNT_DELETE_BLOCK_GAMIYA: CascadeDeleteBlock = {
  reason: 'no-account',
  title: 'ما اتمسحتش',
  body: 'الجمعية لسه موجودة — مفيش حساب مفتوح دلوقتي. سجّل دخول تاني وجرب.',
};
/** نفس `NO_ACCOUNT_DELETE_BLOCK_GAMIYA` للاشتراك والدين (مراجعة الدخل 2026-11-18) — كانوا بيرجّعوا "تم" ومفيش حاجة اتمسحت */
export const NO_ACCOUNT_DELETE_BLOCK_SUBSCRIPTION: CascadeDeleteBlock = {
  reason: 'no-account',
  title: 'ما اتمسحش',
  body: 'الاشتراك لسه موجود — مفيش حساب مفتوح دلوقتي. سجّل دخول تاني وجرب.',
};
/**
 * مسح الاشتراك بقى ذرة من السيرفر (9.5-3): بيقرا الاشتراك من السيرفر جوه الذرة، فعملية سجّلها جهاز تاني (تلقائي أو
 * «سدّد») ولسه ما وصلتناش بتتمسح معاه بدل ما تفضل يتيمة بتحرّك الرصيد. التمن: المسح محتاج نت — والنتيجة قاطعة.
 */
export const NO_CONNECTION_DELETE_BLOCK_SUBSCRIPTION: CascadeDeleteBlock = {
  reason: 'no-connection',
  title: 'مفيش نت دلوقتي',
  body: 'الاشتراك ما اتمسحش والرصيد زي ما هو. المسح لازم يتأكد من السيرفر عشان كل الدفعات اللي اتسجلت منه تتمسح معاه — جرب تاني أول ما النت يرجع.',
};
export const FAILED_DELETE_BLOCK_SUBSCRIPTION: CascadeDeleteBlock = {
  reason: 'failed',
  title: 'ما اتمسحش',
  body: 'الاشتراك لسه زي ما هو والرصيد ما اتلمسش. اتأكد إن النت شغال وجرب تاني.',
};
/**
 * 9.5-3 (M1): سجل دفعات الاشتراك على السيرفر متخزّن بشكل مش مقروء (`history` مش قايمة ← `DocShapeError`). منقدرش
 * نعرف كل العمليات اللي اتسجلت منه، فالمسح كان هيسيب منها يتامى بتحرّك الرصيد ساكت ← مبنمسحش. قبل كده الرسالة كانت
 * «اتأكد إن النت شغال» للأبد، والنت مش السبب. نفس الذرات التانية (دفعة الدين، شهر الجمعية): الشكل البايظ ← مفيش كتابة.
 */
export const BROKEN_DATA_DELETE_BLOCK_SUBSCRIPTION: CascadeDeleteBlock = {
  reason: 'data-broken',
  title: 'ما اتمسحش',
  body: 'سجل الدفعات بتاع الاشتراك ده متخزّن بشكل مش مقروء، فمش قادرين نعرف كل الدفعات اللي اتسجلت منه عشان تتمسح معاه. الاشتراك والرصيد زي ما هما — ابعتلنا من "شاركنا رأيك" في الإعدادات.',
};
/** الذرة فشلت وسؤال السيرفر كمان — المسح بيتعاد من غير ضرر (اللي اتمسح مبيتمسحش مرتين)، فالكلام «بص وجرب» */
export const UNCERTAIN_DELETE_BLOCK_SUBSCRIPTION: CascadeDeleteBlock = {
  reason: 'uncertain',
  title: 'مش متأكدين',
  body: 'مقدرناش نعرف الاشتراك اتمسح ولا لأ. استنى ثواني وبص على القايمة — لو لسه موجود جرب تاني.',
};
export const NO_ACCOUNT_DELETE_BLOCK_DEBT: CascadeDeleteBlock = {
  reason: 'no-account',
  title: 'ما اتمسحش',
  body: 'الدين لسه موجود — مفيش حساب مفتوح دلوقتي. سجّل دخول تاني وجرب.',
};

/**
 * هل مسح السجل ده بعملياته هيحرّك رصيد محفظة مؤرشفة؟ `null` = المسح آمن.
 *
 * `loading` = المجموعات اللي لسه مرمتش أول snapshot (`figuresPending` في
 * `DataContext`). من غيره، أول ثواني بعد الفتح (الديون وصلت والعمليات لسه)
 * القوايم فاضية فالفرق صفر والمسح كان هيعدّي — والدفعة بتمسح بالمعرّف من
 * السيرفر برضه (silent-failure-hunter + money-reviewer).
 *
 * **حدود:** عملية معرّفها في السجل ومش في القايمة المحمّلة بتتحسب صفر — صح
 * النهارده (listener العمليات بيجيب المجموعة كلها، فاللي مش موجود اتمسح فعلاً).
 * لو اتعمل windowing (TIMELINE 2026-09-14) الافتراض ده بيقع ولازم يترجعله.
 *
 * الحساب بالفرق مش بالوجود: قرض خرج من محفظة ورجع لنفس المحفظة (مؤرشفة) أثره
 * صفر، ومسحهم مع بعض بيسيب رصيدها صفر زي ما هو — فمبيتمنعش.
 */
export function cascadeDeleteBlock(opts: {
  kind: CascadeKind;
  name: string;
  txIds: string[];
  transactions: (TxLike & { id: string })[];
  wallets: { id: string; name: string; archived?: boolean }[];
  loadErrors: ListenerName[];
  loading?: ListenerName[];
}): CascadeDeleteBlock | null {
  const { kind, name, txIds, transactions, wallets, loadErrors, loading = [] } = opts;
  if (txIds.length === 0) return null;

  const subject = CASCADE_SUBJECT[kind];
  const missing = loadErrors.filter(n => CASCADE_SOURCES.includes(n));
  if (missing.length > 0) {
    return {
      reason: 'data-missing',
      title: 'استنى البيانات توصل',
      body: `بيانات ${listenerNamesPhrase(missing)} ما وصلتش، فمش قادرين نعرف هل مسح ${subject.label(name)} هيلمس محفظة مؤرشفة. دوس "${LOAD_ERROR_RETRY}" فوق، وأول ما البيانات توصل امسح.`,
    };
  }

  const pending = loading.filter(n => CASCADE_SOURCES.includes(n) && !missing.includes(n));
  if (pending.length > 0) {
    return {
      reason: 'data-loading',
      title: 'استنى البيانات توصل',
      body: `بيانات ${listenerNamesPhrase(pending)} لسه بتوصل، فمش قادرين نعرف هل مسح ${subject.label(name)} هيلمس محفظة مؤرشفة. استنى ثواني لحد ما البيانات توصل وبعدين امسح تاني.`,
    };
  }

  const archived = wallets.filter(w => w.archived);
  if (archived.length === 0) return null;
  const linked = linkedTransactions(txIds, transactions);
  const deltas = archivedWalletDeltas(linked.map(before => ({ before })), archived);
  if (deltas.length === 0) return null;

  const names = deltas.map(d => `"${d.name}"`).join(' و');
  const one = deltas.length === 1;
  const itsDeletion = subject.feminine ? 'ومسحها' : 'ومسحه';
  const has = subject.feminine ? 'ليها' : 'ليه';
  return {
    reason: 'wallet-archived',
    title: one ? 'المحفظة دي مؤرشفة' : 'المحافظ دي مؤرشفة',
    body: one
      ? `${subject.label(name)} ${has} عمليات على محفظة ${names} وهي مؤرشفة، ${itsDeletion} هيغيّر رصيدها من غير ما يبان في أي مكان. رجّع المحفظة الأول من الإعدادات ← المحافظ، وبعدين امسح.`
      : `${subject.label(name)} ${has} عمليات على محافظ ${names} وهي مؤرشفة، ${itsDeletion} هيغيّر أرصدتها من غير ما يبان في أي مكان. رجّع المحافظ دي الأول من الإعدادات ← المحافظ، وبعدين امسح.`,
  };
}
const CASCADE_TITLE: Record<CascadeKind, string> = {
  debt: 'مسح الدين',
  subscription: 'مسح الاشتراك',
  gamiya: 'مسح الجمعية',
};

/**
 * تأكيد مسح السجل. نفس شكل تأكيد الدين القديم («متأكد إنك عايز تمسح …؟» وبعده
 * سطر بين قوسين)، بس بيقول **العدد** و**إن الرصيد هيتغيّر** — قبل كده تأكيد
 * الاشتراك والجمعية كان سؤال بس، والمسح بيشيل كل الدفعات والرصيد بيتحرك.
 * `txCount` = العمليات الموجودة فعلاً (`linkedTransactions`)؛ صفر = السؤال لوحده.
 */
export function cascadeDeleteConfirm(kind: CascadeKind, name: string, txCount: number): { title: string; body: string } {
  const subject = CASCADE_SUBJECT[kind];
  const question = kind === 'debt'
    ? `متأكد إنك عايز تمسح دين "${name}"؟`
    : `متأكد إنك عايز تمسح "${name}"؟`;
  if (txCount <= 0) return { title: CASCADE_TITLE[kind], body: question };
  // الفعل قبل العدد ("هيتمسح معاه 5 عمليات") عشان مفيش توافق يتلخبط بين
  // المفرد والمثنى والجمع (arabic-copy-reviewer)
  return {
    title: CASCADE_TITLE[kind],
    body: `${question} (هيتمسح ${subject.withIt} ${transactionsPhrase(txCount)} كمان، وده هيغيّر أرصدة المحافظ المرتبطة)`,
  };
}
