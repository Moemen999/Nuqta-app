import { addDays, isDateStr } from '@/lib/finance';

/** مصدر واحد لأسامي الشهور — `lib/recurringIncome.ts` بيعيد تصديره عشان الاستيرادات القديمة */
export const MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/**
 * «12 نوفمبر»، أو «12 نوفمبر 2025» لو السنة مش سنة `today`. من غير كلمات نسبية —
 * للتواريخ اللي المستخدم بيختارها أو معاد الاستحقاق. أي نص مش `YYYY-MM-DD` بيرجع زي ما هو.
 * `today` بيجي من `todayStr()` (اليوم المحلي) وقت الرسم.
 */
export function dateText(iso: string, today: string): string {
  if (!isDateStr(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const name = MONTH_NAMES[m - 1];
  if (!name || d < 1 || d > 31) return iso;
  const base = `${d} ${name}`;
  const sameYear = isDateStr(today) && Number(today.slice(0, 4)) === y;
  return sameYear ? base : `${base} ${y}`;
}

/** «النهاردة» / «امبارح» / وغير كده `dateText`. التواريخ الجاية تفضل تاريخ عادي (من غير «بكرة»). */
export function dayText(iso: string, today: string): string {
  if (!isDateStr(iso) || !isDateStr(today)) return iso;
  if (iso === today) return 'النهاردة';
  if (iso === addDays(today, -1)) return 'امبارح';
  return dateText(iso, today);
}
