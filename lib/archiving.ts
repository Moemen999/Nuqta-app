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
    lines.push(`${transactionsPhrase(refs.transactions)} هتفضل من غير محفظة.`);
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
    lines.push(`${transactionsPhrase(refs.transactions)} هتفضل من غير فئة.`);
  }
  if (refs.debtPayments > 0) {
    lines.push(`${transactionsPhrase(refs.debtPayments)} في الديون هتفضل من غير فئة.`);
  }
  if (refs.activeSubscriptions.length > 0) {
    lines.push(`الاشتراكات دي هتقف لحد ما تختارلها فئة: ${namesList(refs.activeSubscriptions)}.`);
  }
  if (refs.hasBudget) {
    lines.push('ميزانيتها الشهرية هتتمسح.');
  }
  return lines;
}
