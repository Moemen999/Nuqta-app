import { endOfMonth } from '@/lib/finance';
import { MONTH_NAMES } from '@/lib/recurringIncome';

/**
 * النصايح الاستباقية للميزانية (سطر 2026-09-25 "نصايح استباقية"، قرارات مؤمن 2026-11-05):
 * "لو كمّلت بنفس المعدل، الميزانية هتخلص يوم 20 نوفمبر" — سطر تحت الفئة وتحت الإجمالي في الميزانية (مش بانر).
 *
 * - السقف هو **رقم المستخدم نفسه** (الميزانية) — مفيش حد فلوس جديد متخترع.
 * - **مبتظهرش أول `FORECAST_MIN_DAY` أيام** (قرار مؤمن): حاجة كبيرة اتشرت يوم 2 بتنفخ المعدل.
 * - **مبتظهرش غير بـ`FORECAST_MIN_TX` مصاريف عالأقل** في الشهر (قرار مؤمن): فاتورة واحدة يوم 10 مش "معدل".
 * - **اللي اتسجل لوحده (`autoRecorded`: اشتراك/جمعية) مش داخل في المعدل ولا في العدد** (قرار مؤمن) — بس
 *   فلوسه **محسوبة من الفاضل**: مدفوع خلاص ومش هيتكرر بالمعدل.
 * - مبتظهرش لو رقم الكارت وصل `BUDGET_NEAR_RATIO` (لون/بانر "قربت تخلص" أو "خلصت" بيقولها أصلاً)،
 *   ولا لو اليوم المتوقع بعد آخر الشهر.
 */
export const BUDGET_NEAR_RATIO = 0.8;
export const FORECAST_MIN_DAY = 7;
export const FORECAST_MIN_TX = 3;

type Row = { amount: number; autoRecorded?: boolean };

/**
 * اليوم من الشهر اللي الميزانية هتخلص فيه، أو `null` لو مفيش نصيحة.
 *
 * `rowsToDate` = مصاريف الشهر **لحد النهارده** (من غير السلفة والجمعية) — عملية بتاريخ 28 وانت في يوم 10
 * مبتنفخش المعدل (money-reviewer). `shownSpend` = رقم الكارت (الشهر كله) — شرط "قربت تخلص" عليه عشان يطابق اللون.
 *
 * المجموع في يوم d = كل اللي اتصرف لحد النهارده + المعدل المتغيّر × (d − النهارده)؛ بيوصل السقف في
 * d = النهارده + الفاضل ÷ المعدل (من غير اللي اتسجل لوحده ومن غير مصروف قدام ده نفس limit × day ÷ spend).
 */
export function budgetRunOutDay(rowsToDate: Row[], limit: number, today: string, shownSpend: number): number | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(today)) return null;
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(shownSpend)) return null;
  const day = Number(today.slice(8, 10));
  if (day <= FORECAST_MIN_DAY) return null;
  if (shownSpend / limit >= BUDGET_NEAR_RATIO) return null;

  let all = 0;
  let variable = 0;
  let count = 0;
  for (const r of rowsToDate) {
    if (!Number.isFinite(r.amount)) return null; // رقم بايظ ← مفيش توقع، مش توقع غلط
    all += r.amount;
    if (!r.autoRecorded) { variable += r.amount; count++; }
  }
  if (count < FORECAST_MIN_TX || variable <= 0) return null;
  // الفاضل من **رقم الكارت** (الشهر كله): مصروف متسجل بتاريخ قدام اتحجز خلاص — مش تفاؤل بيه (silent-failure-hunter جولة 2).
  // `all` بيدخل لو أكبر (احتياطي — المفروض الكارت دايمًا >= اللي لحد النهارده)
  const remaining = limit - Math.max(all, shownSpend);
  if (remaining <= 0) return null;
  // الضرب قبل القسمة: `variable / day` العشري كان بيطلّع 14.000000001 فيوم زيادة (silent-failure-hunter جولة 2)
  const runOut = day + Math.ceil((remaining * day) / variable);
  const lastDay = Number(endOfMonth(today).slice(8, 10));
  return runOut <= lastDay ? runOut : null;
}

export function budgetForecastText(runOutDay: number, today: string): string {
  return `لو كمّلت بنفس المعدل، الميزانية هتخلص يوم ${runOutDay} ${MONTH_NAMES[Number(today.slice(5, 7)) - 1]}`;
}
