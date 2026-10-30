import type { Debt } from '@/context/DataContext';
import {
  debtEntryDeleteMessage, debtEntryDeletePlan, debtLinkWarning, installmentCountBackLine,
  installmentCountFor, planInstallments, stampResidue, transactionDeleteDebtPlan,
} from '@/lib/finance';

/**
 * D3 (بند 8): مسح عملية مربوطة بدفعة/زيادة من مودال العملية لازم يقول نفس اللي
 * شاشة الدين بتقوله عن عدد الأقساط. الدالة النقية `transactionDeleteDebtPlan` بتحسب
 * **بالظبط** اللي `stageReconcile` بيكتبه النهارده (دفعة ← الدفعات بس من غير تثبيت
 * ولا تغيير فرق؛ زيادة ← الفرق بيتطوي لو معروف)، و`debtLinkWarning` بتبني الجملة اللي
 * `transactionLinkWarning` بيعرضها. القيم المتوقعة محسوبة بإيدي (مش من نفس الدالة).
 */

// 1000 على 12: القسط 83.33 وفرق التقريب 0.04 (القسط الأخير 83.37)
const created = planInstallments(1000, 12)!;
const createdStamp = stampResidue({ amount: created.residue, forInstallment: created.value, over: created.over }, [])!;

function debt(over: Partial<Debt> = {}): Debt {
  return {
    id: 'd1', direction: 'owed_to_me', personName: 'أحمد', totalAmount: 1000,
    date: '2026-01-01', isInstallment: true, installmentCount: 12, installmentAmount: 83.33,
    installmentResidue: createdStamp,
    createdAt: '2026-01-01T00:00:00.000Z', payments: [], increases: [],
    ...over,
  } as Debt;
}

const pay = (id: string, amount: number, tx: string) => ({ id, date: '2026-02-01', amount, walletId: 'w1', transactionId: tx });
const inc500 = { id: 'i1', date: '2026-02-05', amount: 500, walletId: 'w1', transactionId: 't_inc' };

// دين فيه زيادة 500: الخطة 18 قسط والفرق 0.06 والبصمة بمجموع الزيادات
const afterIncrease = (): Debt => debt({
  increases: [inc500], installmentCount: 18,
  installmentResidue: { amount: 0.06, forInstallment: 83.33, over: 18, increasesTotal: 500 },
});

// دفعة 300 + قسطين: 466.66 اتدفع، فاضل 533.34 ← 7 أقساط ← 10 إجمالي (3 دفعات + 7)
const withBigPayment = (): Debt => debt({
  installmentCount: 10,
  payments: [pay('p1', 300, 't_big'), pay('p2', 83.33, 't_2'), pay('p3', 83.33, 't_3')],
});

