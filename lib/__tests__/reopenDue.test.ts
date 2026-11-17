import type { Debt } from '@/context/DataContext';
import { debtEntryDeleteMessage, debtEntryDeletePlan, debtLinkWarning, transactionDeleteDebtPlan } from '@/lib/finance';
import { dueDateAfterIncreaseRemoval, dueDateAfterPaymentRemoval, dueDateLabel, dueRestoreLine, paymentsAfterRemoval, reopenedDueMessage } from '@/lib/reopenDue';

/**
 * بند 12 (قرار مؤمن 2026-11-05): زيادة فتحت دين أقساط متسدد ← رسالة "المعاد الجاي بقى …"، والمعاد القديم
 * بيتخزّن في الزيادة ويرجع لما تتمسح — بس لو المعاد لسه هو اللي هي حطّته والدين رجع متسدد.
 */

// 3000 على 3 اتسدد، وزيادة 500 فتحته وقدّمت المعاد من 03-15 لـ 12-15
const reopened = (over: Partial<Debt> = {}): Debt => ({
  id: 'd1', direction: 'i_owe', personName: 'صاحبي', totalAmount: 3000, isInstallment: true, installmentCount: 4,
  installmentAmount: 1000, date: '2026-01-01', createdAt: 'x', dueDate: '2026-12-15',
  payments: [1, 2, 3].map(i => ({ id: `p${i}`, date: '2026-02-01', amount: 1000, walletId: 'w', transactionId: `tp${i}` })),
  increases: [{ id: 'i1', date: '2026-11-05', amount: 500, walletId: 'w', transactionId: 'ti1', reopenedFrom: '2026-03-15', reopenedTo: '2026-12-15' }],
  ...over,
} as Debt);

describe('dueDateAfterIncreaseRemoval', () => {
  it('الزيادة اللي فتحت الدين اتشالت والمعاد لسه بتاعها ← القديم', () => {
    const d = reopened();
    expect(dueDateAfterIncreaseRemoval(d, d.increases, [])).toBe('2026-03-15');
  });

  it('المعاد اتغيّر بعدها (بإيد المستخدم أو دفعة) ← مبيتلمسش', () => {
    const d = reopened({ dueDate: '2027-01-15' });
    expect(dueDateAfterIncreaseRemoval(d, d.increases, [])).toBeNull();
  });

  it('الدين لسه فيه باقي بعد المسح (زيادة تانية) ← المعاد الجديد هو الصح', () => {
    const d = reopened();
    const other = { id: 'i2', date: '2026-11-06', amount: 200 };
    expect(dueDateAfterIncreaseRemoval({ ...d, increases: [...d.increases, other] }, d.increases, [other])).toBeNull();
  });

  it('زيادة ما فتحتش الدين (من غير reopenedFrom) أو دين مش أقساط ← مفيش', () => {
    const d = reopened();
    const plain = [{ id: 'i1', date: '2026-11-05', amount: 500 }];
    expect(dueDateAfterIncreaseRemoval({ ...d, increases: plain }, plain, [])).toBeNull();
    expect(dueDateAfterIncreaseRemoval(reopened({ isInstallment: false }), d.increases, [])).toBeNull();
  });

  it('دفعة سدّدت بعد الزيادة وبعدين الزيادة اتمسحت ← الدين بقى مدفوع زيادة (سالب) ← القديم برضه (money-reviewer)', () => {
    const d = reopened({ payments: [...reopened().payments, { id: 'p4', date: '2026-11-10', amount: 500, walletId: 'w', transactionId: 'tp4' }] });
    expect(dueDateAfterIncreaseRemoval(d, d.increases, [])).toBe('2026-03-15');
  });
});

describe('النصوص', () => {
  // الساعة متثبّتة: النص بيعتمد على سنة النهاردة (قرار ب3 — السنة بتتشال لو هي السنة دي)
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 10, 13, 12, 0, 0)); });
  afterEach(() => jest.useRealTimers());

  it('نفس السنة من غير سنة: «5 ديسمبر»، والرسالة، وسطر الرجوع', () => {
    expect(dueDateLabel('2026-12-05')).toBe('5 ديسمبر');
    expect(reopenedDueMessage('2026-12-15')).toBe('الزيادة فتحت الدين تاني، فمعاد القسط الجاي بقى 15 ديسمبر.');
    expect(dueRestoreLine('2026-03-15')).toBe('معاد القسط الجاي هيرجع 15 مارس.');
  });
  it('سنة تانية: السنة بتفضل', () => {
    expect(dueDateLabel('2027-01-05')).toBe('5 يناير 2027');
    expect(dueDateLabel('2025-09-15')).toBe('15 سبتمبر 2025');
    expect(reopenedDueMessage('2027-02-15')).toBe('الزيادة فتحت الدين تاني، فمعاد القسط الجاي بقى 15 فبراير 2027.');
  });
  it('«today» بارامتر صريح بيغلب الساعة (سطر الديون: معاد 15 سبتمبر والنهاردة 13 نوفمبر 2026)', () => {
    expect(dueDateLabel('2026-09-15', '2026-11-13')).toBe('15 سبتمبر');
    expect(dueDateLabel('2026-09-15', '2027-01-02')).toBe('15 سبتمبر 2026');
  });
});

