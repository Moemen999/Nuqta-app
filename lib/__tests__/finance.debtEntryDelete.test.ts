import { DEBT_ENTRY_DELETE_ALERT, type Debt } from '@/context/DataContext';
import { debtEntryArchivedWalletBlock, debtEntryDeleteMessage, debtEntryDeletePlan, installmentCountFor } from '@/lib/finance';

/**
 * مسح دفعة أو زيادة من تاريخ الدين. `deleteDebtPayment`/`deleteDebtIncrease`
 * كانوا موجودين من غير ولا زرار — التأكيد لازم يقول **قبل** الدوسة إيه اللي
 * هيحصل: المبلغ، الشخص، العدد لو هيتحرك، والفلوس رايحة فين.
 *
 * "الفلوس بترجع للمحفظة" مش صح دايمًا: دفعة من حد مديون ليك كانت **دخل**،
 * فمسحها بيشيل الفلوس من المحفظة مش بيرجّعها. الاتجاه بيتحسب من نوع
 * العملية المالية اللي هتتمسح.
 */

function debt(over: Partial<Debt> = {}): Debt {
  return {
    id: 'd1', direction: 'i_owe', personName: 'أحمد', totalAmount: 6000,
    date: '2026-01-01', isInstallment: false,
    createdAt: '2026-01-01T00:00:00.000Z', payments: [], increases: [],
    ...over,
  } as Debt;
}

const pay = { id: 'p1', date: '2026-02-01', amount: 500, walletId: 'w1', transactionId: 't1' };
const inc = { id: 'i1', date: '2026-02-05', amount: 300, walletId: 'w1', transactionId: 't2' };
const money = (n: number) => n.toLocaleString('en-US');

describe('debtEntryDeletePlan — الفلوس رايحة فين', () => {
  it('دفعة لحد انت مديون له (كانت مصروف) ← الفلوس بترجع للمحفظة', () => {
    const p = debtEntryDeletePlan(debt({ direction: 'i_owe', payments: [pay] }), 'payment', 'p1');
    expect(p).toMatchObject({ amount: 500, walletId: 'w1', walletEffect: 'returns' });
  });

  it('دفعة من حد مديون ليك (كانت دخل) ← الفلوس بتتشال من المحفظة', () => {
    const p = debtEntryDeletePlan(debt({ direction: 'owed_to_me', payments: [pay] }), 'payment', 'p1');
    expect(p).toMatchObject({ walletEffect: 'leaves' });
  });

  it('زيادة على قرض انت مدّيه (كانت مصروف) ← بترجع', () => {
    const p = debtEntryDeletePlan(debt({ direction: 'owed_to_me', increases: [inc] }), 'increase', 'i1');
    expect(p).toMatchObject({ amount: 300, walletEffect: 'returns' });
  });

  it('زيادة على استلاف انت واخده (كانت دخل) ← بتتشال', () => {
    const p = debtEntryDeletePlan(debt({ direction: 'i_owe', increases: [inc] }), 'increase', 'i1');
    expect(p).toMatchObject({ walletEffect: 'leaves' });
  });

  it('زيادة من غير محفظة (تسجيل على الورق) ← مفيش محفظة هتتأثر', () => {
    const paper = { id: 'i2', date: '2026-02-01', amount: 200 };
    const p = debtEntryDeletePlan(debt({ increases: [paper] }), 'increase', 'i2');
    expect(p).toMatchObject({ walletEffect: null, walletId: null });
  });

  it('محفظة من غير transactionId مش بتتحسب — المسح مش هيلمس أي رصيد', () => {
    const odd = { id: 'p3', date: '2026-02-01', amount: 200, walletId: 'w1' };
    expect(debtEntryDeletePlan(debt({ payments: [odd] }), 'payment', 'p3')).toMatchObject({ walletEffect: null });
  });

  it('سجل مش موجود ← null (اتمسح من جهاز تاني)', () => {
    expect(debtEntryDeletePlan(debt({ payments: [pay] }), 'payment', 'nope')).toBeNull();
    expect(debtEntryDeletePlan(debt({ payments: [pay] }), 'increase', 'p1')).toBeNull();
  });
});

describe('debtEntryDeletePlan — عدد الأقساط', () => {
  // قسط 1000 على 6000، دفع 500 بدل 1000 فالعدد بقى 7
  const inst = debt({ isInstallment: true, installmentAmount: 1000, installmentCount: 7, payments: [pay] });

  it('العدد اللي اتحرك مع الدفعة بيرجع معاها', () => {
    const p = debtEntryDeletePlan(inst, 'payment', 'p1');
    expect(p).toMatchObject({ countBefore: 7, countAfter: 6 });
  });

  it('نفس الحساب اللي deleteDebtPayment بيعمله جوه الذرة', () => {
    const p = debtEntryDeletePlan(inst, 'payment', 'p1')!;
    expect(p.countAfter).toBe(installmentCountFor({ ...inst, payments: [] }));
  });

  it('لو العدد مش هيتغيّر ← مفيش سطر أقساط', () => {
    const exact = debt({ isInstallment: true, installmentAmount: 1000, installmentCount: 6, payments: [{ ...pay, amount: 1000 }] });
    expect(debtEntryDeletePlan(exact, 'payment', 'p1')).toMatchObject({ countBefore: null, countAfter: null });
  });

  it('دين مش أقساط ← مفيش عدد', () => {
    expect(debtEntryDeletePlan(debt({ payments: [pay] }), 'payment', 'p1')).toMatchObject({ countBefore: null, countAfter: null });
  });
});

