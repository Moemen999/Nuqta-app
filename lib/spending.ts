import type { Debt, Gamiya } from '@/context/DataContext';
import { endOfMonth, periodExpenseTotal, startOfMonth } from '@/lib/finance';

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
 * **و"عليك له" (`i_owe`) كمان** (قرار مؤمن 2026-11-05): الاستلاف (اتسجل دخل) وزيادته
 * وسداده (اتسجل مصروف، وساعات بفئة) برّه الدخل والمصروف — فلوس مش بتاعتك داخلة
 * وراجعة لصاحبها. نفس القاعدة: العملية زي ما هي والرصيد زي ما هو.
 *
 * **الاستثناء — شرا بالأجل** (قرار مؤمن 2026-11-05، بعد money-reviewer): دين "عليك له" **من غير محفظة**
 * (`initialTransactionId` مش موجود) معناه حاجة اتاخدت ومادخلش فلوس — الشرا نفسه عمره ما اتسجل، فالسداد هو
 * أثره الوحيد. سداده **بيفضل مصروف** (بفئته). الحكم على الدين كله حسب أصله؛ زيادة من محفظة على دين أصله أجل
 * (أو العكس) بتمشي مع الأصل — حد مقبول ومكتوب.
 */
export function transferTransactionIds(
  debts: Pick<Debt, 'direction' | 'initialTransactionId' | 'payments' | 'increases'>[] | undefined,
  gamiyas: Pick<Gamiya, 'months'>[] | undefined,
): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | undefined) => { if (id) ids.add(id); };
  // `?? []`: قايمة لسه ما وصلتش (أو mock قديم) ← مفيش تحويلات، مش كراش
  // الاتجاهين: "له عندك" (السلفة وسدادها) و"عليك له" (الاستلاف وسداده)
  for (const d of debts ?? []) {
    add(d.initialTransactionId);
    (d.increases || []).forEach(e => add(e.transactionId));
    if (isCreditPurchase(d)) continue; // سداد الشرا بالأجل مصروف
    (d.payments || []).forEach(p => add(p.transactionId));
  }
  for (const g of gamiyas ?? []) (g.months || []).forEach(m => add(m.transactionId));
  return ids;
}

/** حالة مصادر التحويلات (الديون والجمعية) — بند 11 */
export type TransfersStatus = 'loading' | 'ready' | 'failed';

/**
 * `failed` لو أي واحد منهم اترفض (حتى لو وصل قبل كده — البيانات القديمة ممكن تكون ناقصة)، `ready` لو الاتنين وصلوا،
 * غير كده `loading`. **الرقم الغلط عمره ما يظهر:** وهو بيحمّل الشاشة مبتعرضش المصروف، ولما يفشل بتعرضه وبتقول.
 */
export function transfersStatusFrom(delivered: ReadonlySet<string>, loadErrors: readonly string[]): TransfersStatus {
  if (loadErrors.includes('debts') || loadErrors.includes('gamiyas')) return 'failed';
  return delivered.has('debts') && delivered.has('gamiyas') ? 'ready' : 'loading';
}

export const TRANSFERS_LOADING = 'بنحمّل…';
/** بعد `TRANSFERS_SLOW_MS` وهو لسه بيحمّل (غالبًا مفيش نت) — من غيره "بنحمّل…" كانت هتفضل للأبد ساكتة */
export const TRANSFERS_SLOW = 'لسه بنحمّل — اتأكد إن النت شغال';
export const TRANSFERS_SLOW_MS = 10_000;
// "زيادة": لما الديون مش موجودة السلفة وقسط الجمعية بيتعدّوا مصروف، والسداد والاستلام دخل — الغلط دايمًا لفوق (arabic-copy-reviewer)
export const TRANSFERS_FAILED_NOTE = 'مقدرناش نجيب الديون والجمعية، فالأرقام دي ممكن تكون زيادة: فيها سلف أو أقساط جمعية اتحسبت مصروف أو دخل.';

/** دين "عليك له" من غير محفظة (شرا بالأجل): سداده مصروف بفئة، مش تحويل */
export function isCreditPurchase(d: Pick<Debt, 'direction' | 'initialTransactionId'>): boolean {
  return d.direction === 'i_owe' && !d.initialTransactionId;
}

/**
 * سطر تحذير في فورم الدين/الزيادة "عليك له" من غير محفظة (شرا بالأجل) — قرار مؤمن 2026-11-06 على ترشيح المقارنة بالنت:
 * من غيره المستخدم ممكن يسجّل الشرا مصروف عادي **و**يسجّل السداد ← نفس الفلوس مرتين في المصروف
 */
export const CREDIT_PURCHASE_HINT = 'متسجلش الشرا نفسه مصروف — السداد هو اللي بيتحسب';

type Tx = { id: string; type: string; amount: number; date: string };

/** المصروف الحقيقي: `expense` ومش سلفة ولا قسط جمعية */
export function spendingExpenses<T extends Tx>(tx: T[], transfers: Set<string>): T[] {
  return tx.filter(t => t.type === 'expense' && !transfers.has(t.id));
}

/**
 * **الرقم الواحد** لمصروف فترة: الرقم البطل في التقارير وكارت الشهر في الرئيسية بيعدّوا من هنا بالظبط — نفس
 * الصفوف ونفس ترتيب الجمع، فالاتنين مينفعش يختلفوا ولا بقرش. `visibleIds` = فلتر الفئات في التقارير
 * (`undefined` = من غير فلتر).
 */
export function spendInRange<T extends Tx & { categoryId?: string }>(
  tx: T[], transfers: Set<string>, range: { from: string; to: string }, visibleIds?: string[],
): number {
  return periodExpenseTotal(spendingExpenses(tx.filter(t => t.date >= range.from && t.date <= range.to), transfers), visibleIds);
}

/** «الشهر ده» كفترة: أول يوم في شهر `today` لآخر يوم فيه (مش لحد النهارده) */
export function thisMonthRange(today: string): { from: string; to: string } {
  return { from: startOfMonth(today), to: endOfMonth(today) };
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
export const TRANSFERS_NOTE = 'الديون (ليا وعليا) والجمعية مش محسوبين في الإجماليات دي — دي فلوس بتتنقل، مش مصروف ولا دخل.';
