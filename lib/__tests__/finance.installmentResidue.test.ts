import type { Debt } from '@/context/DataContext';
import {
  debtEntryDeletePlan, debtRemaining, foldInstallmentResidue, INSTALLMENT_COUNT_NOT_SAVED, INSTALLMENT_DEBT_SETTLED,
  installmentIncreaseMessage, installmentResidueIgnored, INSTALLMENT_VALUE_TOO_SMALL, installmentChangeMessage, installmentCountAfterPayment,
  installmentCountEditRefusal, installmentCountFor, installmentCountTooLowMessage, installmentProgressLabel,
  installmentResidueOf, PIASTRE_EPS, pinInstallmentAmount, planInstallmentCountEdit, planInstallments,
  reopenedDueDate, roundMoney, suggestedInstallmentPayment,
} from '@/lib/finance';

/**
 * فرق تقريب القسط متخزّن (`installmentResidue`، 2026-09-30) — بدل خطوة 5 اللي
 * كانت **بتستنتجه** وقت العدّ واترجعت بعد تلات جولات BLOCKER.
 *
 * القسط مقرّب للقرش، فـ"العدد × القسط" بيفرق عن المبلغ: 1000 على 12 = 83.33 × 12
 * = 999.96. الفرق (0.04) بيتكتب مع القسط، والقسط الأخير بيشيله (83.37) — فالدين
 * بيخلص في 12 مش 13، ومفيش 0.04 بتفضل مفتوحة.
 *
 * كل حالة هنا اتحسبت بإيد في الكومنت جنبها. المسار الكامل (تعديل العدد والدفع
 * للآخر) على المحاكي: `installmentResidue.emulator.test.tsx` — **ما اتشغلش في
 * السحابة**.
 */

const base = (over: Partial<Debt>) => ({
  id: 'd', personName: 'أحمد', direction: 'i_owe', isInstallment: true,
  date: '2026-01-01', createdAt: '2026-01-01', payments: [], increases: [], ...over,
}) as unknown as Debt;

/** نفس `addDebt` */
function created(total: number, n: number, over: Partial<Debt> = {}): Debt {
  const plan = planInstallments(total, n)!;
  return base({
    totalAmount: total, installmentCount: n, installmentAmount: plan.value,
    installmentResidue: { amount: plan.residue, forInstallment: plan.value, over: n }, ...over,
  });
}

let seq = 0;
/** نفس `addDebtPayment`: التثبيت قبل العدّ، والرسالة بالمقارنة بالاقتراح */
function paid(d: Debt, amount: number): { debt: Debt; note: string | null } {
  const pin = pinInstallmentAmount(d);
  const planned: Debt = pin ? { ...d, ...pin } : d;
  const next = installmentCountAfterPayment(planned, amount);
  const note = installmentChangeMessage(
    amount, suggestedInstallmentPayment(planned),
    d.installmentCount ?? 0, next ?? d.installmentCount ?? 0,
    debtRemaining(d) - amount <= PIASTRE_EPS,
  );
  const payments = [...planned.payments, { id: `p${++seq}`, date: '2026-02-01', amount, walletId: 'w' }];
  return { debt: { ...planned, installmentCount: next ?? planned.installmentCount, payments } as Debt, note };
}

/** بيدفع اللي المودال بيقترحه لحد ما الدين يخلص */
function payThrough(d: Debt) {
  const counts: number[] = [];
  const amounts: number[] = [];
  const notes: string[] = [];
  for (let i = 0; i < 200 && debtRemaining(d) > PIASTRE_EPS; i++) {
    const amount = suggestedInstallmentPayment(d);
    const r = paid(d, amount);
    d = r.debt;
    counts.push(d.installmentCount!);
    amounts.push(amount);
    if (r.note) notes.push(r.note);
  }
  // `|| 0`: roundMoney(−0.0000001) = −0، وtoBe(0) بيفرّق بينهم
  return { debt: d, counts, amounts, notes, left: roundMoney(debtRemaining(d)) || 0 };
}

/** نفس `setInstallmentCount` */
function edited(d: Debt, n: number): Debt {
  const plan = planInstallmentCountEdit(d, n)!;
  return {
    ...d, installmentCount: plan.count, installmentAmount: plan.value,
    installmentResidue: { amount: plan.residue, forInstallment: plan.value, over: plan.over },
  };
}

/** نفس `addDebtIncrease`: التثبيت، والزيادة بتدخل الخطة، والعدد من جديد */
function increased(d: Debt, amount: number, id = `i${++seq}`): Debt {
  const pin = pinInstallmentAmount(d);
  const planned: Debt = pin ? { ...d, ...pin } : d;
  const folded = foldInstallmentResidue(planned, amount);
  const next: Debt = {
    ...planned, ...(folded ? { installmentResidue: folded } : {}),
    increases: [...(planned.increases || []), { id, date: '2026-03-01', amount }],
  } as Debt;
  return { ...next, installmentCount: installmentCountFor(next) ?? next.installmentCount };
}

/** نفس `deleteDebtIncrease` */
function withoutIncrease(d: Debt, id: string): Debt {
  const entry = d.increases.find(e => e.id === id)!;
  const pin = pinInstallmentAmount(d);
  const planned: Debt = pin ? { ...d, ...pin } : d;
  const folded = foldInstallmentResidue(planned, -entry.amount);
  const next: Debt = {
    ...planned, ...(folded ? { installmentResidue: folded } : {}),
    increases: planned.increases.filter(e => e.id !== id),
  } as Debt;
  return { ...next, installmentCount: installmentCountFor(next) ?? next.installmentCount };
}