describe('تأكيد المسح بيقول إن المعاد هيرجع — من الشاشة ومن العملية', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 10, 13, 12, 0, 0)); });
  afterEach(() => jest.useRealTimers());

  it('شاشة الدين: debtEntryDeletePlan + الرسالة', () => {
    const d = reopened();
    const plan = debtEntryDeletePlan(d, 'increase', 'i1')!;
    expect(plan.dueRestore).toBe('2026-03-15');
    expect(debtEntryDeleteMessage(d, 'increase', plan, 'كاش', n => String(n)).body).toContain('معاد القسط الجاي هيرجع 15 مارس.');
  });

  it('مسح العملية: transactionDeleteDebtPlan + debtLinkWarning', () => {
    const d = reopened();
    expect(transactionDeleteDebtPlan(d, 'ti1')!.dueRestore).toBe('2026-03-15');
    expect(debtLinkWarning(d, 'ti1')).toContain('معاد القسط الجاي هيرجع 15 مارس.');
  });

  it('دفعة ← مفيش سطر معاد', () => {
    const d = reopened();
    expect(debtEntryDeletePlan(d, 'payment', 'p1')!.dueRestore).toBeNull();
  });
});

/**
 * الجولة 2 (بند 6): دفعتين قدّموا المعاد 01-15 ← 02-15 (أ) ← 03-15 (ب). المسح بالترتيب (ب ثم أ) بيرجّعه خطوة خطوة.
 * المسح بالعكس (أ الأول): المعاد مش بتاع أ فمبيتلمسش — بس السلسلة بتتوصل (ب بقت 01-15 ← 03-15)، فمسح ب بعدها
 * بيرجّع 01-15 مش 02-15 (معاد مكانش هيبقى صح بعد ما الدفعتين اتشالوا).
 */
describe('سلسلة المعاد مع مسح الدفعات (paymentsAfterRemoval)', () => {
  const A = { id: 'a', date: '2026-01-10', amount: 1000, walletId: 'w', transactionId: 'ta', advancedFrom: '2026-01-15', advancedTo: '2026-02-15' };
  const B = { id: 'b', date: '2026-02-10', amount: 1000, walletId: 'w', transactionId: 'tb', advancedFrom: '2026-02-15', advancedTo: '2026-03-15' };
  const base = {
    id: 'd', direction: 'i_owe', personName: 'س', totalAmount: 4000, date: '2026-01-01', isInstallment: true, installmentCount: 4,
    dueDate: '2026-03-15', payments: [A, B], increases: [],
  } as unknown as Debt;
  function remove(d: Debt, id: string): Debt {
    const removed = d.payments.filter(p => p.id === id);
    const after = paymentsAfterRemoval(removed, d.payments.filter(p => p.id !== id));
    const restore = dueDateAfterPaymentRemoval(d, removed, after);
    return { ...d, payments: after, ...(restore ? { dueDate: restore } : {}) };
  }

  it('بالترتيب: ب ثم أ ← 02-15 ثم 01-15', () => {
    const afterB = remove(base, 'b');
    expect(afterB.dueDate).toBe('2026-02-15');
    expect(remove(afterB, 'a').dueDate).toBe('2026-01-15');
  });

  it('بالعكس: أ ثم ب ← المعاد زي ما هو، وبعدين 01-15', () => {
    const afterA = remove(base, 'a');
    expect(afterA.dueDate).toBe('2026-03-15');
    expect(afterA.payments).toEqual([{ ...B, advancedFrom: '2026-01-15' }]);
    expect(remove(afterA, 'b').dueDate).toBe('2026-01-15');
  });

  it('دفعة من غير سلسلة (قديمة) ← الباقي زي ما هو', () => {
    const plainA: { advancedFrom?: string; advancedTo?: string } = { advancedFrom: undefined, advancedTo: undefined };
    expect(paymentsAfterRemoval([plainA], [B as { advancedFrom?: string; advancedTo?: string }])).toEqual([B]);
  });

  it('مسح العملية من الأرشيف (transactionDeleteDebtPlan) بيوصّل نفس السلسلة', () => {
    expect(transactionDeleteDebtPlan(base, 'ta')!.payments).toEqual([{ ...B, advancedFrom: '2026-01-15' }]);
  });
});
