import type { Debt, Gamiya, Subscription } from '@/context/DataContext';
import type { RecurringIncome } from '@/lib/recurringIncome';
import { debtLinkedEditPlan, installmentEditMessage, storableAmount, transactionLinkKind } from '@/lib/linkedEdit';

/**
 * تعديل عملية مربوطة بدين (2026-10-27): الرصيد كان بيتحرك والدين فاضل على
 * المبلغ القديم. دلوقتي الخطة بتتحسب هنا والكتابة الذرية في `DataContext`.
 * الاشتراك والجمعية والدخل الثابت **مبيتنقلش** ليهم حاجة — المبالغ هناك جدول
 * مش نسخة (تقرير `reports/2026-10-27-linked-edit-contract.md`).
 */

const debt = (over: Partial<Debt> = {}) => ({
  id: 'd1', personName: 'أحمد', direction: 'i_owe', isInstallment: false, totalAmount: 1000,
  date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z',
  initialTransactionId: 'tx_init', initialWalletId: 'w1',
  payments: [
    { id: 'p1', date: '2026-02-01', amount: 200, walletId: 'w1', transactionId: 'tx_p1', categoryId: 'c1' },
    { id: 'p2', date: '2026-03-01', amount: 300, walletId: 'w1', transactionId: 'tx_p2' },
  ],
  increases: [{ id: 'i1', date: '2026-02-15', amount: 100, walletId: 'w1', transactionId: 'tx_i1' }],
  ...over,
}) as unknown as Debt;

const next = (over: Record<string, unknown> = {}) => ({ amount: 250, walletId: 'w2', date: '2026-04-01', ...over });

describe('debtLinkedEditPlan — أصل الدين', () => {
  it('المبلغ والمحفظة والتاريخ بيتنقلوا للدين', () => {
    const plan = debtLinkedEditPlan(debt(), 'tx_init', next({ amount: 1200 }))!;
    expect(plan.role).toBe('initial');
    expect(plan.patch).toMatchObject({ totalAmount: 1200, initialWalletId: 'w2', date: '2026-04-01' });
    expect(plan.debtAfter.totalAmount).toBe(1200);
  });
});

describe('debtLinkedEditPlan — دفعة', () => {
  it('الدفعة نفسها بس هي اللي بتتغيّر، والباقي زي ما هو', () => {
    const plan = debtLinkedEditPlan(debt(), 'tx_p2', next())!;
    expect(plan.role).toBe('payment');
    const payments = plan.patch.payments as Debt['payments'];
    expect(payments[0]).toEqual(debt().payments[0]);
    expect(payments[1]).toEqual({ id: 'p2', date: '2026-04-01', amount: 250, walletId: 'w2', transactionId: 'tx_p2' });
  });

  it('عليك له: الفئة بتتنقل، ومن غير فئة بتتشال', () => {
    const withCat = debtLinkedEditPlan(debt(), 'tx_p1', next({ categoryId: 'c9' }))!;
    expect((withCat.patch.payments as Debt['payments'])[0].categoryId).toBe('c9');
    const noCat = debtLinkedEditPlan(debt(), 'tx_p1', next())!;
    expect('categoryId' in (noCat.patch.payments as Debt['payments'])[0]).toBe(false);
  });

  it('له عندك: مفيش فئة على الدفعة حتى لو اتبعتت', () => {
    const plan = debtLinkedEditPlan(debt({ direction: 'owed_to_me' }), 'tx_p2', next({ categoryId: 'c9' }))!;
    expect('categoryId' in (plan.patch.payments as Debt['payments'])[1]).toBe(false);
  });
});

describe('debtLinkedEditPlan — زيادة', () => {
  it('الزيادة بتتغيّر بمبلغها ومحفظتها وتاريخها', () => {
    const plan = debtLinkedEditPlan(debt(), 'tx_i1', next({ amount: 400 }))!;
    expect(plan.role).toBe('increase');
    expect(plan.patch.increases).toEqual([{ id: 'i1', date: '2026-04-01', amount: 400, walletId: 'w2', transactionId: 'tx_i1' }]);
  });
});

describe('debtLinkedEditPlan — الأقساط', () => {
  const inst = (over: Partial<Debt> = {}) => debt({
    isInstallment: true, totalAmount: 6000, installmentCount: 6, installmentAmount: 1000, increases: [],
    payments: [{ id: 'p1', date: '2026-02-01', amount: 1000, walletId: 'w1', transactionId: 'tx_p1' }],
    ...over,
  });

  it('دفعة اتعدّلت لأقل ← العدد بيزيد، والقسط ثابت', () => {
    // 6000 − 500 = 5500 باقي ← 6 أقساط باقية + دفعة = 7
    const plan = debtLinkedEditPlan(inst(), 'tx_p1', next({ amount: 500 }))!;
    expect(plan.patch.installmentCount).toBe(7);
    expect(plan.patch.installmentAmount).toBeUndefined();
    expect(plan.countBefore).toBe(6);
    expect(plan.countAfter).toBe(7);
  });

  it('العدد ما اتغيّرش ← مفيش installmentCount في الـpatch', () => {
    const plan = debtLinkedEditPlan(inst(), 'tx_p1', next({ amount: 1000 }))!;
    expect('installmentCount' in plan.patch).toBe(false);
  });

  it('دين قديم من غير قيمة متخزّنة ← القيمة بتتثبّت بالإجمالي القديم قبل ما الأصل يتغيّر', () => {
    const plan = debtLinkedEditPlan(inst({ installmentAmount: undefined }), 'tx_init', next({ amount: 9000 }))!;
    // 6000 ÷ 6 = 1000، مش 9000 ÷ 6
    expect(plan.patch.installmentAmount).toBe(1000);
    // 9000 − 1000 = 8000 باقي ← 8 + دفعة = 9
    expect(plan.patch.installmentCount).toBe(9);
  });
});

