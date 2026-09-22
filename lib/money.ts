import { fmt } from '@/lib/finance';

/**
 * إخفاء المبالغ — الصيغة الواحدة لكل التطبيق.
 *
 * القناع **ثابت الطول** مهما كان الرقم: لو طوله بيتغيّر مع الرقم («•••»
 * لـ 500 و«•••••» لـ 50,000) يبقى القناع نفسه بيقول الرقم تقريبًا.
 */
export const MONEY_MASK = '••••';
export const CURRENCY = 'ج.م';

/** دالة التنسيق اللي بتتبعت لأي حاجة بتبني جملة فيها مبلغ */
export type AmountFormatter = (n: number) => string;

export const plainAmount: AmountFormatter = fmt;
export const maskedAmount: AmountFormatter = () => MONEY_MASK;

export function amountFormatter(hidden: boolean): AmountFormatter {
  return hidden ? maskedAmount : plainAmount;
}

/** «1,250 ج.م» أو «•••• ج.م» */
export function moneyText(n: number, hidden: boolean) {
  return `${hidden ? MONEY_MASK : fmt(n)} ${CURRENCY}`;
}