describe('debtEntryDeleteMessage — التأكيد بيقول كل حاجة', () => {
  it('دفعة لحد: المبلغ والشخص والمحفظة والرجوع', () => {
    const d = debt({ direction: 'i_owe', payments: [pay] });
    const m = debtEntryDeleteMessage(d, 'payment', debtEntryDeletePlan(d, 'payment', 'p1')!, 'الكاش', money);
    expect(m.title).toBe('تمسح الدفعة دي؟');
    expect(m.body).toContain('دفعة 500 ج.م لـ أحمد هتتمسح.');
    expect(m.body).toContain('الـ 500 ج.م هترجع لمحفظة "الكاش".');
  });

  it('دفعة من حد: الفلوس بتتشال من المحفظة', () => {
    const d = debt({ direction: 'owed_to_me', payments: [pay] });
    const m = debtEntryDeleteMessage(d, 'payment', debtEntryDeletePlan(d, 'payment', 'p1')!, 'الكاش', money);
    expect(m.body).toContain('دفعة 500 ج.م من أحمد هتتمسح.');
    expect(m.body).toContain('الـ 500 ج.م هتتشال من محفظة "الكاش".');
  });

  it('زيادة: بتسمّي الدين', () => {
    const d = debt({ direction: 'owed_to_me', increases: [inc] });
    const m = debtEntryDeleteMessage(d, 'increase', debtEntryDeletePlan(d, 'increase', 'i1')!, 'البنك', money);
    expect(m.title).toBe('تمسح الزيادة دي؟');
    expect(m.body).toContain('زيادة 300 ج.م على دين أحمد هتتمسح.');
    expect(m.body).toContain('هترجع لمحفظة "البنك"');
  });

  it('العدد لو هيتحرك بيتقال', () => {
    const d = debt({ isInstallment: true, installmentAmount: 1000, installmentCount: 7, payments: [pay] });
    const m = debtEntryDeleteMessage(d, 'payment', debtEntryDeletePlan(d, 'payment', 'p1')!, 'الكاش', money);
    expect(m.body).toContain('عدد الأقساط هيرجع 6 بدل 7.');
  });

  it('من غير محفظة: بيقول صراحة إن مفيش رصيد هيتغيّر', () => {
    const paper = { id: 'i2', date: '2026-02-01', amount: 200 };
    const d = debt({ increases: [paper] });
    const m = debtEntryDeleteMessage(d, 'increase', debtEntryDeletePlan(d, 'increase', 'i2')!, '', money);
    expect(m.body).toContain('مكانتش مربوطة بمحفظة، فمفيش رصيد هيتغيّر.');
    expect(m.body).not.toContain('محفظة "');
  });

  it('المبلغ بيعدّي من دالة التنسيق اللي الشاشة بتبعتها', () => {
    const d = debt({ payments: [pay] });
    const m = debtEntryDeleteMessage(d, 'payment', debtEntryDeletePlan(d, 'payment', 'p1')!, 'الكاش', () => 'X');
    expect(m.body).not.toContain('500');
    expect(m.body).toContain('X ج.م');
  });
});

describe('DEBT_ENTRY_DELETE_ALERT — الفشل بيقول إن مفيش حاجة اتمسحت', () => {
  it.each(['no-connection', 'failed', 'wallet-missing'] as const)('%s', k => {
    const a = DEBT_ENTRY_DELETE_ALERT[k];
    expect(a.body).toMatch(/ما اتمسحش حاجة|لسه زي ما هو/);
    // مفيش كلام عن "خصم" — ده مسح مش دفع
    expect(a.body).not.toContain('خصم');
  });
});

describe('debtEntryArchivedWalletBlock — المحفظة المؤرشفة', () => {
  const d = debt({ payments: [pay] });
  const plan = debtEntryDeletePlan(d, 'payment', 'p1')!;

  it('محفظة مؤرشفة ← المسح بيتمنع وبيقول الطريق', () => {
    const b = debtEntryArchivedWalletBlock('payment', plan, [{ id: 'w1', name: 'الكاش', archived: true }]);
    expect(b?.title).toBe('المحفظة دي مؤرشفة');
    expect(b?.body).toContain('الدفعة دي مربوطة بمحفظة "الكاش"');
    expect(b?.body).toContain('رجّع المحفظة الأول');
  });

  it('محفظة شغالة ← مفيش منع', () => {
    expect(debtEntryArchivedWalletBlock('payment', plan, [{ id: 'w1', name: 'الكاش' }])).toBeNull();
  });

  it('محفظة ممسوحة ← مفيش منع (ملهاش رصيد يتحسب)', () => {
    expect(debtEntryArchivedWalletBlock('payment', plan, [])).toBeNull();
  });

  it('زيادة على الورق ← مفيش محفظة أصلاً', () => {
    const paper = debt({ increases: [{ id: 'i2', date: '2026-02-01', amount: 200 }] });
    const p = debtEntryDeletePlan(paper, 'increase', 'i2')!;
    expect(debtEntryArchivedWalletBlock('increase', p, [{ id: 'w1', name: 'الكاش', archived: true }])).toBeNull();
  });
});

describe('العدد المتخزّن ناقص', () => {
  it('بيقارن بالمحسوب بدل ما يسكت', () => {
    const d = debt({ isInstallment: true, installmentAmount: 1000, installmentCount: undefined, payments: [pay] });
    const p = debtEntryDeletePlan(d, 'payment', 'p1')!;
    expect(p.countBefore).toBe(7);
    expect(p.countAfter).toBe(6);
  });
});

describe('العدد المتخزّن ناقص ودفعة بقيمة القسط بالظبط', () => {
  it('مفيش سطر "هيرجع 6 بدل 6"', () => {
    const d = debt({ isInstallment: true, installmentAmount: 1000, installmentCount: undefined, payments: [{ ...pay, amount: 1000 }] });
    expect(debtEntryDeletePlan(d, 'payment', 'p1')).toMatchObject({ countBefore: null, countAfter: null });
  });
});
