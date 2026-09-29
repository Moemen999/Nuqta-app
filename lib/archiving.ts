import type { Debt, Gamiya, Subscription, Transaction } from '@/context/DataContext';
import type { RecurringIncome } from '@/lib/recurringIncome';
import { fmt, walletBalance } from '@/lib/finance';
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
    transactions: Transaction[]; debts: Debt[]; subscriptions: Subscription[]; gamiyas: Gamiya[];
    incomes?: RecurringIncome[];
  },
): WalletRefs {
  const transactions = data.transactions.filter(
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
    transactions: Transaction[];
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
  | { kind: 'no-target' };

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

export function walletsPhrase(n: number) {
  return countPhrase(n, 'مفيش محافظ', 'محفظة واحدة', 'محفظتين', 'محافظ', 'محفظة');
}

export function categoriesPhrase(n: number) {
  return countPhrase(n, 'مفيش فئات', 'فئة واحدة', 'فئتين', 'فئات', 'فئة');
}

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
 * وبس. لو مفيش خالص لكن فيه اشتراك أو جمعية، بنقع عليهم — الجملة لازم
 * تقول حاجة، مش تسيب فراغ بعد "مربوط بيها".
 */
export function walletLinkSummary(refs: WalletRefs) {
  const history = walletHistoryPhrase(refs);
  if (history) return history;
  const subs = refs.activeSubscriptions.length + refs.inactiveSubscriptions;
  const gams = refs.activeGamiyas.length + refs.inactiveGamiyas;
  return joinParts([
    subs > 0 ? subscriptionsPhrase(subs) : '',
    gams > 0 ? gamiyasPhrase(gams) : '',
  ]);
}

export function categoryLinkSummary(refs: CategoryRefs) {
  const txs = refs.transactions + refs.debtPayments;
  if (txs > 0) return transactionsPhrase(txs);
  const subs = refs.activeSubscriptions.length + refs.inactiveSubscriptions;
  return subs > 0 ? subscriptionsPhrase(subs) : '';
}

export function namesList(items: NamedRef[]) {
  return items.map(i => i.name).join('، ');
}

/**
 * سطور "هيحصل إيه لو مسحتها نهائي" — الحقيقة بالأرقام، والسطر اللي مالوش
 * رقم مبيتكتبش أصلاً. المستخدم بياخد القرار وهو شايف التمن، مش بعد ما يدفعه.
 */
export function walletDeleteConsequences(opts: { balance: number; refs: WalletRefs }): string[] {
  const { balance, refs } = opts;
  const lines: string[] = [];
  if (Math.abs(balance) >= BALANCE_EPS) {
    lines.push(`رصيدها ${fmt(balance)} ج.م هيختفي من الإجمالي.`);
  }
  if (refs.transactions > 0) {
    lines.push(`${transactionsPhrase(refs.transactions)} هتظهر باسم محفظة ممسوحة.`);
  }
  if (refs.debts > 0) {
    lines.push(`${debtsPhrase(refs.debts)} مربوط بيها.`);
  }
  if (refs.activeSubscriptions.length > 0) {
    lines.push(`الاشتراكات دي هتقف لحد ما تختارلها محفظة: ${namesList(refs.activeSubscriptions)}.`);
  }
  if (refs.activeGamiyas.length > 0) {
    lines.push(`الجمعيات دي هتقف لحد ما تختارلها محفظة: ${namesList(refs.activeGamiyas)}.`);
  }
  if (refs.activeIncomes.length > 0) {
    lines.push(`الدخل الثابت ده هيقف لحد ما تختارله محفظة: ${namesList(refs.activeIncomes)}.`);
  }
  return lines;
}

export function categoryDeleteConsequences(refs: CategoryRefs): string[] {
  const lines: string[] = [];
  if (refs.transactions > 0) {
    lines.push(`${transactionsPhrase(refs.transactions)} هتظهر باسم فئة ممسوحة.`);
  }
  if (refs.debtPayments > 0) {
    lines.push(`${transactionsPhrase(refs.debtPayments)} في الديون هتظهر باسم فئة ممسوحة.`);
  }
  if (refs.activeSubscriptions.length > 0) {
    lines.push(`الاشتراكات دي هتقف لحد ما تختارلها فئة: ${namesList(refs.activeSubscriptions)}.`);
  }
  if (refs.hasBudget) {
    lines.push('ميزانيتها الشهرية هتتمسح.');
  }
  return lines;
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

export function subscriptionTransactionIds(s: Pick<Subscription, 'history'> | undefined): string[] {
  return (s?.history || []).map(h => h.transactionId).filter((x): x is string => !!x);
}

export function gamiyaTransactionIds(g: Pick<Gamiya, 'months'> | undefined): string[] {
  return (g?.months || []).map(m => m.transactionId).filter((x): x is string => !!x);
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

const CASCADE_SUBJECT: Record<CascadeKind, { label: (name: string) => string; him: string; feminine: boolean }> = {
  debt: { label: name => `دين "${name}"`, him: 'بيه', feminine: false },
  subscription: { label: name => `الاشتراك "${name}"`, him: 'بيه', feminine: false },
  gamiya: { label: name => `الجمعية "${name}"`, him: 'بيها', feminine: true },
};

export type CascadeDeleteBlock = { reason: 'wallet-archived' | 'data-missing'; title: string; body: string };

/**
 * هل مسح السجل ده بعملياته هيحرّك رصيد محفظة مؤرشفة؟ `null` = المسح آمن.
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
}): CascadeDeleteBlock | null {
  const { kind, name, txIds, transactions, wallets, loadErrors } = opts;
  if (txIds.length === 0) return null;

  const subject = CASCADE_SUBJECT[kind];
  const missing = loadErrors.filter(n => CASCADE_SOURCES.includes(n));
  if (missing.length > 0) {
    return {
      reason: 'data-missing',
      title: 'استنى البيانات توصل',
      body: `بيانات ${listenerNamesPhrase(missing)} ما وصلتش، فمش هنقدر نتأكد إن مسح ${subject.label(name)} مش هيلمس محفظة مؤرشفة. دوس "${LOAD_ERROR_RETRY}" فوق، وجرّب تاني بعد ما البيانات توصل.`,
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
