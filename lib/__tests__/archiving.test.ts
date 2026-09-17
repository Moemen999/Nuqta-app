import type { Debt, Gamiya, Subscription, Transaction } from '@/context/DataContext';
import {
  categoryArchiveBlock,
  categoryDeleteConsequences,
  categoryHasHistory,
  categoryReferences,
  debtsPhrase,
  joinParts,
  roundedWalletBalance,
  transactionsPhrase,
  walletArchiveBlock,
  walletDeleteConsequences,
  walletHasHistory,
  walletHistoryPhrase,
  walletReferences,
} from '@/lib/archiving';

/**
 * حذف المحفظة كان `deleteDoc` واحدة من غير أي فحص، فالمحفظة بتتمسح ومئة عملية
 * بتفضل مربوطة بمعرّف مش موجود. الأعداد اللي هنا هي اللي بتخلي المستخدم يشوف
 * التمن بالأرقام قبل ما يدفعه — فلازم تبقى صح.
 */

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'expense', amount: 100, walletId: 'w1', date: '2026-03-10',
    ...p,
  } as Transaction;
}

function debt(p: Partial<Debt>): Debt {
  return {
    id: Math.random().toString(36).slice(2),
    direction: 'i_owe', personName: 'أحمد', totalAmount: 100, date: '2026-03-01',
    isInstallment: false, createdAt: '2026-03-01T00:00:00.000Z',
    payments: [], increases: [],
    ...p,
  } as Debt;
}

function sub(p: Partial<Subscription>): Subscription {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'نتفليكس', amount: 100, walletId: 'w1', frequency: 'monthly',
    nextDueDate: '2026-04-01', reminderDaysBefore: 2, active: true, history: [],
    createdAt: '2026-03-01T00:00:00.000Z',
    ...p,
  } as Subscription;
}

function gamiya(p: Partial<Gamiya>): Gamiya {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'جمعية الشغل', monthlyAmount: 500, totalMonths: 2, payoutMonthIndex: 1,
    payoutAmount: 1000, walletId: 'w1', startDate: '2026-03-01', reminderDaysBefore: 2,
    months: [], createdAt: '2026-03-01T00:00:00.000Z',
    ...p,
  } as Gamiya;
}

const EMPTY = { transactions: [], debts: [], subscriptions: [], gamiyas: [] };

