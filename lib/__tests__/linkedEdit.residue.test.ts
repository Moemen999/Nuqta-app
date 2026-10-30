import type { Debt } from '@/context/DataContext';
import {
  foldInstallmentResidue, installmentCountFor, installmentResidueOf, pinInstallmentAmount, planInstallments,
  stampResidue, suggestedInstallmentPayment, debtRemaining,
} from '@/lib/finance';
import { debtLinkedEditPlan } from '@/lib/linkedEdit';

/**
 * فرق تقريب القسط في تعديل عملية مربوطة بدين أقساط (بند 8).
 *
 * الباج: تعديل عملية الأصل أو الزيادة كان بيغيّر الإجمالي ويعدّ الأقساط من جديد،
 * لكن `installmentResidue` (فرق التقريب المتخزّن) كان بيفضل على الخطة القديمة.
 * 1000 على 12 (قسط 83.33، فرق 0.04 على 12) لما الأصل يتعدّل لـ2000 كان العدد
 * يطلع 25 بدل 24، لأن 0.04 اتعامل كأنه فرق خطة 2000 وهو مش كده. نفس الحاجة
 * مسار الزيادة (`addDebtIncrease`) بيعمل صح: بيطوي الفرق بـ`foldInstallmentResidue`.
 *
 * العقد: للأصل والزيادة، لو الفرق معروف ← الفرق الجديد = الطي بمقدار (المبلغ
 * الجديد − القديم) والعدد يتحسب بيه؛ لو الطي رجّع null ← `clearResidue`؛ لو
 * العدد مش قابل للتخزين ← `countNotStorable` ومفيش `installmentCount` في الـpatch.
 * الدفعة عمرها ما بتغيّر الفرق.
 */

const baseDebt = (over: Partial<Debt> = {}) => ({
  id: 'd1', personName: 'أحمد', direction: 'i_owe', isInstallment: true, totalAmount: 1000,
  date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z',
  initialTransactionId: 'tx_init', initialWalletId: 'w1',
  payments: [], increases: [],
  ...over,
}) as unknown as Debt;

/** نفس `addDebt` */
function created(total: number, n: number, over: Partial<Debt> = {}): Debt {
  const plan = planInstallments(total, n)!;
  return baseDebt({
    totalAmount: total, installmentCount: n, installmentAmount: plan.value,
    installmentResidue: stampResidue({ amount: plan.residue, forInstallment: plan.value, over: n }, [])!, ...over,
  });
}

const next = (amount: number, over: Record<string, unknown> = {}) => ({ amount, walletId: 'w1', date: '2026-01-01', ...over });

type Plan = NonNullable<ReturnType<typeof debtLinkedEditPlan>> & { clearResidue?: boolean; countNotStorable?: boolean };
const plan = (d: Debt, txId: string, amount: number, over: Record<string, unknown> = {}) =>
  debtLinkedEditPlan(d, txId, next(amount, over), '2026-01-15') as Plan;

/** 1000 على 12 + زيادة 500 (الفرق بعد الزيادة بنفس طي مسار الزيادة) */
function withIncrease(): Debt {
  const d0 = created(1000, 12);
  const entry = { id: 'i1', date: '2026-01-10', amount: 500, walletId: 'w1', transactionId: 'tx_i1' };
  const residue = foldInstallmentResidue(d0, { kind: 'increase', delta: 500, increasesAfter: [entry] })!;
  return baseDebt({
    ...d0, increases: [entry],
    installmentResidue: residue, installmentCount: 18,
  } as Partial<Debt>);
}

