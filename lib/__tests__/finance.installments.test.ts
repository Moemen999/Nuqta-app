import {
  installmentChangeMessage, installmentCountAfterPayment, installmentCountTooLowMessage,
  installmentProgress, installmentProgressLabel, installmentValue, planInstallmentCountEdit,
} from '@/lib/finance';
import type { Debt } from '@/context/DataContext';

/**
 * `installmentCount` كان بيتجمع ويتعرض و**مبيعملش حاجة**: الدين بستة أقساط
 * كان بيتصرّف زي اللي بأربعة وعشرين بالظبط. الرقم على الكارت كان وعد
 * التطبيق مش بيوفيه.
 *
 * القاعدة اللي اتطبقت: **القسط ثابت والعدد هو اللي بيتحرّك.** اللي دفع نص
 * قسط بياخد قسط زيادة، واللي دفع قسطين بيخلّص بدري — والتغيير بيتقال
 * بالكلام.
 */

function debt(over: Partial<Debt> = {}): Debt {
  return {
    id: 'd1', direction: 'i_owe', personName: 'أحمد', totalAmount: 6000,
    date: '2026-01-01', isInstallment: true, installmentCount: 6, installmentAmount: 1000,
    createdAt: '2026-01-01T00:00:00.000Z', payments: [], increases: [],
    ...over,
  } as Debt;
}
function pay(amount: number, id = String(Math.random())) {
  return { id, date: '2026-02-01', amount, walletId: 'w1' } as any;
}

describe('قيمة القسط', () => {
  it('بتيجي من الحقل المتخزّن', () => {
    expect(installmentValue(debt())).toBe(1000);
  });

  it('**مبتتغيّرش لما العدد يتغيّر** — دي كل الفكرة', () => {
    expect(installmentValue(debt({ installmentCount: 7 }))).toBe(1000);
    expect(installmentValue(debt({ installmentCount: 3 }))).toBe(1000);
  });

  it('ومبتتغيّرش لما تيجي زيادة على الدين', () => {
    const d = debt({ increases: [{ id: 'i1', date: '2026-03-01', amount: 2000 }] as any });
    expect(installmentValue(d)).toBe(1000);
  });

  it('الديون القديمة من غير الحقل بترجع للحسبة القديمة', () => {
    const d = debt({ installmentAmount: undefined });
    expect(installmentValue(d)).toBe(1000);
  });

  it('دين مش قسط مالوش قيمة قسط', () => {
    expect(installmentValue(debt({ isInstallment: false }))).toBeNull();
  });

  it('عدد صفر أو غايب من غير حقل متخزّن = null مش قسمة على صفر', () => {
    expect(installmentValue(debt({ installmentAmount: undefined, installmentCount: 0 }))).toBeNull();
    expect(installmentValue(debt({ installmentAmount: undefined, installmentCount: undefined }))).toBeNull();
  });
});

describe('"القسط 3 من 6"', () => {
  it('أول قسط قبل أي دفعة', () => {
    expect(installmentProgress(debt())).toEqual({ current: 1, total: 6 });
    expect(installmentProgressLabel(debt())).toBe('القسط 1 من 6');
  });

  it('بيتقدّم مع كل دفعة', () => {
    const d = debt({ payments: [pay(1000), pay(1000)] });
    expect(installmentProgressLabel(d)).toBe('القسط 3 من 6');
  });

  it('الدين اللي خلص مفيهوش قسط جاي', () => {
    const d = debt({ payments: [pay(6000)] });
    expect(installmentProgress(d)).toBeNull();
    expect(installmentProgressLabel(d)).toBeNull();
  });

  it('الزيادة عن الإجمالي برضه بتقفل العدّاد', () => {
    expect(installmentProgress(debt({ payments: [pay(7000)] }))).toBeNull();
  });

  it('مبيعديش الإجمالي حتى لو الدفعات أكتر من العدد', () => {
    const d = debt({ payments: [pay(100), pay(100), pay(100), pay(100), pay(100), pay(100), pay(100)] });
    expect(installmentProgress(d)!.current).toBe(6);
  });

  it('دين مش قسط', () => {
    expect(installmentProgressLabel(debt({ isInstallment: false }))).toBeNull();
  });
});