describe('planInstallments — القسط وفرق تقريبه', () => {
  it.each<[number, number, number, number]>([
    [1000, 3, 333.33, 0.01], //   3 × 333.33 = 999.99
    [1000, 7, 142.86, -0.02], //  7 × 142.86 = 1000.02 (القسط الأخير أصغر)
    [100, 12, 8.33, 0.04], //    12 × 8.33 = 99.96
    [100, 13, 7.69, 0.03], //    13 × 7.69 = 99.97
    [100.04, 11, 9.09, 0.05], // 11 × 9.09 = 99.99
    [1000, 12, 83.33, 0.04], //  12 × 83.33 = 999.96
    [6000, 6, 1000, 0],
  ])('%p على %p ← قسط %p وفرق %p', (total, n, value, residue) => {
    expect(planInstallments(total, n)).toEqual({ value, residue, over: n });
  });

  it('قسط أقل من قرش، أو عدد مش صحيح، أو مبلغ مش رقم ← null', () => {
    expect(planInstallments(0.04, 10)).toBeNull(); // 0.004 ← 0.00
    expect(planInstallments(100, 0)).toBeNull();
    expect(planInstallments(100, 2.5)).toBeNull();
    expect(planInstallments(NaN, 3)).toBeNull();
    expect(planInstallments(Infinity, 3)).toBeNull();
  });
});

describe('الدفع بالاقتراح للآخر: العدد ثابت والدين بيخلص في عدده بالظبط', () => {
  it.each<[number, number, number]>([
    // [الإجمالي، العدد، القسط الأخير = القسط + الفرق]
    [1000, 3, 333.34], //   الفاضل 0.01
    [1000, 7, 142.84], //   فرق سالب: الأخير أصغر (كان صح قبل كده كمان)
    [100, 12, 8.37], //     الفاضل 0.04
    [100, 13, 7.72], //     الفاضل 0.03
    [100.04, 11, 9.14], //  الفاضل 0.05
    [1000, 12, 83.37], //   الفاضل 0.04
  ])('%p على %p ← آخر قسط %p', (total, n, last) => {
    const r = payThrough(created(total, n));
    expect(r.left).toBe(0);
    expect(r.amounts).toHaveLength(n);
    expect(r.amounts[n - 1]).toBe(last);
    expect(r.counts).toEqual(Array(n).fill(n));
    expect(r.notes).toEqual([]);
  });

  it('خاصية: أي إجمالي وأي عدد لحد 24 ← n دفعة بالظبط والعدد مبيتحركش', () => {
    for (const total of [100, 99.99, 100.04, 999.99, 1000, 1234.56, 6500, 10000.01]) {
      for (let n = 1; n <= 24; n++) {
        const r = payThrough(created(total, n));
        expect([total, n, r.amounts.length, r.left]).toEqual([total, n, n, 0]);
        expect([total, n, new Set(r.counts)]).toEqual([total, n, new Set([n])]);
      }
    }
  });
});

describe('اللي دفع القسط المقرّب على القسط الأخير بيتقاله', () => {
  it('1000 على 3: دفع 333.33 بدل 333.34 ← قسط رابع، والرسالة بتقول', () => {
    let d = created(1000, 3);
    d = paid(d, 333.33).debt;
    d = paid(d, 333.33).debt;
    expect(suggestedInstallmentPayment(d)).toBe(333.34);
    const r = paid(d, 333.33);
    // باقي 0.01 > نص قرش ← قسط واحد على الأقل (كان 0: "القسط 3 من 3" والفلوس مفتوحة)
    expect(r.debt.installmentCount).toBe(4);
    expect(r.note).toBe('دفعت 333.33 بدل 333.34، الأقساط بقت 4.');
    expect(installmentProgressLabel(r.debt)).toBe('القسط 4 من 4');
    expect(suggestedInstallmentPayment(r.debt)).toBe(0.01);
  });
});

describe('السماحية بالفلوس مش بنسبة من القسط (بند 8 في الخريطة)', () => {
  it('6000 على 6، دفع 995 ← 7 أقساط (5 ج.م فلوس حقيقية)', () => {
    // باقي 5005: ceil((5005 − 0 − 0.005) ÷ 1000) = 6، + الدفعة = 7.
    // القاعدة القديمة: ceil(5.005 − 0.005) = 5 ← 6، والـ5 ج.م كانت بتستخبى
    const r = paid(created(6000, 6), 995);
    expect(r.debt.installmentCount).toBe(7);
    expect(r.note).toBe('دفعت 995 بدل 1,000، الأقساط بقت 7.');
    const rest = payThrough(r.debt);
    // 1000 × 5 وبعدين 5
    expect(rest.amounts).toEqual([1000, 1000, 1000, 1000, 1000, 5]);
    expect(rest.counts).toEqual([7, 7, 7, 7, 7, 7]);
  });
});