describe('transactionDeleteDebtPlan — بيحسب اللي stageReconcile هيكتبه', () => {
  it('دفعة كبيرة تتمسح ← العدد يرجع 12 بدل 10، من غير تثبيت ولا تغيير فرق', () => {
    const d = withBigPayment();
    const plan = transactionDeleteDebtPlan(d, 't_big')!;
    expect(plan.kind).toBe('payment');
    expect(plan.payments!.map(p => p.id)).toEqual(['p2', 'p3']);
    expect(plan.increases).toBeUndefined();
    expect(plan.residue).toBeNull();
    expect(plan.countBefore).toBe(10);
    // بإيدي: دفعتين + (1000 − 166.66 = 833.34 ← 10 أقساط) = 12
    expect(plan.countAfter).toBe(12);
    expect(plan.countAfter).toBe(installmentCountFor({ ...d, payments: d.payments.filter(p => p.transactionId !== 't_big') }));
  });

  it('3 دفعات 83.33 ومسح واحدة ← العدد بيفضل 12 (مفيش حركة)', () => {
    const d = debt({ installmentCount: 12, payments: [pay('p1', 83.33, 'a'), pay('p2', 83.33, 'b'), pay('p3', 83.33, 'c')] });
    const plan = transactionDeleteDebtPlan(d, 'b')!;
    expect(plan.payments!.map(p => p.id)).toEqual(['p1', 'p3']);
    expect(plan.countBefore).toBe(12);
    expect(plan.countAfter).toBe(12);
  });

  it('زيادة 500 تتمسح ← الفرق يرجع لبصمة الإنشاء والعدد 12 بدل 18', () => {
    const d = afterIncrease();
    const plan = transactionDeleteDebtPlan(d, 't_inc')!;
    expect(plan.kind).toBe('increase');
    expect(plan.increases).toEqual([]);
    expect(plan.payments).toBeUndefined();
    expect(plan.residue).toEqual({ op: 'set', value: createdStamp });
    expect(plan.residue).toEqual({ op: 'set', value: { amount: 0.04, forInstallment: 83.33, over: 12, increasesTotal: 0 } });
    expect(plan.countBefore).toBe(18);
    expect(plan.countAfter).toBe(12);
  });

  it('زيادتين ومسح واحدة ← البصمة بمجموع اللي فضل', () => {
    const other = { id: 'i2', date: '2026-02-06', amount: 100, walletId: 'w1', transactionId: 't_inc2' };
    const d = debt({
      increases: [inc500, other], installmentCount: 19,
      // الخطة بعد +600 من الإنشاء (بإيدي: 16.73 على 19 قسط)
      installmentResidue: { amount: 16.73, forInstallment: 83.33, over: 19, increasesTotal: 600 },
    });
    const plan = transactionDeleteDebtPlan(d, 't_inc2')!;
    expect(plan.increases!.map(e => e.id)).toEqual(['i1']);
    // بإيدي: مسح 100 من 600 ← نفس حالة +500 بالظبط (0.06 على 18، والبصمة 500)
    expect(plan.residue).toEqual({ op: 'set', value: { amount: 0.06, forInstallment: 83.33, over: 18, increasesTotal: 500 } });
    expect(plan.countBefore).toBe(19);
    expect(plan.countAfter).toBe(18);
  });

  it('زيادة على دين مالوش فرق معروف ← residue null (مبنخترعش فرق)', () => {
    const { installmentResidue: _r, ...rest } = afterIncrease();
    const d = { ...rest } as Debt;
    const plan = transactionDeleteDebtPlan(d, 't_inc')!;
    expect(plan.kind).toBe('increase');
    expect(plan.residue).toBeNull();
    expect(plan.increases).toEqual([]);
    expect(plan.countBefore).toBe(18);
    // بإيدي: من غير فرق، 1000 ÷ 83.33 = 12.0005 ← بسماحية نص قرش 12
    expect(plan.countAfter).toBe(12);
  });

  it('زيادة وفرقها متخزّن بس بصمته قديمة (نسخة قديمة غيّرت الزيادات) ← residue null مش set', () => {
    const d = afterIncrease();
    d.installmentResidue = { amount: 0.06, forInstallment: 83.33, over: 18, increasesTotal: 123 };
    expect(transactionDeleteDebtPlan(d, 't_inc')!.residue).toBeNull();
  });

  it('دين قديم من غير installmentAmount ← مسح دفعة من غير تثبيت ولا فرق', () => {
    const legacy = {
      id: 'd2', direction: 'i_owe', personName: 'سعيد', totalAmount: 6000, date: '2026-01-01',
      isInstallment: true, installmentCount: 6, createdAt: 'x', increases: [],
      payments: [pay('p1', 1000, 'l1'), pay('p2', 1000, 'l2'), pay('p3', 500, 'l3')],
    } as unknown as Debt;
    const plan = transactionDeleteDebtPlan(legacy, 'l1')!;
    expect(plan).not.toHaveProperty('installmentAmount');
    expect(plan.residue).toBeNull();
    expect(plan.payments!.map(p => p.id)).toEqual(['p2', 'p3']);
    expect(plan.countBefore).toBe(6);
    // بإيدي: القسط 6000 ÷ 6 = 1000، اتدفع 1500 فاضل 4500 ← 5 أقساط + دفعتين = 7
    expect(plan.countAfter).toBe(7);
  });

  it('دين مش أقساط ← countAfter null وcountBefore undefined', () => {
    const d = debt({ isInstallment: false, installmentCount: undefined, installmentAmount: undefined, installmentResidue: undefined,
      payments: [pay('p1', 100, 't1')] });
    const plan = transactionDeleteDebtPlan(d, 't1')!;
    expect(plan.kind).toBe('payment');
    expect(plan.countAfter).toBeNull();
    expect(plan.countBefore).toBeUndefined();
  });

  it('عملية مالهاش علاقة بالدين ← null', () => {
    expect(transactionDeleteDebtPlan(withBigPayment(), 'nope')).toBeNull();
  });

  it('عملية الدين الأولى برّه النطاق ← null', () => {
    const d = debt({ initialTransactionId: 't_init', payments: [pay('p1', 100, 't1')] });
    expect(transactionDeleteDebtPlan(d, 't_init')).toBeNull();
  });

  it('مبيعدّلش الدين اللي اتبعتله (نقي)', () => {
    const d = afterIncrease();
    const snapshot = JSON.stringify(d);
    transactionDeleteDebtPlan(d, 't_inc');
    expect(JSON.stringify(d)).toBe(snapshot);
  });
});

