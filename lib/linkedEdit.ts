import type { Debt, Gamiya, Subscription } from '@/context/DataContext';
import {
  debtExcess, debtRemaining, installmentCountFor, pinInstallmentAmount, reopenedDueDate, roundMoney, todayStr,
} from '@/lib/finance';
import type { RecurringIncome } from '@/lib/recurringIncome';

/**
 * تعديل عملية مربوطة بسجل تاني (2026-10-27، بند 14).
 *
 * **الدين بس هو اللي بيتنقل له التعديل.** دفعاته وزياداته وأصله نسخة من اللي
 * اتحرك فعلاً (المبلغ والمحفظة والتاريخ)، والمتبقي وعدد الأقساط محسوبين منها
 * — فتعديل العملية لوحدها كان بيسيب الرصيد والدين على رقمين مختلفين.
 *
 * الاشتراك والجمعية والدخل الثابت **مبيتنقلش ليهم حاجة عن قصد**: المبلغ
 * والمحفظة اللي هناك **جدول** للفترات الجاية مش نسخة من اللي اتدفع ("المبلغ
 * مختلف ← المرة دي بس")، والفترة معروفة بمفتاحها مش بتاريخ العملية. و
 * `history[].amount` في الاشتراك بيقراه حارس "اتسجل النهاردة" بس — نقله كان
 * هيكسره. التفاصيل بالسطر: `reports/2026-10-27-linked-edit-contract.md`.
 *
 * النوع (مصروف/دخل/سحب) **مبيتعدّلش** في أي عملية مربوطة: الدين بيحسب اتجاه
 * الفلوس من `direction`، والجمعية من `isPayoutMonth` — قلب النوع كان هيعكسهم.
 */

export type LinkKind = 'debt' | 'subscription' | 'gamiya' | 'income';

export function transactionLinkKind(txId: string, src: {
  debts: Debt[]; subscriptions: Subscription[]; gamiyas: Gamiya[]; incomes: RecurringIncome[];
}): LinkKind | null {
  if (src.debts.some(d => debtRoleOf(d, txId))) return 'debt';
  if (src.subscriptions.some(s => (s.history || []).some(h => h.transactionId === txId))) return 'subscription';
  if (src.gamiyas.some(g => (g.months || []).some(m => m.transactionId === txId))) return 'gamiya';
  if (src.incomes.some(inc => Object.values(inc.closed || {}).some(c => c.txId === txId))) return 'income';
  return null;
}

export type DebtLinkRole = 'initial' | 'payment' | 'increase';

export function debtRoleOf(d: Debt, txId: string): DebtLinkRole | null {
  if (d.initialTransactionId === txId) return 'initial';
  if ((d.payments || []).some(p => p.transactionId === txId)) return 'payment';
  if ((d.increases || []).some(e => e.transactionId === txId)) return 'increase';
  return null;
}

/** اللي المستخدم كتبه في المودال — الحقول اللي ليها نسخة في الدين */
export type LinkedEditNext = { amount: number; walletId: string; date: string; categoryId?: string };

export type DebtLinkedEditPlan = {
  role: DebtLinkRole;
  /** يتكتب على مستند الدين في نفس الذرة بتاعة العملية */
  patch: Record<string, unknown>;
  debtAfter: Debt;
  countBefore?: number;
  countAfter?: number;
  /** الزيادة المدفوعة فوق الدين قبل/بعد — الشاشة بتسأل لو التعديل هو اللي عملها */
  excessBefore: number;
  excessAfter: number;
};

/**
 * الدين بعد التعديل، والـpatch اللي يوصّله لكده. `null` لو العملية مش مربوطة
 * بالدين ده (اتفكّت من جهاز تاني) — الذرة بتعتبر ده فشل مش "تمام".
 *
 * نفس قواعد الدفعة والزيادة بالظبط: القسط **ثابت** والعدد هو اللي بيتحرك،
 * والدين القديم من غير قيمة متخزّنة بيتثبّت بالقيمة **قبل** التعديل (تعديل
 * الأصل كان هيحرّك القسط المحسوب `الإجمالي ÷ العدد`).
 */
export function debtLinkedEditPlan(d: Debt, txId: string, next: LinkedEditNext, today = todayStr()): DebtLinkedEditPlan | null {
  const role = debtRoleOf(d, txId);
  if (!role) return null;
  const amount = roundMoney(next.amount);
  const patch: Record<string, unknown> = {};

  if (role === 'initial') {
    Object.assign(patch, { totalAmount: amount, initialWalletId: next.walletId, date: next.date });
  } else if (role === 'payment') {
    patch.payments = (d.payments || []).map(p => {
      if (p.transactionId !== txId) return p;
      const { categoryId: _old, ...rest } = p;
      // الفئة على دفعة "عليك له" بس — هي مصروف. "له عندك" دخل مالوش فئة
      const categoryId = d.direction === 'i_owe' ? next.categoryId : undefined;
      return { ...rest, amount, walletId: next.walletId, date: next.date, ...(categoryId ? { categoryId } : {}) };
    });
  } else {
    patch.increases = (d.increases || []).map(e =>
      e.transactionId === txId ? { ...e, amount, walletId: next.walletId, date: next.date } : e);
  }

  const pin = pinInstallmentAmount(d);
  if (pin) Object.assign(patch, pin);
  const debtAfter = { ...d, ...patch } as Debt;
  const recount = installmentCountFor(debtAfter);
  if (recount !== null && recount !== d.installmentCount) {
    patch.installmentCount = recount;
    debtAfter.installmentCount = recount;
  }
  // التعديل فتح دين أقساط كان متسدد (دفعة قلّت، أو الأصل/زيادة كبروا) ← نفس قاعدة
  // الزيادة: المعاد الفايت بيتقدّم. العكس (التعديل سدّده) المعاد بيفضل زي ما هو،
  // زي الدفعة اللي بتخلّص الدين ومسح الدفعة (مبيلمسوش المعاد)
  // الفرق الحقيقي مش مقصوص على صفر: `reopenedDueDate` بتجمعه على متبقي الدين
  // نفسه، فدين مدفوع بزيادة (-200) واتفتح بـ100 لازم ياخد +300 (money-reviewer)
  const reopenedBy = debtRemaining(debtAfter) - debtRemaining(d);
  const due = reopenedDueDate(d, reopenedBy, next.date, today);
  if (due) {
    patch.dueDate = due;
    debtAfter.dueDate = due;
  }

  return {
    role, patch, debtAfter,
    countBefore: d.installmentCount,
    countAfter: debtAfter.installmentCount,
    excessBefore: roundMoney(debtExcess(d)),
    excessAfter: roundMoney(debtExcess(debtAfter)),
  };
}

/** نفس فكرة رسالة الزيادة: العدد ميتغيّرش ساكت. `null` لو مفيش تغيير أو القديم مش معروف */
export function installmentEditMessage(beforeCount: number | undefined, afterCount: number | undefined): string | null {
  if (typeof beforeCount !== 'number' || !Number.isFinite(beforeCount) || beforeCount <= 0) return null;
  if (typeof afterCount !== 'number' || !Number.isFinite(afterCount) || afterCount <= 0) return null;
  if (beforeCount === afterCount) return null;
  return `بعد التعديل، الأقساط بقت ${afterCount} بدل ${beforeCount}.`;
}