describe('تعديل العدد وبعدين الدفع للآخر', () => {
  it('1500، اتدفع 500، والعدد بقى 4 ← 4 طول الطريق وآخر قسط 333.34', () => {
    let d = created(1500, 3);
    d = paid(d, 500).debt;
    expect(d.installmentCount).toBe(3);
    // باقي 1000 على (4 − 1) = 333.33، الفرق 1000 − 999.99 = 0.01
    d = edited(d, 4);
    expect(d.installmentAmount).toBe(333.33);
    expect(d.installmentResidue).toEqual({ amount: 0.01, forInstallment: 333.33, over: 3 });
    const r = payThrough(d);
    expect(r.amounts).toEqual([333.33, 333.33, 333.34]);
    expect(r.counts).toEqual([4, 4, 4]);
    expect(r.left).toBe(0);
  });

  it('1000 على 4، اتدفع 250، والعدد بقى 8 ← 8 طول الطريق وآخر قسط 107.16', () => {
    let d = created(1000, 4);
    d = paid(d, 250).debt;
    // باقي 750 على 7 = 107.14، الفرق 750 − 749.98 = 0.02
    d = edited(d, 8);
    expect(d.installmentResidue).toEqual({ amount: 0.02, forInstallment: 107.14, over: 7 });
    const r = payThrough(d);
    expect(r.amounts).toEqual([...Array(6).fill(107.14), 107.16]);
    expect(r.counts).toEqual(Array(7).fill(8));
    expect(r.left).toBe(0);
  });

  it('عدد مبيقسمش الإجمالي من غير دفعات: 1000 على 4 ← 3', () => {
    const d = edited(created(1000, 4), 3);
    expect(d.installmentResidue).toEqual({ amount: 0.01, forInstallment: 333.33, over: 3 });
    const r = payThrough(d);
    expect(r.amounts).toEqual([333.33, 333.33, 333.34]);
    expect(r.counts).toEqual([3, 3, 3]);
  });

  it('قسط هيطلع أقل من قرش ← مرفوض برسالته، مش قسط 0 متخزّن', () => {
    // 100 اتدفع منها 99.96 ← باقي 0.04 على 10 أقساط = 0.004
    const d = paid(created(100, 1), 99.96).debt;
    expect(planInstallmentCountEdit(d, 11)).toBeNull();
    expect(installmentCountEditRefusal(d, 11)).toBe(INSTALLMENT_VALUE_TOO_SMALL);
    // عدد مش أكبر من الدفعات ← الرسالة القديمة زي ما هي
    expect(installmentCountEditRefusal(d, 1)).toBe(installmentCountTooLowMessage(1));
    // 0.04 على 4 = 0.01 بالظبط ← مقبول
    expect(planInstallmentCountEdit(d, 5)).toEqual({ count: 5, value: 0.01, residue: 0, over: 4 });
    expect(installmentCountEditRefusal(d, 5)).toBeNull();
  });
});

describe('ديون قبل الحقل ده', () => {
  it('قسط متخزّن من غير فرق ← القاعدة القديمة في العدد (مش هنستنتج الفرق)', () => {
    const legacy = base({ totalAmount: 1000, installmentCount: 12, installmentAmount: 83.33 });
    expect(installmentResidueOf(legacy)).toBeNull();
    // ceil(1000 ÷ 83.33 − 0.005) = ceil(11.9955) = 12 — مش 13 وهمي
    expect(installmentCountFor(legacy)).toBe(12);
  });

  it('...والاقتراح ماشي مع نفس القاعدة: القسط الأخير 83.37 بيقفله (كان بيسيب 0.04)', () => {
    const r = payThrough(base({ totalAmount: 1000, installmentCount: 12, installmentAmount: 83.33 }));
    // بعد 11 قسط: باقي 83.37، ceil(83.37 ÷ 83.33 − 0.005) = 1 ← المتبقي كله
    expect(r.amounts).toHaveLength(12);
    expect(r.amounts[11]).toBe(83.37);
    expect(r.counts).toEqual(Array(12).fill(12));
  });

  it('القديم برضه: 6000 على 6 بعد 995 ← آخر اقتراح 1005 (الـ5 ج.م بتبان في الاقتراح)', () => {
    const legacy = base({ totalAmount: 6000, installmentCount: 6, installmentAmount: 1000 });
    const r = payThrough(paid(legacy, 995).debt);
    // سماحية الـ0.5% لسه في العدد للديون القديمة (بند 8 فاضل مفتوح ليهم)،
    // بس الفلوس مبتستخباش: القسط الأخير 1005
    expect(r.amounts).toEqual([1000, 1000, 1000, 1000, 1005]);
    expect(r.counts).toEqual([6, 6, 6, 6, 6]);
  });

  it('القديم: فلوس فاضلة = قسط واحد على الأقل، والرسالة بتقول', () => {
    let d = paid(base({ totalAmount: 6000, installmentCount: 6, installmentAmount: 1000 }), 995).debt;
    for (let i = 0; i < 4; i++) d = paid(d, 1000).debt;
    // باقي 1005، دفع 1000 بدل 1005 ← باقي 5: ceil(0.005 − 0.005) = 0 ← 1
    const r = paid(d, 1000);
    expect(r.debt.installmentCount).toBe(7);
    expect(r.note).toBe('دفعت 1,000 بدل 1,005، الأقساط بقت 7.');
  });

  it('من غير قسط متخزّن خالص (خطوة 6): التثبيت بيكتب الفرق ← 12 قسط، آخرها 83.37', () => {
    const legacy = base({ totalAmount: 1000, installmentCount: 12 });
    expect(pinInstallmentAmount(legacy)).toEqual({
      installmentAmount: 83.33, installmentResidue: { amount: 0.04, forInstallment: 83.33, over: 12 },
    });
    const r = payThrough(legacy);
    expect(r.debt.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12 });
    expect(r.amounts).toHaveLength(12);
    expect(r.amounts[11]).toBe(83.37);
    expect(r.counts).toEqual(Array(12).fill(12));
  });

  it('التثبيت بيغيّر العدد ← بيتقال في نفس الدفعة، مش ساكت بعدها', () => {
    // دين قديم: 6000 على 6، اتدفع 995 والعدد القديم فضل 6 (سماحية 0.5%).
    // التثبيت: قسط 1000 وفرق 0 ← باقي 5005 = 6 أقساط + دفعة = 7
    const legacy = base({
      totalAmount: 6000, installmentCount: 6,
      payments: [{ id: 'old', date: '2026-01-15', amount: 995, walletId: 'w' }],
    });
    const r = paid(legacy, 1000);
    // باقي 4005 ← ceil(4004.995 ÷ 1000) = 5، + دفعتين = 7
    expect(r.debt.installmentCount).toBe(7);
    expect(r.note).toBe('الأقساط بقت 7 بدل 6.');
  });
});

