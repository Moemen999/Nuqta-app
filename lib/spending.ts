import type { Debt, Gamiya } from '@/context/DataContext';

/**
 * **السلفة والجمعية مش مصروف** (قرار مؤمن 2026-09-29، خطوة 8).
 *
 * الفلوس اللي سلّفتها لحد لسه بتاعتك (بقت عنده بدل ما تبقى في محفظتك)، وقسط
 * الجمعية ادخار راجعلك. كانوا بيتسجلوا `expense` من غير فئة، فكانوا بيدخلوا
 * الرسم في "فئات ممسوحة"، و"مصروفات الفترة"، وإجمالي ميزانية الشهر — تسلّف
 * صاحبك 2000 فبانر "الميزانية قربت تخلص" يولّع.
 *
 * **والناحية التانية لازم تمشي معاها:** اللي بيرجعلك من السلفة، واستلام
 * الجمعية، كانوا `income`. لو السلفة طلعت من المصروف والسداد فضل دخل، الدخل
 * بيتنفخ بفلوس عمرها ما اتكسبت. فالاتنين "تحويل" — برّه المصروف وبرّه الدخل.
 *
 * **من غير ما نلمس ولا عملية متخزّنة:** العملية لسه `expense`/`income` (الرصيد
 * بيتحسب منها زي ما هو — `walletBalance` مبيتغيّرش)، واللي بيتغيّر إنها مبتتعدّش
 * في المصروف والدخل. بنعرفها من المعرّفات المتخزّنة أصلاً جوه الدين والجمعية
 * (`transactionId`) — مفيش migration ولا حقل جديد.
 *
 * **برّه القرار ومتساب زي ما هو:** ناحية "عليك له" (`i_owe`) — الاستلاف
 * بيتسجل دخل، والسداد مصروف **بفئة المستخدم اختارها**. شيلهم محتاج قرار
 * (TIMELINE).
 */
export function transferTransactionIds(
  debts: Pick<Debt, 'direction' | 'initialTransactionId' | 'payments' | 'increases'>[] | undefined,
  gamiyas: Pick<Gamiya, 'months'>[] | undefined,
): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | undefined) => { if (id) ids.add(id); };
  // `?? []`: قايمة لسه ما وصلتش (أو mock قديم) ← مفيش تحويلات، مش كراش
  for (const d of debts ?? []) {
    if (d.direction !== 'owed_to_me') continue;
    add(d.initialTransactionId);
    (d.increases || []).forEach(e => add(e.transactionId));
    (d.payments || []).forEach(p => add(p.transactionId));
  }
  for (const g of gamiyas ?? []) (g.months || []).forEach(m => add(m.transactionId));
  return ids;
}

type Tx = { id: string; type: string; amount: number; date: string };

/** المصروف الحقيقي: `expense` ومش سلفة ولا قسط جمعية */
export function spendingExpenses<T extends Tx>(tx: T[], transfers: Set<string>): T[] {
  return tx.filter(t => t.type === 'expense' && !transfers.has(t.id));
}

/**
 * مصروف الشهر كله — للميزانية الإجمالية في الرئيسية وفي `BudgetView`. كان
 * متكتوب مرتين جوه الشاشتين (`reduce` مباشرة) بدل دالة مختبَرة.
 */
export function monthSpendTotal(tx: Tx[], month: string, transfers: Set<string>): number {
  return spendingExpenses(tx, transfers)
    .filter(t => t.date.slice(0, 7) === month)
    .reduce((s, t) => s + t.amount, 0);
}

/** إجماليات الأرشيف: الدخل والمصروف من غير التحويلات، وكام تحويل اتساب برّه */
export function cashTotals(tx: Tx[], transfers: Set<string>): { income: number; expense: number; transfers: number } {
  let income = 0;
  let expense = 0;
  let skipped = 0;
  for (const t of tx) {
    if (t.type !== 'income' && t.type !== 'expense') continue;
    if (transfers.has(t.id)) { skipped++; continue; }
    if (t.type === 'income') income += t.amount; else expense += t.amount;
  }
  return { income, expense, transfers: skipped };
}

/** سطر تحت إجماليات الأرشيف لما فيه سلفة أو جمعية في الفترة — عشان الإجمالي ميبانش غلط قدام القايمة */
export const TRANSFERS_NOTE = 'السلفة والجمعية مش محسوبين في الإجماليات دي — دي فلوسك بتتنقل، مش مصروف ولا دخل.';