describe('تعديل الأصل — الفرق بيتطوي', () => {
  it('1000 على 12 ← 2000: الفرق {0.08، 83.33، 24} والعدد 24 (مش 25)', () => {
    const d = created(1000, 12);
    expect(d.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12, increasesTotal: 0 });
    const p = plan(d, 'tx_init', 2000);
    // البصمة (D2): الزيادات مااتغيّرتش بتعديل الأصل ← 0 زي ما كانت
    expect(p.patch.installmentResidue).toEqual({ amount: 0.08, forInstallment: 83.33, over: 24, increasesTotal: 0 });
    expect(p.patch.installmentResidue).toEqual(foldInstallmentResidue(d, { kind: 'initial', delta: 1000 }));
    expect(p.patch.installmentCount).toBe(24);
    expect(p.countAfter).toBe(24);
    expect(p.countBefore).toBe(12);
    expect(p.clearResidue).toBeFalsy();
  });

  it('العدد بعد التعديل = العدد المحسوب بالفرق الجديد', () => {
    const d = created(1000, 12);
    const p = plan(d, 'tx_init', 2000);
    expect(installmentCountFor(p.debtAfter)).toBe(24);
    expect(installmentResidueOf(p.debtAfter)).toBe(0.08);
  });

  it('التعديل لأقل (1000 ← 500) بيطوي بالسالب', () => {
    const d = created(1000, 12);
    const p = plan(d, 'tx_init', 500);
    expect(p.patch.installmentResidue).toEqual(foldInstallmentResidue(d, { kind: 'initial', delta: -500 }));
    expect(p.patch.installmentCount).toBe(installmentCountFor({ ...d, ...p.patch } as Debt));
  });

  it('مبلغ بنفس القيمة (1000 ← 1000): الفرق زي ما هو والعدد زي ما هو', () => {
    const d = created(1000, 12);
    const p = plan(d, 'tx_init', 1000);
    expect(p.patch.installmentResidue).toEqual(d.installmentResidue);
    expect(p.countAfter).toBe(12);
  });

  it('البصمة (D2): تعديل الأصل مبيغيّرش بصمة الزيادات، وتعديل الزيادة بيغيّرها لمجموعها الجديد', () => {
    const d = withIncrease();
    expect(d.installmentResidue!.increasesTotal).toBe(500);
    // الأصل 1000 ← 2000: الزيادات لسه 500 ← البصمة 500 والفرق لسه مقبول
    const origin = plan(d, 'tx_init', 2000);
    expect((origin.patch.installmentResidue as { increasesTotal: number }).increasesTotal).toBe(500);
    expect(installmentResidueOf(origin.debtAfter)).not.toBeNull();
    // الزيادة 500 ← 600: البصمة 600 (مجموع الزيادات في نفس الكتابة)
    const inc = plan(d, 'tx_i1', 600);
    expect((inc.patch.installmentResidue as { increasesTotal: number }).increasesTotal).toBe(600);
    expect(installmentResidueOf(inc.debtAfter)).not.toBeNull();
  });

  it('دين قديم من غير قسط متخزّن: التثبيت بيحصل والفرق بيتطوي من الدين المثبّت', () => {
    const d = baseDebt({ totalAmount: 1000, installmentCount: 12 });
    const pin = pinInstallmentAmount(d)!;
    expect(pin).not.toBeNull();
    const p = plan(d, 'tx_init', 2000);
    expect(p.patch.installmentAmount).toBe(pin.installmentAmount);
    expect(p.patch.installmentResidue).toEqual(foldInstallmentResidue({ ...d, ...pin }, { kind: 'initial', delta: 1000 }));
    expect(p.patch.installmentCount).toBe(24);
  });
});

describe('تعديل الزيادة — الفرق بيتطوي', () => {
  it('زيادة 500 ← 600: الفرق = طي الدين بـ+100', () => {
    const d = withIncrease();
    expect(d.installmentResidue!.over).toBe(18);
    const p = plan(d, 'tx_i1', 600);
    expect(p.role).toBe('increase');
    expect(p.patch.installmentResidue).toEqual(
      foldInstallmentResidue(d, { kind: 'increase', delta: 100, increasesAfter: [{ ...d.increases[0], amount: 600 }] }),
    );
    // والبصمة = مجموع الزيادات الجديد
    expect((p.patch.installmentResidue as { increasesTotal: number }).increasesTotal).toBe(600);
    expect(p.clearResidue).toBeFalsy();
    expect(p.patch.installmentCount).toBe(installmentCountFor({ ...d, ...p.patch } as Debt));
  });

  it('زيادة 500 ← 600 ثم مسحها ترجّع {0.04، 83.33، 12}', () => {
    const d = withIncrease();
    const p = plan(d, 'tx_i1', 600);
    const afterEdit = p.debtAfter;
    // مسح الزيادة = طي بمقدار −600 (مسار الحذف بيطوي بالسالب)
    const afterDelete = foldInstallmentResidue(afterEdit, { kind: 'increase', delta: -600, increasesAfter: [] });
    expect(afterDelete).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12, increasesTotal: 0 });
  });

  it('رجوع ذهاب وإياب: X ← Y ثم Y ← X بيرجّع الفرق الأصلي بالظبط', () => {
    const d = withIncrease();
    const original = d.installmentResidue;
    const p1 = plan(d, 'tx_i1', 733.37);
    const p2 = plan(p1.debtAfter, 'tx_i1', 500);
    expect(p2.patch.installmentResidue).toEqual(original);
    expect(p2.debtAfter.installmentResidue).toEqual(original);
  });
});

describe('الفرق معروف والطي رجّع null', () => {
  it('clearResidue = true ومفيش مفتاح installmentResidue في الـpatch، والعدد بالقاعدة القديمة', () => {
    // مبلغ ضخم: الطي بالقروش يفوق الأعداد الآمنة ← null
    const d = created(1000, 12);
    expect(foldInstallmentResidue(d, { kind: 'initial', delta: 1e20 })).toBeNull();
    const p = plan(d, 'tx_init', 1e20);
    expect(p.clearResidue).toBe(true);
    expect('installmentResidue' in p.patch).toBe(false);
  });
});