describe('installmentResidueOf — الفرق بيتقري بس لو بتاع القسط المتخزّن', () => {
  const d = (over: Partial<Debt>) => base({ totalAmount: 1000, installmentCount: 12, installmentAmount: 83.33, ...over });

  it.each<[string, unknown, number | null]>([
    ['موجب', { amount: 0.04, forInstallment: 83.33, over: 12 }, 0.04],
    ['صفر', { amount: 0, forInstallment: 83.33, over: 12 }, 0],
    ['سالب ← 0', { amount: -0.02, forInstallment: 83.33, over: 12 }, 0],
    ['بتاع قسط تاني (نسخة قديمة عدّلت العدد)', { amount: 0.04, forInstallment: 76.92, over: 12 }, null],
    ['مش رقم', { amount: NaN, forInstallment: 83.33, over: 12 }, null],
    ['لا نهائي', { amount: Infinity, forInstallment: 83.33, over: 12 }, null],
    ['نص', { amount: '0.04', forInstallment: 83.33, over: 12 }, null],
    ['كسر حقيقي مش تقريب (−0.10 على 12، أكبر من 0.06) ← 0', { amount: -0.1, forInstallment: 83.33, over: 12 }, 0],
    ['الخطة أكبر من الإجمالي (over بايظ) ← مش معروف', { amount: 0.04, forInstallment: 83.33, over: 13 }, null],
    ['من غير over (شكل قبل 2026-09-30) ← مش معروف', { amount: 0.04, forInstallment: 83.33 }, null],
    ['over مش صحيح', { amount: 0.04, forInstallment: 83.33, over: 12.5 }, null],
    ['مش object', 0.04, null],
    ['مش موجود', undefined, null],
  ])('%s', (_, residue, expected) => {
    expect(installmentResidueOf(d({ installmentResidue: residue as never }))).toBe(expected);
  });

  it('من غير قسط متخزّن (القيمة محسوبة) ← مش معروف حتى لو فيه فرق', () => {
    expect(installmentResidueOf(d({ installmentAmount: undefined, installmentResidue: { amount: 0.04, forInstallment: 83.33, over: 12 } }))).toBeNull();
  });

  it('الفرق القديم مع قسط جديد ← القاعدة القديمة، مش خصم فرق غلط', () => {
    // 1000 على 12 (فرق 0.04 على 83.33)، ونسخة قديمة غيّرت القسط لـ76.92 من غير الفرق
    const stale = d({ installmentAmount: 76.92, installmentCount: 13, installmentResidue: { amount: 0.04, forInstallment: 83.33, over: 12 } });
    // ceil(1000 ÷ 76.92 − 0.005) = ceil(13.0005 − 0.005) = 13
    expect(installmentCountFor(stale)).toBe(13);
  });
});

describe('مع خطوة 7: زيادة فتحت دين متسدد', () => {
  it('1000 على 3 اتسدد بالاقتراح، وبعدين زيادة 100 ← المعاد بيتقدّم والعدد 4 والاقتراح 100', () => {
    const r = payThrough(created(1000, 3, { dueDate: '2026-05-01' }));
    // اتسدد في 3 بالظبط — من غير كده (0.01 مفتوحة) خطوة 7 مكانتش هتعتبره متسدد
    expect(r.left).toBe(0);
    expect(r.amounts).toHaveLength(3);
    expect(reopenedDueDate(r.debt, 100, '2026-06-10', '2026-06-10')).toBe('2026-07-01');
    const reopened = increased(r.debt, 100);
    // الخطة 3 × 333.33 + 0.01 + 100 ← الباقي 100.01 كسر حقيقي (مش ≤ 3 × نص قرش) ← 0
    // باقي 100: max(1, ceil((100 − 0 − 0.005) ÷ 333.33)) = 1، + 3 دفعات = 4
    expect(reopened.installmentResidue).toEqual({ amount: 100.01, forInstallment: 333.33, over: 3 });
    expect(installmentCountFor(reopened)).toBe(4);
    expect(suggestedInstallmentPayment(reopened)).toBe(100);
  });

  it('زيادة 333.34 بالظبط (قسط + الفرق) ← قسط واحد، والاقتراح بيقفله', () => {
    const r = payThrough(created(1000, 3));
    const reopened = increased(r.debt, 333.34);
    // 0.01 + 333.34 = قسط كامل + 0.02، و0.02 ≤ 4 × نص قرش **بالظبط** ← تقريب
    // (التقريب لنص فوق كان هيقول 333.335 ← 333.34 ≠ القسط ← قسط 0.01 وهمي)
    expect(reopened.installmentResidue).toEqual({ amount: 0.02, forInstallment: 333.33, over: 4 });
    expect(installmentCountFor(reopened)).toBe(4);
    expect(suggestedInstallmentPayment(reopened)).toBe(333.34);
    expect(payThrough(reopened).amounts).toEqual([333.34]);
  });
});

