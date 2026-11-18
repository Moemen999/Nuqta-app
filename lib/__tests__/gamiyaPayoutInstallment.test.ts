import { gamiyaInstallmentTxId, gamiyaMarkConfirmBody, gamiyaMonthTxIds, gamiyaPayoutHint } from '@/lib/autoCharge';
import { gamiyaPairedTxIds, gamiyaTransactionIds } from '@/lib/archiving';
import { transferTransactionIds } from '@/lib/spending';
import { transactionLinkKind } from '@/lib/linkedEdit';
import { seedDocs } from '@/scripts/seedTestAccount';
import type { Gamiya } from '@/context/DataContext';

/**
 * قرار مؤمن (اختيار أ، 2026-11-18): شهر الاستلام بيسجّل **عمليتين** في نفس الذرة — استلام الجمعية كلها (دخل) وقسطك
 * في الشهر ده (مصروف، معرّفه `gamiya_{id}_{شهر}_inst`). قبل كده الاستلام لوحده كان بيخلّي المحفظة أعلى من الحقيقة
 * بقسط كامل على طول الدورة. الملف ده بيثبّت إن كل مكان بيعرف عمليات الشهر بيعرف التانية كمان.
 */
const g = {
  id: 'g', name: 'Work', monthlyAmount: 1000,
  months: [
    { id: 'm1', monthIndex: 1, isPayoutMonth: false, status: 'done', transactionId: 'gamiya_g_m1' },
    { id: 'm2', monthIndex: 2, isPayoutMonth: true, status: 'done', transactionId: 'gamiya_g_m2', installmentTransactionId: 'gamiya_g_m2_inst' },
  ],
} as unknown as Gamiya;

describe('معرّف قسطك في شهر الاستلام', () => {
  it('ثابت ومختلف عن عملية الاستلام', () => {
    expect(gamiyaInstallmentTxId('g', 'm2')).toBe('gamiya_g_m2_inst');
  });
  it('عمليات الشهر: الاستلام وقسطك', () => {
    expect(gamiyaMonthTxIds(g.months[1])).toEqual(['gamiya_g_m2', 'gamiya_g_m2_inst']);
    expect(gamiyaMonthTxIds(g.months[0])).toEqual(['gamiya_g_m1']);
  });
  it('العملية التانية في نفس الشهر (لمسح الاتنين مع بعض وتسوية المحفظة المؤرشفة عليهم)', () => {
    expect(gamiyaPairedTxIds([g], 'gamiya_g_m2')).toEqual(['gamiya_g_m2_inst']);
    expect(gamiyaPairedTxIds([g], 'gamiya_g_m2_inst')).toEqual(['gamiya_g_m2']);
    expect(gamiyaPairedTxIds([g], 'gamiya_g_m1')).toEqual([]);
    expect(gamiyaPairedTxIds([g], 'unrelated')).toEqual([]);
  });
});

describe('كل مكان بيعرف عمليات الجمعية بيعرف قسط شهر الاستلام', () => {
  it('مسح الجمعية: المربوطة + المعرّف الثابت للقسط حتى لو الشهر عندنا لسه pending', () => {
    const ids = gamiyaTransactionIds(g);
    expect(ids).toContain('gamiya_g_m2_inst');
    const pending = { ...g, months: [{ ...g.months[1], status: 'pending', transactionId: undefined, installmentTransactionId: undefined }] } as unknown as Gamiya;
    expect(gamiyaTransactionIds(pending)).toEqual(['gamiya_g_m2', 'gamiya_g_m2_inst']);
  });
  it('التقارير والميزانية: القسط ده تحويل زي باقي أقساط الجمعية (مش مصروف)', () => {
    expect(transferTransactionIds([], [g]).has('gamiya_g_m2_inst')).toBe(true);
  });
  it('العملية مربوطة بالجمعية (نوعها مقفول، والتحذير قبل المسح)', () => {
    expect(transactionLinkKind('gamiya_g_m2_inst', { debts: [], subscriptions: [], gamiyas: [g], incomes: [] })).toBe('gamiya');
  });
  it('مسح بيانات التجربة بيلاقيها', () => {
    const docs = seedDocs({
      wallets: [], categories: [], debts: [], subscriptions: [], incomes: [], budgets: {},
      gamiyas: [{ id: 'g', name: 'جمعية تجربة', months: g.months }],
      transactions: [{ id: 'gamiya_g_m2_inst', walletId: 'real' }],
    });
    expect(docs).toContainEqual({ collection: 'transactions', id: 'gamiya_g_m2_inst' });
  });
});

describe('نص تأكيد الاستلام: الرقمين اللي هيتكتبوا', () => {
  const TODAY = '2026-11-12';
  it('الاستلام وقسطك', () => {
    expect(gamiyaMarkConfirmBody({ name: 'Work', monthIndex: 4, dueDate: TODAY, amount: 15000, installment: 1500, isPayout: true }, 'CIB', TODAY))
      .toBe('استلام جمعية "Work" (شهر 4، 12 نوفمبر) — نسجّل استلام 15,000 ج.م في CIB، وقسطك في الشهر ده 1,500 ج.م يتدفع من نفس المحفظة؟');
  });
  it('قسط مش مقروء: جملة عامة من غير NaN', () => {
    const body = gamiyaMarkConfirmBody({ name: 'Work', monthIndex: 4, dueDate: TODAY, amount: 15000, installment: NaN, isPayout: true }, 'CIB', TODAY);
    expect(body).toBe('جمعية "Work" — نسجّل استلام الجمعية وقسطك في الشهر ده؟');
  });
});

describe('سطر توضيح مبلغ الاستلام في فورم الجمعية', () => {
  it('بيقول إن قسطك في شهر الاستلام بيتسجل لوحده', () => {
    expect(gamiyaPayoutHint).toBe('اكتب الجمعية كلها (القسط × عدد الأعضاء). في شهر الاستلام هيتسجل ده استلام، وقسطك في الشهر ده بيتسجل معاه مصروف.');
  });
});
