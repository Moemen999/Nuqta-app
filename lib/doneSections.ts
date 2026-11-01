import type { Debt, Gamiya } from '@/context/DataContext';
import { debtGrandTotal, debtPaid } from '@/lib/finance';

/**
 * أقسام "خلص" المطوية (قرار مؤمن 2026-11-02): **محسوبة وقت العرض، مفيش بيانات بتتغيّر**.
 * زيادة على دين متسدد، أو مسح قسط جمعية، بيرجّعهم للنشط لوحدهم.
 */

/** نفس شرط "اتسدد بالكامل" في كارت الدين بالظبط (`debts.tsx`) — التعريف مبيتغيّرش هنا */
export function isDebtSettled(d: Debt): boolean {
  return debtGrandTotal(d) - debtPaid(d) <= 0;
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