describe('الرسالة لما العدد يتغيّر والمبلغ هو الاقتراح', () => {
  it('بتقول العدد القديم والجديد', () => {
    expect(installmentChangeMessage(1000, 1000, 6, 7, false)).toBe('الأقساط بقت 7 بدل 6.');
  });
  it('من غير عدد قديم معروف ← مفيش "بدل 0"', () => {
    expect(installmentChangeMessage(1000, 1000, 0, 7, false)).toBeNull();
  });
  it('العدد ما اتغيرش أو الدين خلص ← مفيش كلام (زي قبل)', () => {
    expect(installmentChangeMessage(1000, 1000, 6, 6, false)).toBeNull();
    expect(installmentChangeMessage(1000, 1000, 6, 1, true)).toBeNull();
  });
});

describe('المراجعة (الجولة 1)', () => {
  it('فرق فوق السقف الفيزيائي (بيانات بايظة) ← القاعدة القديمة، ومتعلَّم إنه اتجاهل', () => {
    // 1e6 بنفس القسط كانت هتخلّي العدد "قسط واحد فاضل" على 1000
    const bad = created(1000, 12, { installmentResidue: { amount: 1e6, forInstallment: 83.33, over: 12 } });
    expect(installmentResidueOf(bad)).toBeNull();
    expect(installmentResidueIgnored(bad)).toBe(true);
    expect(installmentCountFor(bad)).toBe(12);
    // الحقيقي تحت السقف: 1000 على 12 ← 0.04 ≤ 0.005 × (1000 ÷ 83.325 + 1) + 0.005 ≈ 0.07
    expect(installmentResidueIgnored(created(1000, 12))).toBe(false);
    // و1 على 24 = قسط 0.04 وفرق 0.04 (السقف ≈ 0.15) ← مقبول
    expect(installmentResidueOf(created(1, 24))).toBe(0.04);
    // مفيش فرق خالص ← مش "متجاهَل"
    expect(installmentResidueIgnored(base({ totalAmount: 1000, installmentCount: 12, installmentAmount: 83.33 }))).toBe(false);
  });

  it('تعديل عدد دين متسدد، أو متبقي مش رقم ← رسالته هو', () => {
    const settled = paid(created(1000, 4), 1000).debt;
    expect(installmentCountEditRefusal(settled, 5)).toBe(INSTALLMENT_DEBT_SETTLED);
    const corrupt = base({ totalAmount: NaN, installmentCount: 4, installmentAmount: 250 });
    expect(installmentCountEditRefusal(corrupt, 5)).toBe(INSTALLMENT_COUNT_NOT_SAVED);
  });

  it('تأكيد مسح دفعة على دين قديم بيقول نفس العدد اللي هيتكتب (بالتثبيت)', () => {
    // 6000 على 6 قديم (من غير قسط متخزّن)، دفعة قديمة 995 والعدد فضل 6، ودفعة 1000.
    // المسح بيثبّت (قسط 1000، فرق 0) قبل العدّ: باقي 5005 ← 6 + دفعة = 7.
    // من غير التثبيت في التأكيد كان هيقول "مفيش تغيير" والمكتوب 7
    const legacy = base({
      totalAmount: 6000, installmentCount: 6,
      payments: [
        { id: 'old', date: '2026-01-15', amount: 995, walletId: 'w' },
        { id: 'new', date: '2026-02-15', amount: 1000, walletId: 'w' },
      ],
    });
    const plan = debtEntryDeletePlan(legacy, 'payment', 'new')!;
    expect([plan.countBefore, plan.countAfter]).toEqual([6, 7]);
  });

  it('**مقصود (بند 8):** دفع ناقص قروش ← قسط زيادة بالفلوس الفاضلة، والرسالة بتقول', () => {
    // 1000 على 12، دفع 83.30: باقي 916.70 − 0.04 = 11 × 83.33 + 0.03 > نص قرش
    const r = paid(created(1000, 12), 83.3);
    expect(r.debt.installmentCount).toBe(13);
    expect(r.note).toContain('الأقساط بقت 13');
  });
});

