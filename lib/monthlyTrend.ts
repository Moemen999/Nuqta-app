import { periodExpenseTotal } from '@/lib/finance';
import { MONTH_NAMES } from '@/lib/recurringIncome';

/**
 * رسم الاتجاه في التقارير (سطر 2026-09-25 "رسم اتجاه"، اتنفّذ 2026-11-05): مصروف كل شهر لآخر `months` شهور
 * لحد الشهر اللي فيه `today` — **مستقل عن فلتر الفترة** (الاتجاه شهور كاملة دايمًا)، بس **بيمشي مع فلتر الفئات**
 * بنفس قاعدة `periodExpenseTotal` عشان الرقم والرسم يتحسبوا بنفس الطريقة.
 *
 * `expenses` لازم تكون جاية من `spendingExpenses` (السلفة والجمعية متشالين) — الدالة دي مبتفلترش النوع.
 *
 * الترتيب من الأقدم للأحدث. `share` = طول العمود نسبةً **لأكبر شهر** (زي `barRows`). الشهر الحالي `partial`
 * لأنه لسه ما خلصش — عموده أقصر طبيعي ومينفعش يتقري "صرفت أقل".
 */
export type TrendMonth = {
  key: string; // 'YYYY-MM'
  label: string; // اسم الشهر
  amount: number;
  share: number;
  partial: boolean;
};

export const TREND_MONTHS = 6;

type Row = { date: string; amount: number; categoryId?: string };

export function monthlyTrend(expenses: Row[], today: string, visibleIds?: string[], months = TREND_MONTHS): TrendMonth[] {
  // اليوم بشكل غلط ← مفيش رسم، مش أعمدة باسم "undefined"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)); // 1..12
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    const yy = Math.floor(idx / 12);
    const mm = (idx % 12) + 1;
    keys.push(`${yy}-${String(mm).padStart(2, '0')}`);
  }
  const byMonth = new Map<string, Row[]>(keys.map(k => [k, []]));
  let skipped = 0;
  for (const r of expenses) {
    // صف بتاريخ مش نص أو مبلغ مش رقم محدود (NaN/Infinity) مبيوقّعش الشاشة ولا يبوّظ كل الأعمدة — بيتشال وبيتعدّ
    if (typeof r.date !== 'string' || !Number.isFinite(r.amount)) { skipped++; continue; }
    // عملية بتاريخ قدام جوه الشهر ده (20 نوفمبر والنهارده 5) مبتتعدّش — العمود "لحد النهارده" (money-reviewer).
    // **بقصد:** "مصروفات الفترة" على "الشهر ده" لحد آخر الشهر فبتعدّها — الرقمين ممكن يختلفوا بيها بس، والسطر تحت الرسم بيقولها
    if (r.date > today) continue;
    const bucket = byMonth.get(r.date.slice(0, 7));
    if (bucket) bucket.push(r);
  }
  // العدد بس — مفيش مبالغ ولا أسامي (قاعدة Sentry)
  if (skipped > 0) console.warn(`[monthlyTrend] ${skipped} صف اتشال من الاتجاه (تاريخ أو مبلغ بايظ)`);
  const amounts = keys.map(k => periodExpenseTotal(byMonth.get(k)!, visibleIds));
  const max = amounts.reduce((a, b) => Math.max(a, b), 0);
  const current = today.slice(0, 7);
  return keys.map((key, i) => ({
    key,
    label: MONTH_NAMES[Number(key.slice(5, 7)) - 1],
    amount: amounts[i],
    // سالب (لو حصل) ← صفر، مش ارتفاع سالب
    share: max > 0 ? Math.max(0, amounts[i] / max) : 0,
    partial: key === current,
  }));
}