describe('walletReferences', () => {
  it('محفظة مالهاش أي أثر', () => {
    const refs = walletReferences('w1', EMPTY);
    expect(refs.transactions).toBe(0);
    expect(walletHasHistory(refs)).toBe(false);
  });

  it('بتعدّ العمليات من الطرفين — السحب بيلمس محفظتين', () => {
    const refs = walletReferences('w2', {
      ...EMPTY,
      transactions: [
        tx({ walletId: 'w1' }),
        tx({ walletId: 'w2' }),
        tx({ type: 'withdraw', walletId: 'w1', toWalletId: 'w2' }),
      ],
    });
    expect(refs.transactions).toBe(2);
  });

  it('السحب بين نفس المحفظتين مبيتعدّش مرتين', () => {
    const refs = walletReferences('w1', {
      ...EMPTY,
      transactions: [tx({ type: 'withdraw', walletId: 'w1', toWalletId: 'w1' })],
    });
    expect(refs.transactions).toBe(1);
  });

  it('الديون: المبلغ الأساسي والدفعة والزيادة كلهم بيعدّوا', () => {
    const refs = walletReferences('w1', {
      ...EMPTY,
      debts: [
        debt({ initialWalletId: 'w1' }),
        debt({ payments: [{ id: 'p1', date: '2026-03-05', amount: 50, walletId: 'w1' }] }),
        debt({ increases: [{ id: 'e1', date: '2026-03-06', amount: 20, walletId: 'w1' }] }),
        debt({ initialWalletId: 'w2' }),
      ],
    });
    expect(refs.debts).toBe(3);
  });

  it('الدين بيتعدّ مرة واحدة حتى لو لمس المحفظة من كذا ناحية', () => {
    const refs = walletReferences('w1', {
      ...EMPTY,
      debts: [debt({
        initialWalletId: 'w1',
        payments: [{ id: 'p1', date: '2026-03-05', amount: 50, walletId: 'w1' }],
        increases: [{ id: 'e1', date: '2026-03-06', amount: 20, walletId: 'w1' }],
      })],
    });
    expect(refs.debts).toBe(1);
  });

  it('بتفرّق بين الاشتراك الشغّال والواقف', () => {
    const refs = walletReferences('w1', {
      ...EMPTY,
      subscriptions: [
        sub({ name: 'نتفليكس', active: true }),
        sub({ name: 'سبوتيفاي', active: false }),
      ],
    });
    expect(refs.activeSubscriptions.map(s => s.name)).toEqual(['نتفليكس']);
    expect(refs.inactiveSubscriptions).toBe(1);
  });

  it('الاشتراك القديم اللي مالوش حقل active بيتحسب شغّال', () => {
    const s = sub({ name: 'قديم' });
    delete (s as any).active;
    const refs = walletReferences('w1', { ...EMPTY, subscriptions: [s] });
    expect(refs.activeSubscriptions.map(x => x.name)).toEqual(['قديم']);
  });

  it('الجمعية شغّالة طول ما فيها شهر ما اتسددش', () => {
    const pending = gamiya({
      name: 'شغالة',
      months: [{ id: 'm1', monthIndex: 1, dueDate: '2026-03-01', isPayoutMonth: false, amount: 500, status: 'done' },
               { id: 'm2', monthIndex: 2, dueDate: '2026-04-01', isPayoutMonth: true, amount: 1000, status: 'pending' }],
    });
    const finished = gamiya({
      name: 'خلصت',
      months: [{ id: 'm1', monthIndex: 1, dueDate: '2026-03-01', isPayoutMonth: false, amount: 500, status: 'done' }],
    });
    const refs = walletReferences('w1', { ...EMPTY, gamiyas: [pending, finished] });
    expect(refs.activeGamiyas.map(g => g.name)).toEqual(['شغالة']);
    expect(refs.inactiveGamiyas).toBe(1);
  });

  it('اشتراك واقف لوحده لسه بيعتبر تاريخ — يعني أرشفة مش حذف', () => {
    const refs = walletReferences('w1', { ...EMPTY, subscriptions: [sub({ active: false })] });
    expect(walletHasHistory(refs)).toBe(true);
  });
});

describe('categoryReferences', () => {
  const base = { transactions: [], subscriptions: [], debts: [], budgets: {} as Record<string, number> };

  it('فئة مالهاش أي أثر', () => {
    expect(categoryHasHistory(categoryReferences('c1', base))).toBe(false);
  });

  it('بتعدّ العمليات ودفعات الديون', () => {
    const refs = categoryReferences('c1', {
      ...base,
      transactions: [tx({ categoryId: 'c1' }), tx({ categoryId: 'c2' })],
      debts: [debt({
        payments: [
          { id: 'p1', date: '2026-03-05', amount: 50, walletId: 'w1', categoryId: 'c1' },
          { id: 'p2', date: '2026-03-06', amount: 50, walletId: 'w1', categoryId: 'c2' },
        ],
      })],
    });
    expect(refs.transactions).toBe(1);
    expect(refs.debtPayments).toBe(1);
  });

  it('بتشوف الميزانية حتى لو صفر — الصفر سقف محفوظ مش غياب سقف', () => {
    expect(categoryReferences('c1', { ...base, budgets: { c1: 0 } }).hasBudget).toBe(true);
    expect(categoryReferences('c1', { ...base, budgets: {} }).hasBudget).toBe(false);
  });

  it('ميزانية لوحدها مش تاريخ — الفئة تتمسح والميزانية تتمسح معاها', () => {
    const refs = categoryReferences('c1', { ...base, budgets: { c1: 500 } });
    expect(categoryHasHistory(refs)).toBe(false);
    expect(refs.hasBudget).toBe(true);
  });
});