describe('المراجعة (الجولة 2)', () => {
  it('زيادة اتمسحت بعد تعديل العدد ← الفرق لسه مقبول والعدد مبيتقلبش', () => {
    // 1000.29 + زيادة 2000، العدد اتعدّل لـ60: باقي 3000.29 ÷ 60 = 50.00، فرق 0.29
    let d = base({ totalAmount: 1000.29, installmentCount: 1, installmentAmount: 1000.29,
      increases: [{ id: 'big', date: '2026-02-01', amount: 2000 }] as never });
    d = edited(d, 60);
    expect(d.installmentResidue).toEqual({ amount: 0.29, forInstallment: 50, over: 60 });
    const plan = debtEntryDeletePlan(d, 'increase', 'big')!;
    // **اتغيّر 2026-09-30 (قرار مؤمن):** بعد المسح الخطة 1000.29 = 20 × 50 + 0.29،
    // و0.29 > 20 × نص قرش = 0.10 ← كسر حقيقي مش تقريب ← 21 قسط آخرها 0.29 — نفس
    // اللي كان هيطلع لو الدين اتعمل بحالته دي. (الجولة 2 كانت بتقول 20)
    expect(plan.countAfter).toBe(21);
    const after = withoutIncrease(d, 'big');
    expect(after.installmentResidue).toEqual({ amount: 0.29, forInstallment: 50, over: 20 });
    expect(installmentResidueOf(after)).toBe(0);
    expect(installmentResidueIgnored(after)).toBe(false);
    expect(after.installmentCount).toBe(21);
  });
});

/**
 * قرار مؤمن 2026-09-29: زيادة سابت **تقريب بس** (≤ نص قرش لكل قسط، نفس حد
 * الإنشاء) ← القسط الأخير بيشيله زي الإنشاء بالظبط؛ كسر **حقيقي** من قسط ← قسط
 * أخير أصغر. والفرق بعد كل زيادة ومسح = اللي كان هيتحسب لو الدين اتعمل بحالته.
 */
