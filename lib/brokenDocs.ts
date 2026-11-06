/**
 * بند B — العملية أو المحفظة اللي مستندها بايظ (قرار مؤمن 2026-11-06): **ظاهرة ومتعلّمة وبرّه كل حسبة**، مش متشالة ساكت
 * ومش صفر. هنا النصوص وقرار "تتصلّح من هنا ولا تتمسح بس". القراية نفسها في `lib/fromDoc.ts`.
 */
import type { BrokenReason, BrokenTransaction } from '@/lib/fromDoc';
import { transactionsPhrase } from '@/lib/archiving';
import type { LinkKind } from '@/lib/linkedEdit';

export const BROKEN_MARK = '⚠️ بيانات ناقصة';
export const BROKEN_SECTION_TITLE = '⚠️ بيانات ناقصة — مش محسوبة في أي رقم';
export const BROKEN_REASON_LABEL: Record<BrokenReason, string> = {
  amount: 'المبلغ مش مقروء',
  date: 'التاريخ مش مقروء',
  type: 'نوع العملية مش مقروء',
};

/** سطر البانر في الرئيسية — العدد بالكلام، والجمع بيتفق مع العدد */
export function brokenTransactionsBannerText(n: number): string {
  return n === 1
    ? 'فيه عملية واحدة بياناتها ناقصة ومش محسوبة في أي رقم.'
    : `فيه ${transactionsPhrase(n)} بياناتهم ناقصة ومش محسوبين في أي رقم.`;
}
export function brokenTransactionsBannerAction(n: number): string {
  return n === 1 ? 'صلّحها من الأرشيف' : 'صلّحهم من الأرشيف';
}
export function brokenWalletBannerText(name: string): string {
  return `رصيد البداية بتاع محفظة "${name}" مش مقروء، فاتحسب صفر. اكتبه تاني من المحافظ.`;
}
export const BROKEN_WALLET_ACTION = 'افتح المحافظ';

export const FIX_TITLE = 'صلّح العملية';
export const FIX_DELETE = 'امسحها';
export const FIX_DELETE_CONFIRM_TITLE = 'تمسح العملية؟';
export const FIX_DELETE_PLAIN_BODY = 'العملية دي مش محسوبة في أي رقم، فمسحها مش هيغيّر أي رصيد.';
export const FIX_INVALID_AMOUNT = 'اكتب مبلغ أكبر من صفر.';

export type FixBlock = 'type' | 'linked' | 'wallet';
export const FIX_BLOCK_TEXT: Record<FixBlock, string> = {
  type: 'نوع العملية مش مقروء، فمش هينفع تتصلّح من هنا. امسحها وسجّلها تاني.',
  linked: 'العملية دي مربوطة بدين أو اشتراك أو جمعية أو دخل ثابت، فمش هينفع تتصلّح من هنا. امسحها وسجّلها تاني.',
  wallet: 'المحفظة بتاعتها مؤرشفة أو اتمسحت، فمش هينفع تتصلّح من هنا. امسحها، أو رجّع المحفظة الأول.',
};

/**
 * إمتى التصليح (مبلغ + تاريخ) **ممنوع** والمسح بس:
 * - النوع مش مقروء: مش عارفين الفلوس رايحة فين.
 * - مربوطة (دين/اشتراك/جمعية/دخل ثابت): الكيان فيه نسخة من المبلغ — تصليح العملية لوحدها كان هيفرّقهم (نفس سبب
 *   `linkedEdit.ts`). المعرّفات الثابتة (`incomeId`...) بتتعدّ مربوطة حتى لو الكيان مش لاقيه.
 * - المحفظة (أو وجهة التحويل) مش موجودة أو مؤرشفة: التصليح هيدخّل فلوس في محفظة مؤرشفة رصيدها اتسوّى صفر
 *   ومن غير تسوية — الحد ده أبسط من إننا نعمل تسوية من هنا.
 */
export function brokenFixBlock(
  t: BrokenTransaction,
  linkKind: LinkKind | null,
  wallets: { id: string; archived?: boolean }[],
): FixBlock | null {
  if (t.reasons.includes('type') || !t.type) return 'type';
  if (linkKind || t.incomeId || t.subscriptionId || t.gamiyaId) return 'linked';
  const active = (id?: string) => !!id && wallets.some(w => w.id === id && !w.archived);
  if (!active(t.walletId)) return 'wallet';
  if (t.type === 'withdraw' && (!active(t.toWalletId) || t.toWalletId === t.walletId)) return 'wallet';
  return null;
}