describe('الفرق مش معروف', () => {
  it('قسط متخزّن من غير فرق: مفيش كتابة فرق ولا clearResidue', () => {
    const d = baseDebt({ totalAmount: 1000, installmentCount: 12, installmentAmount: 83.33 });
    expect(pinInstallmentAmount(d)).toBeNull();
    const p = plan(d, 'tx_init', 2000);
    expect('installmentResidue' in p.patch).toBe(false);
    expect(p.clearResidue).toBeFalsy();
  });

  // silent-failure-hunter (جولة 1 على خطوة 2): فرق متجاهَل لأنه فوق الإجمالي القديم كان
  // ممكن يبقى "سليم" بعد ما التعديل يكبّر الإجمالي، ويتعدّ بأرقام قديمة ← بيتشال صريح
  it('فرق متجاهَل (بتاع قسط تاني) + تعديل الأصل: بيتشال صريح (clearIgnoredResidue)، مش طيّ ولا فشل طيّ', () => {
    const d = baseDebt({
      totalAmount: 1000, installmentCount: 12, installmentAmount: 83.33,
      installmentResidue: { amount: 0.04, forInstallment: 90, over: 12, increasesTotal: 0 },
    });
    const p = plan(d, 'tx_init', 2000) as Plan & { clearIgnoredResidue?: boolean };
    expect('installmentResidue' in p.patch).toBe(false);
    expect(p.clearIgnoredResidue).toBe(true);
    expect(p.clearResidue).toBeFalsy();
    expect(p.debtAfter.installmentResidue).toBeUndefined();
  });

  it('فرق فوق الإجمالي القديم (متجاهَل) والتعديل كبّر الإجمالي: مبيتعدّش بيه', () => {
    // 12 × 83.33 + 500 = 1499.96 > 1000 ← متجاهَل قبل التعديل، وبعد 2000 كان هيعدّي
    const d = baseDebt({
      totalAmount: 1000, installmentCount: 12, installmentAmount: 83.33,
      installmentResidue: { amount: 500, forInstallment: 83.33, over: 12, increasesTotal: 0 },
    });
    const p = plan(d, 'tx_init', 2000) as Plan & { clearIgnoredResidue?: boolean };
    expect(p.clearIgnoredResidue).toBe(true);
    expect('installmentResidue' in p.patch).toBe(false);
  });

  it('دين مش قسط: مفيش فرق ولا عدد', () => {
    const d = baseDebt({ isInstallment: false });
    const p = plan(d, 'tx_init', 2000);
    expect('installmentResidue' in p.patch).toBe(false);
    expect('installmentCount' in p.patch).toBe(false);
    expect(p.clearResidue).toBeFalsy();
  });
});

describe('الدفعة — الفرق عمره ما بيتغيّر', () => {
  it('تعديل دفعة: مفيش installmentResidue في الـpatch (دين جديد)', () => {
    const d = created(1000, 12, {
      payments: [{ id: 'p1', date: '2026-01-05', amount: 83.33, walletId: 'w1', transactionId: 'tx_p1' }],
    } as Partial<Debt>);
    const p = plan(d, 'tx_p1', 50);
    expect(p.role).toBe('payment');
    expect('installmentResidue' in p.patch).toBe(false);
    expect(p.clearResidue).toBeFalsy();
    expect(p.debtAfter.installmentResidue).toEqual(d.installmentResidue);
  });

  it('تعديل دفعة على دين قديم: الفرق من التثبيت بس', () => {
    const d = baseDebt({
      totalAmount: 1000, installmentCount: 12,
      payments: [{ id: 'p1', date: '2026-01-05', amount: 83.33, walletId: 'w1', transactionId: 'tx_p1' }],
    });
    const pin = pinInstallmentAmount(d)!;
    const p = plan(d, 'tx_p1', 50);
    expect(p.patch.installmentResidue).toEqual(pin.installmentResidue);
  });
});

describe('عدد مش قابل للتخزين', () => {
  it('الأصل 1e300: مفيش installmentCount في الـpatch وcountNotStorable = true والعدد القديم', () => {
    const d = created(1000, 12);
    const p = plan(d, 'tx_init', 1e300);
    expect('installmentCount' in p.patch).toBe(false);
    expect(p.countNotStorable).toBe(true);
    expect(p.countAfter).toBe(12);
  });

  it('عدد عادي: countNotStorable مش متفعّل', () => {
    const p = plan(created(1000, 12), 'tx_init', 2000);
    expect(p.countNotStorable).toBeFalsy();
  });
});

describe('الاقتراح بعد تعديل الأصل', () => {
  it('2000 على 24 و23 دفعة 83.33: الاقتراح 83.41 وفاضل قسط واحد', () => {
    const d = created(1000, 12);
    const p = plan(d, 'tx_init', 2000);
    const payments = Array.from({ length: 23 }, (_, i) => ({
      id: `p${i}`, date: '2026-02-01', amount: 83.33, walletId: 'w1',
    }));
    const after = { ...p.debtAfter, payments } as Debt;
    expect(debtRemaining(after)).toBeCloseTo(83.41, 2);
    expect(suggestedInstallmentPayment(after)).toBe(83.41);
    expect(installmentCountFor(after)).toBe(24);
  });
});
