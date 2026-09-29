import type { Debt } from '@/context/DataContext';
import { installmentCountAfterPayment, installmentCountFor } from '@/lib/finance';

/**
 * باقي صغير من القسط لازم يتعدّ قسط (TIMELINE 2026-09-29).
 *
 * كان `ceil(المتبقي ÷ القسط − 0.005)`: السماحية (نص قرش) كانت بتتطرح من
 * **عدد الأقساط** مش من **الجنيهات** — يعني باقي لحد 0.5% من القسط كان بيتبلع:
 * 5 ج.م على قسط 1000، و50 ج.م على قسط 10,000. فلوس حقيقية ملهاش قسط.
 * دلوقتي السماحية بالجنيه وعلى قد فرق تقريب القسط بس: نص قرش لكل قسط
 * (القيمة متخزّنة مقرّبة للقرش، فـ6 × 1083.33 = 6499.98 — والقرشين دول مش
 * لازم يعملوا قسط وهمي، `finance.installments.test.ts`).
 */

const debt = (over: Partial<Debt> = {}) => ({
  id: 'd', personName: 'أحمد', direction: 'i_owe', isInstallment: true,
  totalAmount: 3000, installmentAmount: 1000, installmentCount: 3,
  payments: [], increases: [], date: '2026-01-01', createdAt: '2026-01-01',
  ...over,
}) as unknown as Debt;

const pay = (amount: number, i = 1) => ({ id: `p${i}`, date: '2026-02-01', amount, walletId: 'w' });

describe('installmentCountFor — الباقي بالجنيه', () => {
  it.each<[number, number, number]>([
    // المتبقي، القسط، العدد المتوقع
    [3005, 1000, 4],        // 5 ج.م زيادة = قسط رابع (كانت 3)
    [3004.99, 1000, 4],
    [30050, 10000, 4],      // 50 ج.م على قسط 10,000 (كانت 3)
    [3000.05, 1000, 4],     // 5 قروش على 3 أقساط > فرق التقريب الممكن (≤ 2 قرش) = قسط
    [3000.01, 1000, 3],     // قرش على 3 أقساط = جوّه فرق التقريب
    [3000, 1000, 3],        // بالظبط
    [3000.004, 1000, 3],    // أقل من نص قرش = كسور حساب، مش فلوس
    [2999.996, 1000, 3],
    [0.3 + 0.6, 0.3, 3],    // 0.8999999999999999 ÷ 0.3
  ])('متبقي %p بقسط %p ← %p', (total, value, expected) => {
    expect(installmentCountFor(debt({ totalAmount: total, installmentAmount: value }))).toBe(expected);
  });

  it('بعد دفعات: الدفعات + الباقي بالجنيه', () => {
    // 6000 بقسط 1000، اتدفع 2995 على تلات دفعات ← باقي 3005 = 4 أقساط كمان
    const d = debt({ totalAmount: 6000, payments: [pay(1000, 1), pay(1000, 2), pay(995, 3)] });
    expect(installmentCountFor(d)).toBe(3 + 4);
  });
});

describe('فرق التقريب بيتبلع على قده بس', () => {
  // 1000 على 12 = 83.33 متخزّنة، و12 × 83.33 = 999.96 ← 4 قروش في الآخر
  const twelve = () => debt({ totalAmount: 1000, installmentAmount: 83.33, installmentCount: 12 });
  const paidEleven = () => Array.from({ length: 11 }, (_, i) => pay(83.33, i + 1));

  it('بعد 11 قسط: الباقي 83.37 = القسط الأخير، مش قسطين', () => {
    expect(installmentCountFor({ ...twelve(), payments: paidEleven() })).toBe(12);
  });

  it('بس 5 جنيه زيادة (زي ما كان بيتبلع) = قسط', () => {
    expect(installmentCountFor(debt({ totalAmount: 3005, installmentAmount: 1000, installmentCount: 3 }))).toBe(4);
  });
});