describe('زيادة على دين أقساط: التقريب بيتشال في القسط الأخير', () => {
  it('1000 على 12 + 500 ← 18 قسط، آخرها 83.39 (كان 19 وآخرها 0.06)', () => {
    // 0.04 + 500 = 6 × 83.33 + 0.06 ← over 18، و0.06 ≤ 18 × نص قرش = 0.09 ← تقريب
    const d = increased(created(1000, 12), 500);
    expect(d.installmentResidue).toEqual({ amount: 0.06, forInstallment: 83.33, over: 18 });
    expect(d.installmentCount).toBe(18);
    expect(installmentIncreaseMessage(12, 18)).toBe('بعد الزيادة، الأقساط بقت 18 بدل 12.');
    const r = payThrough(d);
    expect(r.amounts).toEqual([...Array(17).fill(83.33), 83.39]);
    expect(r.counts).toEqual(Array(18).fill(18));
    expect(r.left).toBe(0);
  });

  it('...ونفس الحالة لو اتعملت كده من الأول: 1500 على 18 ← نفس القسط والفرق', () => {
    expect(planInstallments(1500, 18)).toEqual({ value: 83.33, residue: 0.06, over: 18 });
    expect(increased(created(1000, 12), 500).installmentResidue).toEqual(created(1500, 18).installmentResidue);
  });

  it('1000 على 12 + 100 ← الكسر حقيقي (16.71) ← 14 قسط وآخرها 16.71، مش بيتشال', () => {
    // 0.04 + 100 = 83.33 + 16.71 ← over 13، و16.71 > 13 × نص قرش ← مش تقريب
    const d = increased(created(1000, 12), 100);
    expect(d.installmentResidue).toEqual({ amount: 16.71, forInstallment: 83.33, over: 13 });
    expect(installmentResidueOf(d)).toBe(0);
    expect(d.installmentCount).toBe(14);
    const r = payThrough(d);
    expect(r.amounts).toEqual([...Array(13).fill(83.33), 16.71]);
    expect(r.counts).toEqual(Array(14).fill(14));
  });

  it('زيادة بتتقسم بالظبط (6 × 83.33 = 499.98) ← زي ما هو: 18 وآخرها 83.37', () => {
    const d = increased(created(1000, 12), 499.98);
    expect(d.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 18 });
    expect(d.installmentCount).toBe(18);
    expect(payThrough(d).amounts[17]).toBe(83.37);
  });

  it('اقتراح القسط الأخير بعد الزيادة = المتبقي الحقيقي بالظبط', () => {
    let d = increased(created(1000, 12), 500);
    for (let i = 0; i < 17; i++) d = paid(d, 83.33).debt;
    expect(roundMoney(debtRemaining(d))).toBe(83.39);
    expect(suggestedInstallmentPayment(d)).toBe(83.39);
  });

  it('زيادتين 250 = زيادة 500 (الترتيب مالوش دعوة)', () => {
    const once = increased(created(1000, 12), 500);
    const twice = increased(increased(created(1000, 12), 250), 250);
    // بعد أول 250: 0.04 + 250 = 3 × 83.33 + 0.05 ← over 15 (0.05 ≤ 0.075)
    expect(twice.installmentResidue).toEqual(once.installmentResidue);
    expect(twice.installmentCount).toBe(18);
  });

  it('زيادة كسر + زيادة بتكمّله قسط تقريبًا ← بيتشال (مش بيتحسب من كل زيادة لوحدها)', () => {
    // +100 (كسر 16.71) وبعدين +66.68: 16.71 + 66.68 = 83.33 + 0.06 ← over 14، 0.06 ≤ 0.07
    const d = increased(increased(created(1000, 12), 100), 66.68);
    expect(d.installmentResidue).toEqual({ amount: 0.06, forInstallment: 83.33, over: 14 });
    expect(d.installmentCount).toBe(14);
    expect(payThrough(d).amounts[13]).toBe(83.39);
  });

  it('مسح الزيادة ← الفرق بيرجع زي ما كان بالظبط', () => {
    const start = created(1000, 12);
    const d = increased(start, 500, 'x');
    expect(d.installmentCount).toBe(18);
    const back = withoutIncrease(d, 'x');
    expect(back.installmentResidue).toEqual(start.installmentResidue);
    expect(back.installmentCount).toBe(12);
    // والتأكيد بيقول نفس العدد
    expect(debtEntryDeletePlan(d, 'increase', 'x')!.countAfter).toBe(12);
  });

  it('مسح واحدة من زيادتين ← نفس اللي كان هيحصل لو التانية لوحدها', () => {
    const both = increased(increased(created(1000, 12), 100, 'a'), 66.68, 'b');
    expect(both.installmentCount).toBe(14);
    expect(withoutIncrease(both, 'a').installmentResidue).toEqual(increased(created(1000, 12), 66.68).installmentResidue);
    expect(withoutIncrease(both, 'b').installmentResidue).toEqual(increased(created(1000, 12), 100).installmentResidue);
  });

  it('زيادة بعد تعديل العدد بإيد المستخدم ← على خطة التعديل', () => {
    // 1500، اتدفع 500، العدد بقى 4 ← 3 × 333.33 + 0.01
    let d = edited(paid(created(1500, 3), 500).debt, 4);
    // +666.66 = 2 × 333.33 ← over 5، الفرق 0.01 ← 6 أقساط وآخرها 333.34
    const exact = increased(d, 666.66);
    expect(exact.installmentResidue).toEqual({ amount: 0.01, forInstallment: 333.33, over: 5 });
    expect(exact.installmentCount).toBe(6);
    expect(payThrough(exact).amounts).toEqual([333.33, 333.33, 333.33, 333.33, 333.34]);
    // +500: 0.01 + 500 = 2 × 333.33 − 166.65 ← كسر حقيقي ← 6 وآخرها 166.68
    d = increased(d, 500);
    expect(installmentResidueOf(d)).toBe(0);
    expect(d.installmentCount).toBe(6);
    expect(payThrough(d).amounts).toEqual([333.33, 333.33, 333.33, 333.33, 166.68]);
  });

  it('دين قبل الفرق (قسط متخزّن من غير فرق) ← مفيش فرق بيتخمّن، والقاعدة القديمة', () => {
    const legacy = base({ totalAmount: 1000, installmentCount: 12, installmentAmount: 83.33 });
    expect(foldInstallmentResidue(legacy, 500)).toBeNull();
    const d = increased(legacy, 500);
    expect(d.installmentResidue).toBeUndefined();
    // القاعدة القديمة: ceil(1500 ÷ 83.33 − 0.005) = ceil(17.9957) = 18
    expect(d.installmentCount).toBe(18);
  });

  it('دين أقدم (من غير قسط متخزّن خالص) ← التثبيت بيدخل الزيادات اللي عليه في الخطة', () => {
    // 1000 على 12 قديم وعليه زيادة 500 من قبل: التثبيت = 12 × 83.33 + 0.04، + 500
    const legacy = base({ totalAmount: 1000, installmentCount: 12,
      increases: [{ id: 'old', date: '2025-06-01', amount: 500 }] as never });
    expect(pinInstallmentAmount(legacy)!.installmentResidue).toEqual({ amount: 0.06, forInstallment: 83.33, over: 18 });
    // ومسح الزيادة القديمة بعد التثبيت بيرجّع خطة الـ1000 بالظبط
    expect(withoutIncrease(legacy, 'old').installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12 });
  });

  it('خاصية: أي تسلسل زيادات ومسحها ← الفرق = لو الزيادات الفاضلة اتعملت مرة واحدة', () => {
    const xs = [500, 100, 66.68, 0.01, 333.34, 250, 1234.56];
    for (let i = 0; i < xs.length; i++) {
      let d = created(1000, 12);
      xs.forEach((x, j) => { d = increased(d, x, `k${j}`); });
      d = withoutIncrease(d, `k${i}`);
      const rest = xs.filter((_, j) => j !== i).reduce((a, b) => a + b, 0);
      // الخطة المتخزّنة بتقسّم المبلغ كله بالظبط: over × القسط + الفرق = 1000 + الزيادات
      const r = d.installmentResidue!;
      expect([i, roundMoney(r.over * r.forInstallment + r.amount)]).toEqual([i, roundMoney(1000 + rest)]);
      expect([i, d.installmentResidue]).toEqual([i, increased(created(1000, 12), roundMoney(rest)).installmentResidue]);
    }
  });
});

