import { addDays, daysBetween, endOfMonth, isDateStr, startOfMonth } from '@/lib/finance';

export type CompareWindow = { from: string; to: string };
export type ComparePreset = 'thisMonth' | 'last7' | 'lastMonth' | 'last6Months' | 'custom';

/**
 * نافذتين للمقارنة في التقارير: الفترة الحالية (متقصوصة على النهارده) والفترة اللي تتقارن بيها.
 * قبل كده «الشهر ده» كان بيقارن 12 يوم بشهر كامل قبله، فأول نص أي شهر كان بيبان موفّر.
 * - `thisMonth`: نفس عدد الأيام من أول الشهر اللي فات (متقصوص على آخر يوم فيه).
 *   في آخر أيام شهر أطول من اللي قبله النافذة بتتقص على آخر يوم في الشهر اللي فات
 *   (31 مارس ← 1–28 فبراير)، فـ«نفس الأيام» هناك تقريبية.
 * - `lastMonth`: الشهر اللي قبله كله (أكتوبر ← سبتمبر 1–30، مارس ← فبراير كله، يناير ← ديسمبر السنة اللي فاتت).
 * - غير كده: نفس طول الفترة الحالية قبل بدايتها على طول.
 * `null` لو الفترة كلها لسه ما جتش، أو لو تاريخ مش بصيغة YYYY-MM-DD.
 */
export function comparisonWindows(
  range: CompareWindow,
  today: string,
  preset: ComparePreset,
): { current: CompareWindow; previous: CompareWindow } | null {
  if (!isDateStr(range.from) || !isDateStr(range.to) || !isDateStr(today)) return null;
  if (range.from > today) return null;
  const current = { from: range.from, to: range.to < today ? range.to : today };
  const days = daysBetween(current.from, current.to) + 1;

  if (preset === 'thisMonth' || preset === 'lastMonth') {
    const prevMonthDay = addDays(startOfMonth(current.from), -1);
    const from = startOfMonth(prevMonthDay);
    const lastDay = endOfMonth(prevMonthDay);
    if (preset === 'lastMonth') return { current, previous: { from, to: lastDay } };
    const to = addDays(from, days - 1);
    return { current, previous: { from, to: to < lastDay ? to : lastDay } };
  }

  return { current, previous: { from: addDays(current.from, -days), to: addDays(current.from, -1) } };
}