describe('walletArchiveBlock', () => {
  const noRefs = walletReferences('w1', EMPTY);
  const withSub = walletReferences('w1', { ...EMPTY, subscriptions: [sub({})] });

  it('ماشي', () => {
    expect(walletArchiveBlock({
      walletId: 'w1', balance: 0, refs: noRefs, activeWalletCount: 2, otherActiveWalletCount: 1,
    })).toBeNull();
  });

  it('آخر محفظة شغالة مبتتأرشفش', () => {
    expect(walletArchiveBlock({
      walletId: 'w1', balance: 0, refs: noRefs, activeWalletCount: 1, otherActiveWalletCount: 0,
    })).toEqual({ kind: 'last-active' });
  });

  it('رصيد مش صفر بيمنع', () => {
    expect(walletArchiveBlock({
      walletId: 'w1', balance: 250, refs: noRefs, activeWalletCount: 2, otherActiveWalletCount: 1,
    })).toEqual({ kind: 'balance', balance: 250 });
  });

  it('الرصيد السالب بيمنع كمان — الشرط صفر مش "أكبر من صفر"', () => {
    expect(walletArchiveBlock({
      walletId: 'w1', balance: -250, refs: noRefs, activeWalletCount: 2, otherActiveWalletCount: 1,
    })).toEqual({ kind: 'balance', balance: -250 });
  });

  it('كسر تايه من جمع الفواصل العشرية مبيمنعش', () => {
    expect(walletArchiveBlock({
      walletId: 'w1', balance: 0.0000000001, refs: noRefs, activeWalletCount: 2, otherActiveWalletCount: 1,
    })).toBeNull();
  });

  it('قرش واحد بيمنع — ده رصيد حقيقي', () => {
    expect(walletArchiveBlock({
      walletId: 'w1', balance: 0.01, refs: noRefs, activeWalletCount: 2, otherActiveWalletCount: 1,
    })).toEqual({ kind: 'balance', balance: 0.01 });
  });

  it('اشتراك شغّال من غير محفظة تانية ننقله لها بيمنع', () => {
    expect(walletArchiveBlock({
      walletId: 'w1', balance: 0, refs: withSub, activeWalletCount: 2, otherActiveWalletCount: 0,
    })).toEqual({ kind: 'no-target' });
  });

  it('اشتراك شغّال ومعاه محفظة تانية: ماشي (النقل بيحصل في الشيت)', () => {
    expect(walletArchiveBlock({
      walletId: 'w1', balance: 0, refs: withSub, activeWalletCount: 2, otherActiveWalletCount: 1,
    })).toBeNull();
  });

  it('آخر محفظة بتسبق الرصيد في الترتيب — أوضح سبب للمستخدم', () => {
    expect(walletArchiveBlock({
      walletId: 'w1', balance: 999, refs: noRefs, activeWalletCount: 1, otherActiveWalletCount: 0,
    })).toEqual({ kind: 'last-active' });
  });
});

describe('categoryArchiveBlock', () => {
  const base = { transactions: [], subscriptions: [], debts: [], budgets: {} };
  const noRefs = categoryReferences('c1', base);
  const withSub = categoryReferences('c1', { ...base, subscriptions: [sub({ categoryId: 'c1' })] });

  it('ماشي', () => {
    expect(categoryArchiveBlock({ refs: noRefs, activeCategoryCount: 2, otherActiveCategoryCount: 1 }))
      .toBeNull();
  });

  it('آخر فئة شغالة مبتتأرشفش', () => {
    expect(categoryArchiveBlock({ refs: noRefs, activeCategoryCount: 1, otherActiveCategoryCount: 0 }))
      .toEqual({ kind: 'last-active' });
  });

  it('اشتراك شغّال من غير فئة تانية ننقله لها بيمنع', () => {
    expect(categoryArchiveBlock({ refs: withSub, activeCategoryCount: 2, otherActiveCategoryCount: 0 }))
      .toEqual({ kind: 'no-target' });
  });

  it('مفيش شرط رصيد على الفئة — الفئة مالهاش رصيد أصلاً', () => {
    const used = categoryReferences('c1', { ...base, transactions: [tx({ categoryId: 'c1' })] });
    expect(categoryArchiveBlock({ refs: used, activeCategoryCount: 3, otherActiveCategoryCount: 2 }))
      .toBeNull();
  });
});

