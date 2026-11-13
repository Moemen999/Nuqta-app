import { endOfMonth, snapPiastre, startOfMonth } from '@/lib/finance';
import { budgetLevel, type BudgetLevel } from '@/lib/budgetForecast';
import { comparisonWindows } from '@/lib/periodCompare';
import { spendInRange, thisMonthRange } from '@/lib/spending';

/**
 * كارت «صرفت الشهر ده» في الرئيسية — الحسبة كلها هنا، صافية، والشاشة بتعرض بس.
 *
 * - `spent` من `spendInRange` على `thisMonthRange` — **نفس الدالة** اللي الرقم البطل في التقارير («الشهر ده»، من غير
 *   فلتر فئات) بيعدّي منها، فالرقمين نفس الرقم بالقرش (حتى العملية اللي تاريخها جاي في الشهر ده).
 * - `budget`: ميزانية الشهر الإجمالية لو متحطة (أكبر من صفر)، والدرجة من `budgetLevel` — نفس مصدر البانر.
 *   `remaining` سالب لما الميزانية اتعدّت (الشاشة بتعرضه بالقيمة المطلقة بصيغة «عدّيت»).
 * - `previous`: الشهر اللي فات **لحد نفس اليوم** (`comparisonWindows` — نفس نافذة التقارير)، أو `null` لو ده أول شهر
 *   في الاستخدام (مفيش ولا عملية من أي نوع قبل أول الشهر: «صفر» هناك مش معناه «مصرفتش» بل «مفيش تاريخ») أو التاريخ بايظ.
 *   لو الشهر اللي فات صرفه صفر **وفيه تاريخ أقدم** ← `total: 0` مش `null`.
 * - `wholeMonth`: النافذة هي الشهر اللي فات كله (النهارده آخر يوم في شهر أطول منه مثلاً) — الجملة بتقول «كله» مش «لحد يوم».
 */
export type MonthSummary = {
  spent: number;
  budget: { limit: number; remaining: number; level: BudgetLevel } | null;
  previous: { total: number; to: string; wholeMonth: boolean } | null;
};

type Tx = { id: string; type: string; amount: number; date: string; categoryId?: string };

export function monthSummary({ transactions, transfers, today, totalBudget }: {
  transactions: Tx[];
  transfers: Set<string>;
  today: string;
  totalBudget: number;
}): MonthSummary {
  const range = thisMonthRange(today);
  const spent = spendInRange(transactions, transfers, range);
  const budget = Number.isFinite(totalBudget) && totalBudget > 0
    ? { limit: totalBudget, remaining: snapPiastre(totalBudget - spent), level: budgetLevel(spent, totalBudget) }
    : null;

  let previous: MonthSummary['previous'] = null;
  const windows = comparisonWindows(range, today, 'thisMonth');
  const monthStart = startOfMonth(today);
  if (windows && transactions.some(t => t.date < monthStart)) {
    const { to } = windows.previous;
    previous = {
      total: spendInRange(transactions, transfers, windows.previous),
      to,
      wholeMonth: to === endOfMonth(windows.previous.from) && Number(to.slice(8)) < Number(today.slice(8)),
    };
  }
  return { spent, budget, previous };
}