describe('debtLinkedEditPlan — الدفع الزيادة', () => {
  it('التعديل خلّى المدفوع أكتر من الدين ← excessAfter بالفرق', () => {
    // 1000 + 100 = 1100، والمدفوع 200 + 1500
    const plan = debtLinkedEditPlan(debt(), 'tx_p2', next({ amount: 1500 }))!;
    expect(plan.excessBefore).toBe(0);
    expect(plan.excessAfter).toBe(600);
  });

  it('أصل الدين نزل تحت المدفوع ← برضه زيادة', () => {
    const plan = debtLinkedEditPlan(debt(), 'tx_init', next({ amount: 300 }))!;
    // 300 + 100 = 400، والمدفوع 500
    expect(plan.excessAfter).toBe(100);
  });
});

describe('debtLinkedEditPlan — المعاد', () => {
  // دين أقساط متسدد: 3000 على 3، اتدفع كله، المعاد فاضل على آخر قسط
  const settled = () => debt({
    isInstallment: true, totalAmount: 3000, installmentCount: 3, installmentAmount: 1000, dueDate: '2026-03-01', increases: [],
    payments: [
      { id: 'p1', date: '2026-01-01', amount: 1000, walletId: 'w1', transactionId: 'tx_p1' },
      { id: 'p2', date: '2026-02-01', amount: 1000, walletId: 'w1', transactionId: 'tx_p2' },
      { id: 'p3', date: '2026-03-01', amount: 1000, walletId: 'w1', transactionId: 'tx_p3' },
    ],
  });

  it('التعديل فتح دين كان متسدد ← المعاد بيتقدّم زي الزيادة', () => {
    const plan = debtLinkedEditPlan(settled(), 'tx_p3', next({ amount: 500, date: '2026-03-01' }), '2026-05-10')!;
    // أول معاد شهري بعد 2026-03-01 ومش قبل النهارده (2026-05-10)
    expect(plan.patch.dueDate).toBe('2026-06-01');
  });

  it('كان مدفوع بزيادة واتفتح ← المعاد برضه بيتقدّم', () => {
    // 3000 والمدفوع 3200 (−200)، الدفعة الأخيرة 1200 ← 800 = المتبقي +200
    const over = settled();
    over.payments[2] = { ...over.payments[2], amount: 1200 };
    const plan = debtLinkedEditPlan(over, 'tx_p3', next({ amount: 800, date: '2026-03-01' }), '2026-05-10')!;
    expect(plan.patch.dueDate).toBe('2026-06-01');
  });

  it('كان مدفوع بزيادة وفضل مقفول بعد التعديل ← المعاد زي ما هو', () => {
    const over = settled();
    over.payments[2] = { ...over.payments[2], amount: 1200 };
    const plan = debtLinkedEditPlan(over, 'tx_p3', next({ amount: 1100, date: '2026-03-01' }), '2026-05-10')!;
    expect('dueDate' in plan.patch).toBe(false);
  });

  it('الدين كان مفتوح أصلاً ← المعاد زي ما هو', () => {
    const plan = debtLinkedEditPlan(settled(), 'tx_p3', next({ amount: 1000 }), '2026-05-10')!;
    expect('dueDate' in plan.patch).toBe(false);
  });
});

it('عملية مش مربوطة بالدين ده ← null', () => {
  expect(debtLinkedEditPlan(debt(), 'tx_other', next())).toBeNull();
});

describe('installmentEditMessage', () => {
  it('العدد اتغيّر ← جملة بالقديم والجديد', () => {
    expect(installmentEditMessage(6, 7)).toBe('بعد التعديل، الأقساط بقت 7 بدل 6.');
  });
  it('ما اتغيّرش، أو القديم مش معروف ← null', () => {
    expect(installmentEditMessage(6, 6)).toBeNull();
    expect(installmentEditMessage(undefined, 7)).toBeNull();
    expect(installmentEditMessage(0, 7)).toBeNull();
  });
});

describe('transactionLinkKind', () => {
  const sources = {
    debts: [debt()],
    subscriptions: [{ id: 's', history: [{ id: 'h', date: '2026-01-01', amount: 50, transactionId: 'tx_sub' }] }] as unknown as Subscription[],
    gamiyas: [{ id: 'g', months: [{ id: 'm', transactionId: 'tx_gam' }] }] as unknown as Gamiya[],
    incomes: [{ id: 'inc', closed: { '2026-01': { txId: 'tx_inc', at: 'x' } } }] as unknown as RecurringIncome[],
  };
  it.each([
    ['tx_init', 'debt'], ['tx_p1', 'debt'], ['tx_i1', 'debt'],
    ['tx_sub', 'subscription'], ['tx_gam', 'gamiya'], ['tx_inc', 'income'], ['tx_free', null],
  ])('%s ← %s', (id, kind) => {
    expect(transactionLinkKind(id, sources)).toBe(kind);
  });
});

describe('storableAmount — التقريب الأول وبعدين الفحص (R1)', () => {
  it.each([1e307, 1e308, Infinity, -Infinity, NaN, 0, -5, 0.004])('%s ← null', v => {
    expect(storableAmount(v)).toBeNull();
  });
  it.each([[0.01, 0.01], [100, 100], [250.5, 250.5], [1.005, 1], [100.125, 100.13]])('%s ← %s', (v, out) => {
    expect(storableAmount(v)).toBe(out);
  });
});