describe('مراجعة الجولة الأولى (money-reviewer + silent-failure-hunter)', () => {
  const twelve = () => debt({ totalAmount: 1000, installmentAmount: 83.33, installmentCount: 12 });

  it('العدد بيقل بعد دفعة كبيرة ← فرق التقريب لسه بيتبلع (مفيش قسط وهمي)', () => {
    // دفع 6 أقساط مرة واحدة ← الباقي 500.02، العدد 7
    const afterLump = installmentCountAfterPayment(twelve(), 6 * 83.33)!;
    expect(afterLump).toBe(7);
    // وبعدها قسط عادي ← 7 زي ما هو، مش 8 عشان 4 قروش
    const d = { ...twelve(), installmentCount: afterLump, payments: [pay(6 * 83.33, 1)] };
    expect(installmentCountAfterPayment(d, 83.33)).toBe(7);
  });

  it('مفيش فرق تقريب (القسط مظبوط) ← باقي حقيقي صغير بيتعدّ حتى مع أقساط كتير', () => {
    // 120 × 100 بالظبط، والباقي 100.55 ← قسطين مش واحد
    const d = debt({ totalAmount: 12000, installmentAmount: 100, installmentCount: 120 });
    expect(installmentCountFor({ ...d, payments: Array.from({ length: 119 }, (_, i) => pay(99.9954, i + 1)) }))
      .toBe(119 + 2);
  });

  it('قسط اتعدّل بإيده (القسمة مش مظبوطة) ← الفرق مش "تقريب" ومبيتبلعش', () => {
    // الأصل 1000، والقسط اتعدّل لـ300 ← 3.33 قسط؛ الباقي 1000 = 4 أقساط
    expect(installmentCountFor(debt({ totalAmount: 1000, installmentAmount: 300, installmentCount: 4 }))).toBe(4);
  });

  it('القسط الـ12 بالقيمة المتخزّنة (فاضل 4 قروش تقريب) ← 12 مش 13 (الجولة التانية)', () => {
    const paid11 = Array.from({ length: 11 }, (_, i) => pay(83.33, i + 1));
    expect(installmentCountAfterPayment({ ...twelve(), payments: paid11 }, 83.33)).toBe(12);
    const paid12 = [...paid11, pay(83.33, 12)];
    expect(installmentCountFor({ ...twelve(), payments: paid12 })).toBe(12);
  });

  it('القسط اتعدّل بإيده (setInstallmentCount) ← مفيش قسط وهمي لحد الآخر (الجولة التانية)', () => {
    // 1500 بقسط 500، اتدفع 500، والعدد اتعدّل لـ4 ← القسط 333.33 (1000 ÷ 3)
    const base = debt({ totalAmount: 1500, installmentAmount: 333.33, installmentCount: 4 });
    const p1 = [pay(500, 1)];
    expect(installmentCountFor({ ...base, payments: p1 })).toBe(4);
    expect(installmentCountAfterPayment({ ...base, payments: p1 }, 333.33)).toBe(4);
    const p2 = [...p1, pay(333.33, 2)];
    expect(installmentCountAfterPayment({ ...base, payments: p2 }, 333.33)).toBe(4);
    // آخر قسط: فاضل 333.34 (قرش تقريب) ← لسه 4
    const p3 = [...p2, pay(333.33, 3)];
    expect(installmentCountFor({ ...base, payments: p3 })).toBe(4);
    // بس 5 جنيه زيادة بجد ← قسط
    expect(installmentCountFor({ ...base, payments: [pay(495, 1)] })).toBe(5);
  });

  it('مفيش صفر ولا سالب ولا NaN: قسط صغير جدًا وعدد كبير، وأصل مش رقم', () => {
    const tiny = installmentCountFor(debt({ totalAmount: 10, installmentAmount: 0.01, installmentCount: 1000,
      payments: [pay(7, 1)] }));
    expect(tiny).toBe(1 + 300);
    // أصل مش رقم ← null (مفيش عدد يتكتب)، مش رقم مخترع
    expect(installmentCountFor(debt({ totalAmount: NaN, installmentAmount: 100, installmentCount: 3 }))).toBeNull();
  });

  it('مفيش دفعات وباقي صغير فوق نص القرش ← قسط واحد، مش صفر', () => {
    expect(installmentCountFor(debt({ totalAmount: 0.02, installmentAmount: 1000, installmentCount: 1 }))).toBe(1);
  });
});

describe('installmentCountAfterPayment — نفس القاعدة', () => {
  it('دفعة سابت 5 ج.م على قسط 1000 ← قسط زيادة', () => {
    // 4000، دفع 995 ← باقي 3005 ← دفعة واحدة + 4
    expect(installmentCountAfterPayment(debt({ totalAmount: 4000 }), 995)).toBe(1 + 4);
  });
  it('دفعة بقيمة القسط بالظبط ← العدد زي ما هو', () => {
    expect(installmentCountAfterPayment(debt({ totalAmount: 3000 }), 1000)).toBe(3);
  });
  it('باقي أقل من نص قرش بعد الدفعة ← متسدد', () => {
    expect(installmentCountAfterPayment(debt({ totalAmount: 1000.004 }), 1000)).toBe(1);
  });
});