describe('العدد بعد الدفعة', () => {
  it('دفعة بقيمة القسط بالظبط مبتغيّرش العدد', () => {
    expect(installmentCountAfterPayment(debt(), 1000)).toBe(6);
  });

  it('دفع أقل ⇒ أقساط أكتر', () => {
    // باقي 5300 ÷ 1000 = 5.3 ← 6 أقساط باقية، + الدفعة اللي حصلت = 7
    expect(installmentCountAfterPayment(debt(), 700)).toBe(7);
  });

  it('دفع أكتر ⇒ أقساط أقل', () => {
    // باقي 4500 ÷ 1000 = 4.5 ← 5 باقية، + 1 = 6
    expect(installmentCountAfterPayment(debt(), 1500)).toBe(6);
    // ودفعة أكبر بتبان أوضح: باقي 3000 ← 3 باقية، + 1 = 4
    expect(installmentCountAfterPayment(debt(), 3000)).toBe(4);
  });

  it('الدفعة اللي بتقفل الدين بتثبّت العدد عند الدفعات اللي حصلت', () => {
    expect(installmentCountAfterPayment(debt(), 6000)).toBe(1);
    const d = debt({ payments: [pay(1000), pay(1000)] });
    expect(installmentCountAfterPayment(d, 4000)).toBe(3);
  });

  it('الزيادة عن الإجمالي زيها زي السداد الكامل', () => {
    expect(installmentCountAfterPayment(debt(), 9000)).toBe(1);
  });

  it('بتحسب من **المتبقي** مش من الإجمالي', () => {
    const d = debt({ payments: [pay(1000), pay(1000)] });
    // باقي 4000، دفعة 1000 ← باقي 3000 = 3 أقساط، + 3 دفعات = 6
    expect(installmentCountAfterPayment(d, 1000)).toBe(6);
  });

  it('الزيادة على الدين بتزوّد العدد', () => {
    const d = debt({ increases: [{ id: 'i1', date: '2026-03-01', amount: 2000 }] as any });
    // الإجمالي 8000، دفعة 1000 ← باقي 7000 = 7 أقساط، + 1 = 8
    expect(installmentCountAfterPayment(d, 1000)).toBe(8);
  });

  it('الكسور بتتجبر لفوق — نص قسط لسه قسط', () => {
    const d = debt({ totalAmount: 1000, installmentCount: 1, installmentAmount: 1000 });
    expect(installmentCountAfterPayment(d, 1)).toBe(2);
  });

  it('مبتتحسبش لدين مش قسط ولا لقسط من غير قيمة', () => {
    expect(installmentCountAfterPayment(debt({ isInstallment: false }), 100)).toBeNull();
    expect(installmentCountAfterPayment(
      debt({ isInstallment: true, installmentAmount: undefined, installmentCount: 0 }), 100
    )).toBeNull();
  });
});

describe('الرسالة اللي بتتقال', () => {
  it('دفع أقل', () => {
    expect(installmentChangeMessage(700, 1000, 6, 7, false))
      .toBe('دفعت 700 بدل 1,000، الأقساط بقت 7.');
  });

  it('دفع أكتر', () => {
    expect(installmentChangeMessage(3000, 1000, 6, 4, false))
      .toBe('دفعت 3,000 بدل 1,000، الأقساط بقت 4.');
  });

  it('الدفعة الأخيرة مفيهاش كلام عن أقساط — "اتسدد بالكامل" هي الرسالة', () => {
    expect(installmentChangeMessage(6000, 1000, 6, 1, true)).toBeNull();
  });

  it('دفعة بقيمة القسط بالظبط مفيش كلام', () => {
    expect(installmentChangeMessage(1000, 1000, 6, 6, false)).toBeNull();
  });

  it('العدد ما اتغيرش مفيش كلام حتى لو المبلغ مختلف', () => {
    expect(installmentChangeMessage(1010, 1000, 6, 6, false)).toBeNull();
  });
});

describe('تعديل العدد بإيد المستخدم', () => {
  it('بيقسّم المتبقي على الأقساط الفاضلة', () => {
    const d = debt({ payments: [pay(1000), pay(1000)] });
    // باقي 4000 على (8 − 2) = 666.67 للقسط
    const plan = planInstallmentCountEdit(d, 8)!;
    expect(plan.count).toBe(8);
    expect(plan.value).toBeCloseTo(4000 / 6, 6);
  });

  it('من غير دفعات بيقسّم الإجمالي', () => {
    const plan = planInstallmentCountEdit(debt(), 12)!;
    expect(plan.value).toBe(500);
  });

  it('عدد أقل من أو يساوي الدفعات اللي حصلت مرفوض', () => {
    const d = debt({ payments: [pay(1000), pay(1000), pay(1000)] });
    expect(planInstallmentCountEdit(d, 3)).toBeNull();
    expect(planInstallmentCountEdit(d, 2)).toBeNull();
    expect(planInstallmentCountEdit(d, 4)).not.toBeNull();
  });

  it('صفر وسالب وكسور مرفوضين', () => {
    expect(planInstallmentCountEdit(debt(), 0)).toBeNull();
    expect(planInstallmentCountEdit(debt(), -2)).toBeNull();
    expect(planInstallmentCountEdit(debt(), 2.5)).toBeNull();
  });

  it('دين خلص مفيش فيه أقساط تتقسّم', () => {
    expect(planInstallmentCountEdit(debt({ payments: [pay(6000)] }), 3)).toBeNull();
  });

  it('رسالة الرفض بتقول العدد اللي اتسجل بعربي', () => {
    expect(installmentCountTooLowMessage(1)).toContain('قسط واحد');
    expect(installmentCountTooLowMessage(2)).toContain('قسطين');
    expect(installmentCountTooLowMessage(5)).toContain('5 أقساط');
  });
});
