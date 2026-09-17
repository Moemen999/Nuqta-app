import type { Debt, Gamiya, Subscription, Transaction } from '@/context/DataContext';
import { fmt, walletBalance } from '@/lib/finance';

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
  data: { transactions: Transaction[]; debts: Debt[]; subscriptions: Subscription[]; gamiyas: Gamiya[] },
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
    || refs.inactiveSubscriptions > 0 || refs.inactiveGamiyas > 0;
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
  const needsTarget = opts.refs.activeSubscriptions.length > 0 || opts.refs.activeGamiyas.length > 0;
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
function countPhrase(n: number, one: string, two: string, many: string, plural: string) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n <= 10) return `${n} ${many}`;
  return `${n} ${plural}`;
}

export function transactionsPhrase(n: number) {
  return countPhrase(n, 'عملية واحدة', 'عمليتين', 'عمليات', 'عملية');
}

export function debtsPhrase(n: number) {
  return countPhrase(n, 'دين واحد', 'دينين', 'ديون', 'دين');
}

export function subscriptionsPhrase(n: number) {
  return countPhrase(n, 'اشتراك واحد', 'اشتراكين', 'اشتراكات', 'اشتراك');
}

export function gamiyasPhrase(n: number) {
  return countPhrase(n, 'جمعية واحدة', 'جمعيتين', 'جمعيات', 'جمعية');
}

export function walletsPhrase(n: number) {
  return countPhrase(n, 'محفظة واحدة', 'محفظتين', 'محافظ', 'محفظة');
}

export function categoriesPhrase(n: number) {
  return countPhrase(n, 'فئة واحدة', 'فئتين', 'فئات', 'فئة');
}

export function lettersPhrase(n: number) {
  return countPhrase(n, 'حرف واحد', 'حرفين', 'حروف', 'حرف');
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