describe('مراجعة الزيادات (الجولة 1)', () => {
  it('نص قسط بالظبط: الترتيب مالوش دعوة (كان بيغلط بقسط كامل بالكسور)', () => {
    // money-reviewer: 3193.45 على 38 (84.04) وزيادات معينة ← 95.23 بدل 5.36
    const xs = [1321.48, 277.5, 2.47, 877.8, 1734.01, 1254.77];
    let one = created(3193.45, 38);
    xs.forEach(x => { one = increased(one, x); });
    const sum = increased(created(3193.45, 38), roundMoney(xs.reduce((a, b) => a + b, 0)));
    const reversed = [...xs].reverse().reduce((d, x) => increased(d, x), created(3193.45, 38));
    expect(one.installmentResidue).toEqual(sum.installmentResidue);
    expect(reversed.installmentResidue).toEqual(sum.installmentResidue);
    expect(one.installmentResidue).toEqual({ amount: 5.36, forInstallment: 84.04, over: 103 });
  });

  it('زيادة نص قسط بالظبط وبعدين مسحها ← نفس الحالة', () => {
    // 84.04 على 1 (فرق 0) + 42.02 (نص قسط) ← النص لفوق: over 2 وamount −42.02
    const d = increased(created(84.04, 1), 42.02, 'h');
    expect(d.installmentResidue).toEqual({ amount: -42.02, forInstallment: 84.04, over: 2 });
    expect(withoutIncrease(d, 'h').installmentResidue).toEqual({ amount: 0, forInstallment: 84.04, over: 1 });
  });

  it('مسح زيادة كبيرة قبل تعديل العدد ← over ممكن يبقى 0، بيتقري كسر حقيقي', () => {
    // 100 + زيادة 900، العدد اتعدّل لـ3: 1000 ÷ 3 = 333.33، فرق 0.01
    let d = edited(increased(created(100, 1), 900, 'big'), 3);
    expect(d.installmentResidue).toEqual({ amount: 0.01, forInstallment: 333.33, over: 3 });
    d = withoutIncrease(d, 'big');
    // 0.01 − 900 = −3 × 333.33 + 100 ← over 0، الباقي 100 كسر
    expect(d.installmentResidue).toEqual({ amount: 100, forInstallment: 333.33, over: 0 });
    expect(installmentResidueOf(d)).toBe(0);
    expect(d.installmentCount).toBe(1);
    expect(suggestedInstallmentPayment(d)).toBe(100);
  });

  it('خاصية: زيادات ومسح عشوائي ← زوّد وامسح بيرجّع نفس الحالة، والخطة = المبلغ', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let t = 0; t < 300; t++) {
      const total = roundMoney(1 + rnd() * 20000);
      const n = 1 + Math.floor(rnd() * 60);
      if (!planInstallments(total, n)) continue;
      let d = created(total, n);
      let sum = total;
      for (let k = 0; k < 5; k++) {
        const x = roundMoney(0.01 + rnd() * 3000);
        const before = d.installmentResidue;
        const up = increased(d, x, `z${t}_${k}`);
        expect(withoutIncrease(up, `z${t}_${k}`).installmentResidue).toEqual(before);
        d = up;
        sum = roundMoney(sum + x);
        const r = d.installmentResidue!;
        expect(roundMoney(r.over * r.forInstallment + r.amount)).toBe(sum);
        expect(Math.abs(r.amount)).toBeLessThanOrEqual(r.forInstallment + PIASTRE_EPS * n);
      }
    }
  });
});

describe('مراجعة الزيادات (الجولة 2)', () => {
  it('دين قديم عليه زيادة مبلغها مش رقم ← مفيش تثبيت (مش 0 ساكت)', () => {
    const legacy = base({ totalAmount: 1000, installmentCount: 12,
      increases: [{ id: 'bad', date: '2025-06-01', amount: 'x' }] as never });
    expect(pinInstallmentAmount(legacy)).toBeNull();
  });

  it('تأكيد مسح زيادة بمبلغ بايظ بيعدّ من غير الفرق — زي الكتابة اللي بتشيله', () => {
    // 100.04 على 11 (فرق 0.05): بالفرق 11، وبالقاعدة القديمة ceil(100.04 ÷ 9.09 − 0.005) = 12
    const d = { ...created(100.04, 11), increases: [{ id: 'bad', date: '2026-03-01', amount: 'x' }] } as unknown as Debt;
    expect(foldInstallmentResidue(d, -Number('x'))).toBeNull();
    // الكتابة بتشيل الفرق (residueAfterIncreaseChange) ← 12؛ التأكيد لازم يقول نفس الرقم
    const plan = debtEntryDeletePlan(d, 'increase', 'bad')!;
    expect([plan.countBefore, plan.countAfter]).toEqual([11, 12]);
  });
});

describe('DataContext (المراجعة الجولة 2)', () => {
  const { readFileSync } = require('fs');
  const src: string = readFileSync('context/DataContext.tsx', 'utf8');
  const body = (name: string) => {
    const start = src.indexOf(`  async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('\n  }\n', start));
  };

  it.each(['addDebtPayment', 'addDebtIncrease'])('%s بيقرّب المبلغ للقرش قبل أي كتابة', (name) => {
    const b = body(name);
    // بقى `toMoneyAmount` (التقريب وبعدين الفحص — finance.moneyInput.test)
    const at = b.indexOf('const money = toMoneyAmount(amount);');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(b.indexOf('runTransaction('));
  });

  it('كل كتابة لعدد الأقساط محروسة (countToWrite ← storableCount)', () => {
    expect(src).not.toMatch(/patch\.installmentCount = (recount|nextCount)/);
    expect(src).toMatch(/if \(!storableCount\(next\)\) \{\n\s+noteOnce\(`count:/);
  });
});
