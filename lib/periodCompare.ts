import { addDays, endOfMonth, startOfMonth } from '@/lib/finance';

export type CompareWindow = { from: string; to: string };
export type ComparePreset = 'thisMonth' | 'last7' | 'lastMonth' | 'last6Months' | 'custom';

/** عدد الأيام شامل الطرفين — الحساب على UTC زي باقي حسابات التواريخ */
function inclusiveDays(w: CompareWindow): number {
  return Math.round((Date.parse(w.to) - Date.parse(w.from)) / 86400000) + 1;
}

/**
 * نافذتين للمقارنة في التقارير: الفترة الحالية (متقصوصة على النهارده) والفترة اللي تتقارن بيها.
 * قبل كده «الشهر ده» كان بيقارن 12 يوم بشهر كامل قبله، فأول نص أي شهر كان بيبان موفّر.
 * - `thisMonth`: نفس عدد الأيام من أول الشهر اللي فات (متقصوص على آخر يوم فيه).
 * - غير كده: نفس طول الفترة الحالية قبل بدايتها على طول.
 * `null` لو الفترة كلها لسه ما جتش.
 */
export function comparisonWindows(
  range: CompareWindow,
  today: string,
  preset: ComparePreset,
): { current: CompareWindow; previous: CompareWindow } | null {
  if (range.from > today) return null;
  const current = { from: range.from, to: range.to < today ? range.to : today };
  const days = inclusiveDays(current);

  if (preset === 'thisMonth') {
    const prevMonthDay = addDays(startOfMonth(current.from), -1);
    const from = startOfMonth(prevMonthDay);
    const lastDay = endOfMonth(prevMonthDay);
    const to = addDays(from, days - 1);
    return { current, previous: { from, to: to < lastDay ? to : lastDay } };
  }

  return { current, previous: { from: addDays(current.from, -days), to: addDays(current.from, -1) } };
}
