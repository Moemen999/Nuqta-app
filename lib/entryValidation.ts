import { storableAmount } from '@/lib/linkedEdit';

/**
 * فحص قيم فورم الاشتراك والجمعية — نفس الدوال في الشاشة وجوه `DataContext`
 * (بند 15، 2026-10-28)، فالقيمة اللي الشاشة قبلتها هي نفسها اللي بتتخزّن، والشاشة
 * اللي نسيت الفحص بتترفض برضه.
 *
 * **قرار مؤمن:** القيمة الغلط **بتترفض برسالة** — مفيش رجوع ساكت لقيمة افتراضية
 * (`Number(x) || 30` كان بيحوّل "0" لـ30 من غير ما يقول، وبيقبل Infinity والسالب).
 * كل رسالة بتقول السبب وتعمل إيه.
 */

/** أقصى عدد شهور للجمعية (قرار مؤمن 2026-10-28) */
export const GAMIYA_MAX_MONTHS = 60;

export const ENTRY_MESSAGES = {
  amount: 'المبلغ ده مينفعش يتسجّل. اكتب مبلغ أكبر من صفر بالأرقام، زي 150 أو 99.5.',
  monthlyAmount: 'القسط الشهري لازم يبقى مبلغ أكبر من صفر. اكتبه بالأرقام، زي 1000.',
  payoutAmount: 'مبلغ الاستلام لازم يبقى مبلغ أكبر من صفر. اكتبه بالأرقام، زي 12000.',
  customDays: 'عدد أيام التكرار لازم يبقى رقم صحيح من 1 وطالع، من غير كسور. اكتب عدد الأيام، زي 30.',
  reminderDays: 'أيام التذكير لازم تبقى رقم صحيح من 0 وطالع، من غير كسور. اكتب 0 لو مش عايز تذكير قبل المعاد.',
  // مش جديدة: نفس رسالة فورم الجمعية من قبل البند
  payoutMonth: 'راجع البيانات — تأكد إن شهر الاستلام رقم صحيح ضمن عدد الشهور',
  totalMonths: `عدد شهور الجمعية لازم يبقى رقم صحيح من 1 لـ ${GAMIYA_MAX_MONTHS}. اكتب عدد الشهور، زي 12.`,
} as const;

export type EntryField = keyof typeof ENTRY_MESSAGES;

/** نتيجة الحفظ اللي `addSubscription`/`updateSubscription`/`addGamiya` بيرجّعوها */
export type EntrySaveResult = { outcome: 'done' } | { outcome: 'invalid'; field: EntryField; message: string };

export type EntryInvalid = Extract<EntrySaveResult, { outcome: 'invalid' }>;
export const invalidEntry = (field: EntryField): EntryInvalid => ({ outcome: 'invalid', field, message: ENTRY_MESSAGES[field] });

/** رقم صحيح محدود ≥ `min` (و≤ `max` لو اتحدد) — "2.5" و"1e999" و"-1" مرفوضين */
export function wholeNumberIn(value: number, min: number, max = Infinity): boolean {
  // isSafeInteger مش isInteger: "1e307" رقم صحيح محدود في نظر isInteger، وتاريخه بيطلع "NaN-NaN-NaN"
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** النص اللي المستخدم كتبه ← رقم. الفاضي = NaN (مرفوض)، مش صفر */
export function parseEntryNumber(text: string): number {
  return text.trim() === '' ? NaN : Number(text);
}

export const validCustomDays = (v: number) => wholeNumberIn(v, 1);
export const validReminderDays = (v: number) => wholeNumberIn(v, 0);
export const validGamiyaMonths = (v: number) => wholeNumberIn(v, 1, GAMIYA_MAX_MONTHS);

/**
 * أول مشكلة في بيانات اشتراك (إضافة كاملة أو تعديل جزئي) أو `null`. الحقول
 * اللي مش موجودة في التعديل الجزئي مبتتفحصش. `customDays` بيتفحص بس لما
 * التكرار "مخصص" — غير كده مبيتخزّنش أصلاً.
 */
export function subscriptionEntryProblem(data: {
  amount?: number; frequency?: string; customDays?: number; reminderDaysBefore?: number;
}): EntryInvalid | null {
  if (data.amount !== undefined && storableAmount(data.amount) === null) return invalidEntry('amount');
  if (data.frequency === 'custom' && (data.customDays === undefined || !validCustomDays(data.customDays))) return invalidEntry('customDays');
  if (data.reminderDaysBefore !== undefined && !validReminderDays(data.reminderDaysBefore)) return invalidEntry('reminderDays');
  return null;
}

/**
 * أول مشكلة في بيانات جمعية جديدة أو `null`. "2.5" شهر كانت بتعمل شهرين، وشهر
 * استلام 2.5 عمره ما بيطابق شهر فالاستلام كان بيضيع ساكت؛ و"1e999" شهر كان
 * RangeError في `Array.from`.
 */
export function gamiyaEntryProblem(data: {
  monthlyAmount: number; totalMonths: number; payoutMonthIndex: number; payoutAmount: number; reminderDaysBefore: number;
}): EntryInvalid | null {
  if (storableAmount(data.monthlyAmount) === null) return invalidEntry('monthlyAmount');
  if (!validGamiyaMonths(data.totalMonths)) return invalidEntry('totalMonths');
  if (!wholeNumberIn(data.payoutMonthIndex, 1, data.totalMonths)) return invalidEntry('payoutMonth');
  if (storableAmount(data.payoutAmount) === null) return invalidEntry('payoutAmount');
  if (!validReminderDays(data.reminderDaysBefore)) return invalidEntry('reminderDays');
  return null;
}

export { storableAmount };
