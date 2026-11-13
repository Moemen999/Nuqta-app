import type { Debt, Gamiya } from '@/context/DataContext';
import { monthSpend } from '@/lib/finance';
import { cashTotals, isCreditPurchase, monthSpendTotal, spendInRange, spendingExpenses, thisMonthRange, transferTransactionIds } from '@/lib/spending';

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

describe('شرا بالأجل (قرار مؤمن 2026-11-05): دين "عليك له" من غير محفظة سداده مصروف', () => {
  const credit = {
    direction: 'i_owe', // مفيش initialTransactionId: حاجة اتاخدت ومادخلش فلوس
    increases: [], payments: [{ id: 'pc', date: '', amount: 400, walletId: 'w', transactionId: 't_credit_pay', categoryId: 'food' }],
  } as unknown as Debt;
  const txs = [tx('t_credit_pay', 'expense', 400), tx('t_repay', 'expense', 200), tx('t_borrow', 'income', 1000)];

  it('السداد مش تحويل — بيتعدّ مصروف؛ والاستلاف من محفظة وسداده لسه تحويل', () => {
    const transfers = transferTransactionIds([credit, borrow], []);
    expect(transfers.has('t_credit_pay')).toBe(false);
    expect(spendingExpenses(txs, transfers).map(t => t.id)).toEqual(['t_credit_pay']);
    expect(isCreditPurchase(credit)).toBe(true);
    expect(isCreditPurchase(borrow)).toBe(false);
    expect(isCreditPurchase({ direction: 'owed_to_me' } as Debt)).toBe(false);
  });
});

describe('spendInRange / thisMonthRange: رقم واحد للتقارير والرئيسية', () => {
  const row = (id: string, type: string, amount: number, date: string, categoryId?: string) => ({ id, type, amount, date, categoryId });
  const none = new Set<string>();

  it('thisMonthRange: أول وآخر يوم في شهر اليوم (فبراير كبيس وغير كبيس)', () => {
    expect(thisMonthRange('2026-11-13')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(thisMonthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(thisMonthRange('2026-02-28')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('المصروف اللي جوه الفترة بس، من غير الدخل والسحب والتحويلات', () => {
    const tx = [
      row('a', 'expense', 100, '2026-11-01'), row('b', 'expense', 50, '2026-11-30'),
      row('c', 'expense', 999, '2026-10-31'), row('d', 'expense', 999, '2026-12-01'),
      row('e', 'income', 777, '2026-11-05'), row('f', 'withdraw', 555, '2026-11-05'),
      row('loan', 'expense', 2000, '2026-11-06'),
    ];
    expect(spendInRange(tx, new Set(['loan']), thisMonthRange('2026-11-13'))).toBe(150);
  });

  it('عملية بتاريخ جاي في نفس الشهر محسوبة (زي الرقم البطل في التقارير)', () => {
    expect(spendInRange([row('x', 'expense', 40, '2026-11-25')], none, thisMonthRange('2026-11-13'))).toBe(40);
  });

  it('فلتر الفئات: نفس دلالة periodExpenseTotal (من غير فئة بيتشال لما فيه فلتر)', () => {
    const tx = [row('a', 'expense', 10, '2026-11-02', 'c1'), row('b', 'expense', 20, '2026-11-03', 'c2'), row('c', 'expense', 40, '2026-11-04')];
    const r = thisMonthRange('2026-11-13');
    expect(spendInRange(tx, none, r)).toBe(70);
    expect(spendInRange(tx, none, r, ['c1'])).toBe(10);
  });

  it('ترتيب الجمع هو ترتيب العمليات: 100.10 + 200.20 + 0.3 زي reduce المباشر', () => {
    const tx = [row('a', 'expense', 100.1, '2026-11-02'), row('b', 'expense', 200.2, '2026-11-03'), row('c', 'expense', 0.3, '2026-11-04')];
    expect(spendInRange(tx, none, thisMonthRange('2026-11-13'))).toBe(100.1 + 200.2 + 0.3);
  });

  it('نفس رقم monthSpendTotal للشهر على عمليات صالحة', () => {
    const tx = [row('a', 'expense', 100, '2026-11-02'), row('b', 'expense', 5, '2026-10-02'), row('loan', 'expense', 2000, '2026-11-06')];
    const t = new Set(['loan']);
    expect(spendInRange(tx, t, thisMonthRange('2026-11-13'))).toBe(monthSpendTotal(tx, '2026-11', t));
  });
});