describe('installmentCountBackLine', () => {
  it('عدد اتغيّر ← الجملة بالظبط', () => {
    expect(installmentCountBackLine(10, 12)).toBe('عدد الأقساط هيرجع 12 بدل 10.');
    expect(installmentCountBackLine(18, 12)).toBe('عدد الأقساط هيرجع 12 بدل 18.');
  });

  it('نفس العدد ← null', () => {
    expect(installmentCountBackLine(12, 12)).toBeNull();
  });

  it('عدد مش معروف أو مش موجب أو مش رقم ← null (مفيش "بدل 0")', () => {
    const f = installmentCountBackLine as (a: unknown, b: unknown) => string | null;
    expect(f(undefined, 12)).toBeNull();
    expect(f(null, 12)).toBeNull();
    expect(f(12, null)).toBeNull();
    expect(f(12, undefined)).toBeNull();
    expect(f(0, 12)).toBeNull();
    expect(f(12, 0)).toBeNull();
    expect(f(-3, 12)).toBeNull();
    expect(f(NaN, 12)).toBeNull();
    expect(f(12, Infinity)).toBeNull();
  });

  it('رسالة مسح سجل الدين بتستخدم نفس السطر بالظبط', () => {
    const d = withBigPayment();
    const plan = debtEntryDeletePlan(d, 'payment', 'p1')!;
    expect(plan.countBefore).toBe(10);
    expect(plan.countAfter).toBe(12);
    const line = installmentCountBackLine(10, 12)!;
    const msg = debtEntryDeleteMessage(d, 'payment', plan, 'كاش', n => String(n));
    expect(msg.body.split('\n')).toContain(line);
  });
});

describe('debtLinkWarning — جملة تحذير مسح العملية المربوطة', () => {
  it('دفعة بتحرّك العدد ← الجملة + سطر العدد', () => {
    expect(debtLinkWarning(withBigPayment(), 't_big'))
      .toBe('دي دفعة في دين "أحمد" — هتتشال من الدين كمان.\nعدد الأقساط هيرجع 12 بدل 10.');
  });

  it('دفعة مبتحرّكش العدد ← الجملة بس', () => {
    const d = debt({ payments: [pay('p1', 83.33, 'a')] });
    expect(debtLinkWarning(d, 'a')).toBe('دي دفعة في دين "أحمد" — هتتشال من الدين كمان.');
  });

  it('زيادة بتحرّك العدد ← الجملة + سطر العدد', () => {
    expect(debtLinkWarning(afterIncrease(), 't_inc'))
      .toBe('دي زيادة على دين "أحمد" — هتتشال من الدين كمان.\nعدد الأقساط هيرجع 12 بدل 18.');
  });

  it('دين مش أقساط ← الجملة بس', () => {
    const d = debt({ isInstallment: false, installmentCount: undefined, installmentAmount: undefined, installmentResidue: undefined,
      payments: [pay('p1', 100, 't1')], increases: [] });
    expect(debtLinkWarning(d, 't1')).toBe('دي دفعة في دين "أحمد" — هتتشال من الدين كمان.');
  });

  it('عملية الدين الأولى ومعاها تاريخ ← الجملة القديمة زي ما هي', () => {
    const d = debt({ initialTransactionId: 't_init', payments: [pay('p1', 100, 't1')] });
    expect(debtLinkWarning(d, 't_init'))
      .toBe('العملية دي هي أساس دين "أحمد" — الدين هيفضل موجود بس هيبقى بالأجل من غير أثر على أي محفظة.');
  });

  it('عملية الدين الأولى من غير تاريخ ← الدين هيتمسح كمان', () => {
    const d = debt({ initialTransactionId: 't_init' });
    expect(debtLinkWarning(d, 't_init')).toBe('العملية دي هي أساس دين "أحمد" — الدين هيتمسح كمان.');
  });

  it('عملية مش بتاعة الدين ← null', () => {
    expect(debtLinkWarning(withBigPayment(), 'nope')).toBeNull();
  });
});


// silent-failure-hunter + money-reviewer (الجولة 1 على D3): نفس شرط الكتابة (`storableCount`) —
// عدد مش صحيح أو فوق الدقة مبيتكتبش، فالسطر ميقولوش
it('installmentCountBackLine: عدد مش قابل للتخزين ← مفيش سطر', () => {
  expect(installmentCountBackLine(10, 12.5)).toBeNull();
  expect(installmentCountBackLine(10, Number.MAX_SAFE_INTEGER + 2)).toBeNull();
  expect(installmentCountBackLine(10.5, 12)).toBeNull();
  expect(installmentCountBackLine(10, 12)).toBe('عدد الأقساط هيرجع 12 بدل 10.');
});
