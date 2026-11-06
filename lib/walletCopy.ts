import { fmt } from '@/lib/finance';
import { NEGATIVE_CONFIRM_BODY } from '@/lib/useAmountDrafts';

/** تأكيد تغيير الرصيد الابتدائي — الرقمين بالظبط والأثر (الرصيد كله بيتحرك بالفرق) */
export function openingConfirmCopy(name: string, from: number, to: number) {
  const known = Number.isFinite(from);
  const body = known
    ? `الرصيد الابتدائي لمحفظة "${name}" هيتغيّر من ${fmt(from)} لـ${fmt(to)}، ورصيد المحفظة كله هيتحرك بالفرق ده.`
    : `الرصيد الابتدائي لمحفظة "${name}" هيبقى ${fmt(to)}.`;
  return {
    title: 'تغيّر الرصيد الابتدائي؟',
    body: to < 0 ? `${body}
${NEGATIVE_CONFIRM_BODY}` : body,
    yes: 'أيوه، غيّره',
    no: 'سيبه زي ما هو',
  };
}
