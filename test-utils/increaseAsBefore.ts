import type { Debt } from '@/context/DataContext';
import { increaseLeftoverChoice, leftoverSeen, pinInstallmentAmount, type LeftoverSeen } from '@/lib/finance';

/**
 * زيادة على دين **بالسلوك اللي قبل D1** (2026-10-30): لو الباقي أقل من قسط، التطبيق بقى
 * بيسأل ("يتضاف على آخر قسط" / "قسط منفصل في الآخر") والذرة بترفض الزيادة من غير
 * إجابة. "قسط منفصل" هو السلوك القديم بالظبط، فالاختبارات اللي اتكتبت قبل السؤال وبتختبر
 * حاجة تانية (المسح، المعاد، إعادة العدّ) بتجاوب بيه — عشان تفضل بتختبر نفس الحاجة.
 */
export function increaseAsBefore(
  api: { debts: Debt[]; addDebtIncrease: (id: string, amount: number, date: string, walletId?: string, leftover?: LeftoverSeen) => Promise<unknown> },
  debtId: string, amount: number, date: string, walletId?: string,
) {
  const debt = api.debts.find(d => d.id === debtId);
  const choice = debt ? increaseLeftoverChoice({ ...debt, ...pinInstallmentAmount(debt) }, amount) : null;
  return choice
    ? api.addDebtIncrease(debtId, amount, date, walletId, leftoverSeen(choice, 'separate'))
    : api.addDebtIncrease(debtId, amount, date, walletId);
}
