import type { Debt, Gamiya } from '@/context/DataContext';
import { PIASTRE_EPS, debtGrandTotal, debtPaid } from '@/lib/finance';

/**
 * أقسام "خلص" المطوية (قرار مؤمن 2026-11-02): **محسوبة وقت العرض، مفيش بيانات بتتغيّر**.
 * زيادة على دين متسدد، أو مسح قسط جمعية، بيرجّعهم للنشط لوحدهم.
 */

/**
 * "اتسدد بالكامل" — الكارت والطيّ مع بعض. **بسماحية نص قرش** (`PIASTRE_EPS`، زي الذرة في
 * `addDebtPayment`): مجموع الدفعات بالكسور ممكن يسيب باقي زي 2e-12 في دين متسدد بالقرش،
 * فكان بيفضل "مش متسدد" ويعرض 0.00 (money-reviewer، 2026-11-02). **مستني موافقة مؤمن**
 */
export function isDebtSettled(d: Debt): boolean {
  return debtGrandTotal(d) - debtPaid(d) <= PIASTRE_EPS;
}

/** الدين أو دفعة/زيادة عليه لسه بترفع (`pendingTxIds` من `DataContext`) */
export function debtHasPendingEntry(d: Debt, pendingTxIds: ReadonlySet<string> | undefined): boolean {
  if (!pendingTxIds || pendingTxIds.size === 0) return false;
  const ids = [d.initialTransactionId, ...(d.payments || []).map(p => p.transactionId), ...(d.increases || []).map(e => e.transactionId)];
  return ids.some(id => !!id && pendingTxIds.has(id));
}

/** جمعية خلصت = فيها شهور وكلهم اتقفلوا. من غير شهور خالص ← مش "خلصت" (تفضل باينة) */
export function isGamiyaFinished(g: Gamiya): boolean {
  const months = g.months || [];
  return months.length > 0 && months.every(m => m.status === 'done');
}

/** بيقسّم القايمة من غير ما يغيّر ترتيبها */
export function splitDone<T>(items: T[], isDone: (item: T) => boolean): { active: T[]; done: T[] } {
  const active: T[] = [];
  const done: T[] = [];
  for (const item of items) (isDone(item) ? done : active).push(item);
  return { active, done };
}
