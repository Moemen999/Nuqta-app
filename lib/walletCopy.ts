import { fmt } from '@/lib/finance';
import { NEGATIVE_CONFIRM_BODY } from '@/lib/useAmountDrafts';

/** تأكيد تغيير الرصيد الابتدائي — الرقمين، والأثر بالكلام: الرصيد هيزيد/هيقل كام (arabic-copy-reviewer) */
export function openingConfirmCopy(name: string, from: number, to: number) {
  const known = Number.isFinite(from);
  const diff = known ? to - from : 0;
  const effect = diff > 0 ? `يعني رصيد المحفظة دلوقتي هيزيد ${fmt(diff)} ج.م` : `يعني رصيد المحفظة دلوقتي هيقل ${fmt(-diff)} ج.م`;
  const body = known
    ? `الرصيد الابتدائي لمحفظة "${name}" هيتغيّر من ${fmt(from)} لـ${fmt(to)}، ${effect}.`
    : `الرصيد الابتدائي لمحفظة "${name}" هيبقى ${fmt(to)} ج.م.`;
  return {
    title: 'تغيّر الرصيد الابتدائي؟',
    body: to < 0 ? `${body}\n${NEGATIVE_CONFIRM_BODY}` : body,
    yes: 'أيوه، غيّره',
    no: 'سيبه زي ما هو',
  };
}

/** سطر تحت خانة الرصيد الابتدائي طول ما فيه رقم مستني تأكيد */
export const OPENING_PENDING_HINT = 'لسه ما اتحفظش — سيب الخانة وأكّد';
/** الشاشة اتقفلت والرقم لسه مستني تأكيد */
export function openingDroppedNotice(name: string): [string, string] {
  return ['الرصيد الابتدائي ما اتغيّرش', `اللي كتبته في محفظة "${name}" ما اتحفظش عشان ما اتأكدش. ارجع للمحافظ واكتبه تاني وأكّد.`];
}