describe('صيغة الأعداد بالعربي', () => {
  it('العملية بتتصرّف مع العدد', () => {
    expect(transactionsPhrase(1)).toBe('عملية واحدة');
    expect(transactionsPhrase(2)).toBe('عمليتين');
    expect(transactionsPhrase(5)).toBe('5 عمليات');
    expect(transactionsPhrase(30)).toBe('30 عملية');
  });

  it('الدين كمان', () => {
    expect(debtsPhrase(1)).toBe('دين واحد');
    expect(debtsPhrase(2)).toBe('دينين');
    expect(debtsPhrase(4)).toBe('4 ديون');
    expect(debtsPhrase(15)).toBe('15 دين');
  });

  it('الأجزاء الصفر بتتشال خالص — مفيش "و0 دين"', () => {
    const refs = walletReferences('w1', { ...EMPTY, transactions: [tx({ walletId: 'w1' })] });
    expect(walletHistoryPhrase(refs)).toBe('عملية واحدة');
    expect(walletHistoryPhrase(refs)).not.toContain('0');
  });

  it('الجزئين مع بعض بيتوصلوا بـ"و"', () => {
    const refs = walletReferences('w1', {
      ...EMPTY,
      transactions: [tx({ walletId: 'w1' }), tx({ walletId: 'w1' })],
      debts: [debt({ initialWalletId: 'w1' })],
    });
    expect(walletHistoryPhrase(refs)).toBe('عمليتين ودين واحد');
  });

  it('joinParts بتتجاهل الفاضي', () => {
    expect(joinParts(['أ', '', 'ب'])).toBe('أ وب');
    expect(joinParts(['', ''])).toBe('');
  });
});

describe('سطور "هيحصل إيه لو مسحتها نهائي"', () => {
  it('السطر اللي مالوش رقم مبيتكتبش', () => {
    const refs = walletReferences('w1', EMPTY);
    expect(walletDeleteConsequences({ balance: 0, refs })).toEqual([]);
  });

  it('بتقول الرصيد والعمليات والديون والأسماء', () => {
    const refs = walletReferences('w1', {
      transactions: [tx({ walletId: 'w1' })],
      debts: [debt({ initialWalletId: 'w1' })],
      subscriptions: [sub({ name: 'نتفليكس' })],
      gamiyas: [gamiya({
        name: 'جمعية الشغل',
        months: [{ id: 'm1', monthIndex: 1, dueDate: '2026-04-01', isPayoutMonth: false, amount: 500, status: 'pending' }],
      })],
    });
    const lines = walletDeleteConsequences({ balance: 1500, refs });
    expect(lines).toEqual([
      'رصيدها 1,500 ج.م هيختفي من الإجمالي.',
      'عملية واحدة هتفضل من غير محفظة.',
      'دين واحد مربوط بيها.',
      'الاشتراكات دي هتقف لحد ما تختارلها محفظة: نتفليكس.',
      'الجمعيات دي هتقف لحد ما تختارلها محفظة: جمعية الشغل.',
    ]);
  });

  it('الرصيد السالب بيتكتب زي ما هو', () => {
    const refs = walletReferences('w1', EMPTY);
    expect(walletDeleteConsequences({ balance: -300, refs })[0])
      .toBe('رصيدها -300 ج.م هيختفي من الإجمالي.');
  });

  it('الفئة: العمليات والاشتراكات والميزانية', () => {
    const refs = categoryReferences('c1', {
      transactions: [tx({ categoryId: 'c1' }), tx({ categoryId: 'c1' })],
      subscriptions: [sub({ name: 'نتفليكس', categoryId: 'c1' })],
      debts: [],
      budgets: { c1: 500 },
    });
    expect(categoryDeleteConsequences(refs)).toEqual([
      'عمليتين هتفضل من غير فئة.',
      'الاشتراكات دي هتقف لحد ما تختارلها فئة: نتفليكس.',
      'ميزانيتها الشهرية هتتمسح.',
    ]);
  });

  it('الفئة من غير ميزانية مبتقولش إن فيه ميزانية هتتمسح', () => {
    const refs = categoryReferences('c1', {
      transactions: [], subscriptions: [], debts: [], budgets: {},
    });
    expect(categoryDeleteConsequences(refs)).toEqual([]);
  });
});

describe('roundedWalletBalance', () => {
  it('بيقرّب لخانتين زي ما المستخدم شايف', () => {
    const txs = [tx({ type: 'income', amount: 0.1, walletId: 'w1' }), tx({ type: 'income', amount: 0.2, walletId: 'w1' })];
    expect(roundedWalletBalance(txs, 'w1', 0)).toBe(0.3);
  });

  it('الرصيد الابتدائي داخل في الحسبة', () => {
    expect(roundedWalletBalance([tx({ walletId: 'w1', amount: 100 })], 'w1', 250)).toBe(150);
  });
});
