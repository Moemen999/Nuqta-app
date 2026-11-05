import type { Debt, Gamiya } from '@/context/DataContext';
import { monthSpend } from '@/lib/finance';
import { cashTotals, monthSpendTotal, spendingExpenses, transferTransactionIds } from '@/lib/spending';

/**
 * السلفة والجمعية مش مصروف ولا دخل (خطوة 8). بتتعرف من المعرّفات المتخزّنة
 * جوه الدين والجمعية — من غير ما عملية متخزّنة تتغيّر.
 */

const lend = {
  direction: 'owed_to_me', initialTransactionId: 't_lend',
  increases: [{ id: 'i', date: '', amount: 500, transactionId: 't_inc' }],
  payments: [{ id: 'p', date: '', amount: 300, walletId: 'w', transactionId: 't_back' }],
} as unknown as Debt;
const borrow = {
  direction: 'i_owe', initialTransactionId: 't_borrow',
  increases: [], payments: [{ id: 'p2', date: '', amount: 200, walletId: 'w', transactionId: 't_repay' }],
} as unknown as Debt;
const gam = {
  months: [
    { id: 'm1', transactionId: 't_g1' },
    { id: 'm2', transactionId: 't_payout' },
    { id: 'm3' },
  ],
} as unknown as Gamiya;

const tx = (id: string, type: string, amount: number, date = '2026-09-10') => ({ id, type, amount, date });
const ALL = [
  tx('t_lend', 'expense', 2000), tx('t_inc', 'expense', 500), tx('t_back', 'income', 300),
  tx('t_borrow', 'income', 1000), tx('t_repay', 'expense', 200),
  tx('t_g1', 'expense', 1000), tx('t_payout', 'income', 3000),
  tx('food', 'expense', 150), tx('salary', 'income', 8000), tx('move', 'withdraw', 400),
  tx('old', 'expense', 999, '2026-08-31'),
];

describe('transferTransactionIds', () => {
  it('السلفة (أصلها وزيادتها وسدادها) وكل شهور الجمعية، و"عليك له" كمان (قرار مؤمن 2026-11-05)', () => {
    expect([...transferTransactionIds([lend, borrow], [gam])].sort())
      .toEqual(['t_back', 't_borrow', 't_g1', 't_inc', 't_lend', 't_payout', 't_repay']);
  });
  it('"عليك له": الاستلاف وزيادته وسداده — حتى السداد اللي ليه فئة', () => {
    const b2 = { ...borrow, increases: [{ id: 'i2', date: '', amount: 100, transactionId: 't_borrow_more' }],
      payments: [{ id: 'p3', date: '', amount: 50, walletId: 'w', transactionId: 't_repay_cat', categoryId: 'food' }] } as unknown as Debt;
    expect([...transferTransactionIds([b2], [])].sort()).toEqual(['t_borrow', 't_borrow_more', 't_repay_cat']);
  });
  it('من غير ديون ولا جمعيات ← فاضي', () => {
    expect(transferTransactionIds([], []).size).toBe(0);
  });
});

describe('المصروف والدخل', () => {
  const transfers = transferTransactionIds([lend, borrow], [gam]);

  it('spendingExpenses: الأكل أيوه — السلفة والجمعية وسداد "عليك له" لأ', () => {
    expect(spendingExpenses(ALL, transfers).map(t => t.id).sort()).toEqual(['food', 'old']);
  });

  it('monthSpendTotal: مصروف سبتمبر من غير السلفة وقسط الجمعية وسداد "عليك له"', () => {
    // قبل كده: 2000 + 500 + 200 + 1000 + 150 = 3850
    expect(monthSpendTotal(ALL, '2026-09', transfers)).toBe(150);
    expect(monthSpendTotal(ALL, '2026-09', new Set())).toBe(3850);
  });

  it('cashTotals: الدخل من غير السداد واستلام الجمعية والاستلاف، والمصروف من غير السلفة والقسط وسداد "عليك له"', () => {
    expect(cashTotals(ALL, transfers)).toEqual({ income: 8000, expense: 1149, transfers: 7 });
  });

  it('الرصيد مش شغل الدوال دي: التحويل مبيتغيّرش نوعه', () => {
    expect(ALL.find(t => t.id === 't_lend')!.type).toBe('expense');
  });
});

describe('المراجعة: سلفة اتدّت فئة بالتعديل مبتتسرّبش للفئة', () => {
  // المستخدم عدّل عملية السلفة وحطلها فئة "أكل"
  const txs = [
    { id: 't_lend', type: 'expense', amount: 2000, date: '2026-09-10', categoryId: 'food' },
    { id: 'meal', type: 'expense', amount: 150, date: '2026-09-11', categoryId: 'food' },
  ];
  const transfers = transferTransactionIds([lend], []);

  it('monthSpend للفئة من غيرها — ومجموع الفئات = الإجمالي', () => {
    expect(monthSpend(txs as never, 'food', '2026-09', transfers)).toBe(150);
    expect(monthSpendTotal(txs, '2026-09', transfers)).toBe(150);
  });

  it('من غير transfers (زي قبل) بتتحسب — الفرق هو التصليح', () => {
    expect(monthSpend(txs as never, 'food', '2026-09')).toBe(2150);
  });
});
