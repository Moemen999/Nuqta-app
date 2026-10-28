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

/**
 * أقصى "كل كام يوم" (D-A، 2026-10-28): 1096 = 3 سنين بيوم كبيسة. أوسع حد عند خدمة دفع
 * كبيرة (Stripe: "Maximum of three years interval")؛ متاجر التطبيقات سنة بالكتير.
 * فوقه مالوش استخدام، و2,914,000 يوم فوق بيطلّع سنة من 5 أرقام فمقارنة التواريخ
 * كنص بتبوظ ("10005-…" < "2026-…")، و99,979,246 فوق التاريخ بيبقى NaN.
 */
export const CUSTOM_DAYS_MAX = 1096;
/** أقصى أيام تذكير قبل المعاد (D-A): سنة — تذكير أبعد من دورة سنوية مالوش معنى */
export const REMINDER_DAYS_MAX = 365;

export const ENTRY_MESSAGES = {
  amount: 'المبلغ لازم يبقى أكبر من صفر. اكتبه بالأرقام، زي 150 أو 99.5.',
  monthlyAmount: 'القسط الشهري لازم يبقى مبلغ أكبر من صفر. اكتبه بالأرقام، زي 1000.',
  payoutAmount: 'مبلغ الاستلام لازم يبقى مبلغ أكبر من صفر. اكتبه بالأرقام، زي 12000.',
  customDays: `خانة "كل كام يوم" لازم يبقى فيها رقم صحيح بين 1 و${CUSTOM_DAYS_MAX} (يعني 3 سنين بالكتير)، من غير كسور. اكتب عدد الأيام، زي 30.`,
  // الخانة اسمها مختلف بين الاشتراك ("قبل الموعد") والجمعية ("قبل كل قسط") — اسم يمشي على الاتنين
  reminderDays: `خانة التذكير (بكام يوم قبل) لازم يبقى فيها رقم صحيح بين 0 و${REMINDER_DAYS_MAX} (يعني سنة بالكتير)، من غير كسور. اكتب 0 لو مش عايز تذكير قبل المعاد.`,
  // D-B (2026-10-28): اتعادت كتابتها — القديمة ("راجع البيانات — …") مكانتش بتقول تعمل إيه
  payoutMonth: 'خانة "هتستلم في الشهر رقم كام؟" لازم يبقى فيها رقم صحيح من 1 لحد "عدد الشهور الكلي"، من غير كسور. اكتب رقم الشهر اللي هتستلم فيه، زي 6.',
  totalMonths: `"عدد الشهور الكلي" لازم يبقى رقم صحيح بين 1 و${GAMIYA_MAX_MONTHS}. اكتب عدد شهور الجمعية، زي 12.`,
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
  // عشري بس: `Number("0x10")` = 16 و`Number("0b11")` = 3 كانوا هيعدّوا كمبلغ
  return /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(text) ? Number(text) : NaN;
}

export const validCustomDays = (v: number) => wholeNumberIn(v, 1, CUSTOM_DAYS_MAX);
export const validReminderDays = (v: number) => wholeNumberIn(v, 0, REMINDER_DAYS_MAX);
export const validGamiyaMonths = (v: number) => wholeNumberIn(v, 1, GAMIYA_MAX_MONTHS);

/**
 * أول مشكلة في بيانات اشتراك (إضافة كاملة أو تعديل جزئي) أو `null`. الحقول
 * اللي مش موجودة في التعديل الجزئي مبتتفحصش، واللي موجودة بتتفحص دايمًا (حتى
 * `customDays` من غير `frequency`). "مخصص" من غير `customDays` مرفوض.
 */
export function subscriptionEntryProblem(data: {
  amount?: number; frequency?: string; customDays?: number; reminderDaysBefore?: number;
}): EntryInvalid | null {
  if (data.amount !== undefined && storableAmount(data.amount) === null) return invalidEntry('amount');
  if (data.frequency === 'custom' && data.customDays === undefined) return invalidEntry('customDays');
  if (data.customDays !== undefined && !validCustomDays(data.customDays)) return invalidEntry('customDays');
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

/**
 * قيمة متخزّنة من نسخة قديمة وبقت برّه الحدود (C2، 2026-10-28): الحفظ لسه بيترفض لحد ما
 * تتصلح (قرار مؤمن: الغلط بيترفض برسالة، ومبيتغيّرش ساكت)، بس الرسالة بتبان **أول ما
 * التعديل يتفتح** مش بعد "احفظ" — فالمستخدم اللي جاي يغيّر الاسم بس يعرف من الأول ليه.
 */
export const LEGACY_VALUE_NOTE = 'فيه خانة متسجّلة من نسخة قديمة وبقت برّه الحدود الجديدة، فلازم تتصلح قبل الحفظ.';
export const legacyNote = (problem: EntryInvalid | null) => (problem ? `${LEGACY_VALUE_NOTE} ${problem.message}` : '');

export { storableAmount };
