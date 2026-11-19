import { WALLET_AMOUNT_MAX, fmt, type WalletAmountRejectReason } from '@/lib/finance';
import { NEGATIVE_CONFIRM_BODY } from '@/lib/useAmountDrafts';

/** «سالب 50» مش «-50»: العلامة جوه الجملة بتتقري غلط (arabic-copy-reviewer، الميزة 10) */
function signedAmount(n: number) {
  return n < 0 ? `سالب ${fmt(-n)}` : fmt(n);
}

/** تأكيد تغيير الرصيد الابتدائي — الرقمين، والأثر بالكلام: الرصيد هيزيد/هيقل كام (arabic-copy-reviewer) */
export function openingConfirmCopy(name: string, from: number, to: number) {
  const known = Number.isFinite(from);
  const diff = known ? Math.round((to - from) * 100) / 100 : 0;
  const effect = diff === 0 ? 'الرقم نفسه ما اتغيّرش'
    : diff > 0 ? `يعني رصيد المحفظة دلوقتي هيزيد ${fmt(diff)} ج.م` : `يعني رصيد المحفظة دلوقتي هيقل ${fmt(-diff)} ج.م`;
  const body = known
    ? `الرصيد الابتدائي لمحفظة "${name}" هيتغيّر من ${signedAmount(from)} لـ${signedAmount(to)} ج.م، ${effect}.`
    : `الرصيد الابتدائي لمحفظة "${name}" هيبقى ${signedAmount(to)} ج.م.`;
  return {
    title: 'تغيّر الرصيد الابتدائي؟',
    body: to < 0 ? `${body}\n${NEGATIVE_CONFIRM_BODY}` : body,
    yes: 'أيوه، غيّره',
    no: 'سيبه زي ما هو',
  };
}

/** «أيوه» اتداست بس الرقم اتغيّر من جهاز تاني والتأكيد مفتوح */
export function openingStaleNotice(name: string): [string, string] {
  return ['ما اتحفظش', `رصيد محفظة "${name}" الابتدائي اتغيّر من جهاز تاني وانت بتأكّد، فما غيّرناهوش. راجع الرقم وأكّد تاني.`];
}

/** سطر تحت خانة الرصيد الابتدائي طول ما فيه رقم مستني تأكيد */
export const OPENING_PENDING_HINT = 'لسه ما اتحفظش — سيب الخانة وأكّد';
/** الشاشة اتقفلت والرقم لسه مستني تأكيد */
export function openingDroppedNotice(name: string): [string, string] {
  return ['الرصيد الابتدائي ما اتغيّرش', `اللي كتبته في محفظة "${name}" ما اتحفظش عشان ما اتأكدش. ارجع للمحافظ واكتبه تاني وأكّد.`];
}

/**
 * رقم مرفوض في خانة محفظة (كلام، أو «1,5» الغامض) — الخانة بترجع للمحفوظ **وبتقول** بدل الرجوع الساكت (الميزة 6،
 * الجولة الأخيرة، بند 7). `field`: «الرصيد الابتدائي» أو «حد التنبيه»
 */
export function walletAmountRejectNotice(
  field: 'الرصيد الابتدائي' | 'حد التنبيه', name: string, reason: WalletAmountRejectReason = 'invalid',
): [string, string] {
  // المحفظة لسه ما وصلتش أو اتمسحت ← «لمحفظة ""» كانت بتطلع فاضية (arabic-copy-reviewer)
  const owner = name.trim() ? `لمحفظة "${name.trim()}"` : 'للمحفظة دي';
  const tail = 'فاللي اتكتب ما اتحفظش ورجّعنا الرقم اللي كان محفوظ.';
  if (reason === 'too-large') {
    return ['الرقم ده كبير أوي', `${field} ${owner} لازم يكون أقل من ${fmt(WALLET_AMOUNT_MAX)}، ${tail}`];
  }
  if (reason === 'too-small') {
    return ['الرقم ده صغير أوي', `${field} ${owner} بيتحسب بالقرش، وأقل من قرش بيبقى صفر، ${tail}`];
  }
  // الرصيد الابتدائي بيقبل السالب — اللي اترفض فيه بالسالب سببه الحجم («-1e16»)
  if (reason === 'negative' && field === 'الرصيد الابتدائي') {
    return ['الرقم ده كبير أوي', `${field} ${owner} لازم يكون بين سالب ${fmt(WALLET_AMOUNT_MAX)} و${fmt(WALLET_AMOUNT_MAX)}، ${tail}`];
  }
  if (reason === 'negative') {
    return ['الرقم ده ما اتحفظش', `${field} ${owner} لازم يكون مبلغ من صفر وطالع، ${tail}`];
  }
  return ['الرقم ده ما اتحفظش', `${field} ${owner} لازم يكون رقم، والكسر بنقطة (1.5)، ${tail}`];
}

/** «أيوه» اتداست بس المحفظة اتأرشفت أو اتمسحت والتأكيد مفتوح (الميزة 10، L2) — مفيش كتابة */
export function openingGoneNotice(name: string): [string, string] {
  // المحفظة اتمسحت ← مفيش اسم نوصله، فـ«محفظة ""» كانت بتطلع (الميزة 10، جولة 2)
  const owner = name.trim() ? `محفظة "${name.trim()}"` : 'المحفظة دي';
  return ['ما اتحفظش', `رصيد ${owner} الابتدائي ما اتغيّرش — المحفظة اتأرشفت أو اتمسحت وانت بتأكّد.`];
}

/** الدوسة على تأكيد مسح/أرشفة والحاجة اتمسحت من جهاز تاني — بدل الرجوع الساكت (الميزة 10، جولة 2) */
export function goneFromAnotherDeviceNotice(kind: 'المحفظة' | 'الفئة', name: string, action: 'delete' | 'archive'): [string, string] {
  return [`${kind} دي اتمسحت`, `"${name}" اتمسحت من جهاز تاني، فمفيش حاجة ${action === 'delete' ? 'تتمسح' : 'تتأرشف'}.`];
}

/** حاجة شغالة جديدة اتربطت والشيت مفتوح ← الشيت بيتفتح من جديد بعد السطر ده (الميزة 10، جولة 2) */
export const SHEET_RELINKED_NOTICE: [string, string] = ['فيه حاجة جديدة اتربطت', 'حاجة شغالة جديدة اتربطت بيها وانت بتأرشف — اختار لها مكان هي كمان.'];

/** الاسم اتمسح والخانة اتسابت فاضية ← رجع للقديم، والشاشة بتقول بدل الرجوع الساكت (الميزة 10) */
export function nameEmptyNotice(kind: 'المحفظة' | 'الفئة'): [string, string] {
  return ['الاسم ما اتغيّرش', `اسم ${kind} مينفعش يبقى فاضي، فرجّعنا الاسم اللي كان.`];
}

/** بيتقال لقارئ الشاشة بعد ما خانة بتتحفظ لوحدها كتبت فعلًا (a11y-architect) — من غيره مفيش أي إشارة إن الرقم اتحفظ */
export const AUTOSAVED_ANNOUNCEMENT = 'اتحفظ';
