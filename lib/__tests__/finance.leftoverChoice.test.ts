import type { Debt } from '@/context/DataContext';
import { installmentsPhrase } from '@/lib/archiving';
import {
  absorbLeftover, debtRemaining, foldInstallmentResidue, increaseLeftoverChoice, installmentCountFor,
  installmentResidueKnown, installmentResidueOf, lastInstalmentOf, pinInstallmentAmount, planInstallments,
  leftoverSeen, residueForIncrease, sameLeftoverSeen, stampResidue, suggestedInstallmentPayment, transactionDeleteDebtPlan, type InstallmentResidue,
} from '@/lib/finance';
import { debtLinkedEditPlan } from '@/lib/linkedEdit';

/**
 * بند 8 — D1 (قرار مؤمن 2026-10-30): زيادة على دين أقساط سابت باقي أقل من قسط ومش
 * تقريب قروش ← بنسأل كل مرة: "يتضاف على آخر قسط" ولا "قسط منفصل في الآخر".
 *
 * العلم `lastAbsorbs` على الفرق المتخزّن بس (مش على الخطة): الرقمين {amount، over}
 * واحد في الاتنين، والعلم بيغيّر العدّ بس.
 *
 * الأمثلة: 1000 على 12، قسط 83.33، فرق 0.04 على 12، بصمة 0.
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

const entry = (amount: number, id = 'i1') => ({ id, date: '2026-01-10', amount, walletId: 'w1', transactionId: `tx_${id}` });

/** الدين بعد زيادة بالطريقة اللي المسار بيكتب بيها (مع العدد المحسوب) */
function afterIncrease(d: Debt, amount: number, mode?: 'absorb' | 'separate'): Debt {
  const e = entry(amount);
  const residue = residueForIncrease(d, amount, [e], mode)!;
  const next = { ...d, increases: [e], installmentResidue: residue } as Debt;
  return { ...next, installmentCount: installmentCountFor(next)! } as Debt;
}

const withFlag = (r: InstallmentResidue): InstallmentResidue => ({ ...r, lastAbsorbs: true } as InstallmentResidue);

describe('installmentsPhrase', () => {
  it.each([
    [1, 'قسط واحد'], [2, 'قسطين'], [3, '3 أقساط'], [10, '10 أقساط'], [11, '11 قسط'], [13, '13 قسط'], [24, '24 قسط'],
  ])('%i ← %s', (n, expected) => {
    expect(installmentsPhrase(n)).toBe(expected);
  });
});

describe('increaseLeftoverChoice — الأمثلة المتفق عليها', () => {
  const d = created(1000, 12);

  it('+100 ← الباقي 16.71: يتضاف = 13 قسط وآخرهم 100.04، منفصل = 14 وآخرهم 16.71', () => {
    const c = increaseLeftoverChoice(d, 100)!;
    expect(c).not.toBeNull();
    expect(c.leftover).toBeCloseTo(16.71, 2);
    expect(c.value).toBe(83.33);
    expect(c.absorb.count).toBe(13);
    expect(c.absorb.last).toBeCloseTo(100.04, 2);
    expect(c.separate.count).toBe(14);
    expect(c.separate.last).toBeCloseTo(16.71, 2);
  });

  it('+0.03 ← الباقي 0.07 (حتى لو صغير بيتسأل): يتضاف 12 وآخرهم 83.40، منفصل 13 وآخرهم 0.07', () => {
    const c = increaseLeftoverChoice(d, 0.03)!;
    expect(c).not.toBeNull();
    expect(c.leftover).toBeCloseTo(0.07, 2);
    expect(c.absorb).toEqual({ count: 12, last: expect.closeTo(83.4, 2) });
    expect(c.separate).toEqual({ count: 13, last: expect.closeTo(0.07, 2) });
  });

  it('+60 ← الفرق المتخزّن سالب (-23.29): الباقي 60.04، يتضاف 12 وآخرهم 143.37، منفصل 13 وآخرهم 60.04', () => {
    const c = increaseLeftoverChoice(d, 60)!;
    expect(c).not.toBeNull();
    expect(c.leftover).toBeCloseTo(60.04, 2);
    expect(c.absorb.count).toBe(12);
    expect(c.absorb.last).toBeCloseTo(143.37, 2);
    expect(c.separate.count).toBe(13);
    expect(c.separate.last).toBeCloseTo(60.04, 2);
  });

  it('+0.01 ← تقريب قروش بس ← مفيش سؤال', () => {
    expect(increaseLeftoverChoice(d, 0.01)).toBeNull();
  });

  it('+500 ← الباقي تقريب (القسط الأخير بيشيله زي الإنشاء) ← مفيش سؤال', () => {
    expect(increaseLeftoverChoice(d, 500)).toBeNull();
  });

  it('مضاعف القسط بالظبط (+83.33) ← تقريب بس ← مفيش سؤال', () => {
    expect(increaseLeftoverChoice(d, 83.33)).toBeNull();
  });
});

describe('increaseLeftoverChoice — مفيش سؤال', () => {
  it('الدين مش قسط', () => {
    const plain = baseDebt({ isInstallment: false, installmentCount: undefined });
    expect(increaseLeftoverChoice(plain, 100)).toBeNull();
  });

  it('مفيش فرق معروف (دين قديم من غير installmentResidue) ← القاعدة القديمة', () => {
    const legacy = baseDebt({ installmentCount: 12, installmentAmount: 83.33 });
    expect(increaseLeftoverChoice(legacy, 100)).toBeNull();
  });

  it('فرق متجاهَل (بتاع قسط تاني) ← مفيش سؤال', () => {
    const d = created(1000, 12);
    const other = { ...d, installmentResidue: { ...d.installmentResidue!, forInstallment: 70 } } as Debt;
    expect(installmentResidueKnown(other)).toBe(false);
    expect(increaseLeftoverChoice(other, 100)).toBeNull();
  });

  it('مبلغ مش رقم حقيقي ← null (الطيّ بيفشل)', () => {
    const d = created(1000, 12);
    expect(increaseLeftoverChoice(d, NaN)).toBeNull();
    expect(increaseLeftoverChoice(d, Infinity)).toBeNull();
  });

  it('مبلغ صفر ← مفيش باقي جديد ← null', () => {
    expect(increaseLeftoverChoice(created(1000, 12), 0)).toBeNull();
  });
});

describe('lastInstalmentOf', () => {
  it('دين من غير دفعات: الإجمالي بالزيادات − (العدد−1) × القسط', () => {
    expect(lastInstalmentOf(created(1000, 12))).toBeCloseTo(83.37, 2);
    expect(lastInstalmentOf(afterIncrease(created(1000, 12), 100, 'absorb'))).toBeCloseTo(100.04, 2);
    expect(lastInstalmentOf(afterIncrease(created(1000, 12), 100, 'separate'))).toBeCloseTo(16.71, 2);
  });

  it('بعد 12 دفعة: المتبقي نفسه (قسط واحد فاضل)', () => {
    const d0 = afterIncrease(created(1000, 12), 100, 'absorb');
    const payments = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, amount: 83.33, date: '2026-02-01', walletId: 'w1' }));
    expect(lastInstalmentOf({ ...d0, payments } as Debt)).toBeCloseTo(100.04, 2);
  });

  it('مش قسط أو من غير قيمة قسط ← null', () => {
    expect(lastInstalmentOf(baseDebt({ isInstallment: false }))).toBeNull();
    expect(lastInstalmentOf(baseDebt({ installmentCount: 12 }))).toBeNull();
  });
});

describe('absorbLeftover والعلم lastAbsorbs', () => {
  const folded = (amount: number) => foldInstallmentResidue(created(1000, 12), { kind: 'increase', delta: amount, increasesAfter: [entry(amount)] })!;

  it('الطيّ الأصلي مبيحطش علم، وabsorbLeftover هي الطريق الوحيد ليه', () => {
    expect((folded(100) as { lastAbsorbs?: true }).lastAbsorbs).toBeUndefined();
    const a = absorbLeftover(folded(100))!;
    expect(a).toEqual({ amount: 16.71, forInstallment: 83.33, over: 13, increasesTotal: 100, lastAbsorbs: true });
  });

  it('الأرقام مش بتتطبّع: A وB بيخزّنوا نفس {amount، over}', () => {
    const d = created(1000, 12);
    const a = residueForIncrease(d, 100, [entry(100)], 'absorb')!;
    const b = residueForIncrease(d, 100, [entry(100)], 'separate')!;
    expect({ amount: a.amount, over: a.over }).toEqual({ amount: b.amount, over: b.over });
    expect(a).toMatchObject({ lastAbsorbs: true });
    expect((b as { lastAbsorbs?: true }).lastAbsorbs).toBeUndefined();
  });

  it('سالب (-23.29 على 13) ← العلم يتحط', () => {
    const a = absorbLeftover(folded(60))!;
    expect(a).toMatchObject({ amount: -23.29, over: 13, lastAbsorbs: true });
  });

  it('فرق تقريب بس (0.05 على 12) ← null', () => {
    expect(absorbLeftover(folded(0.01))).toBeNull();
  });

  it.each([
    ['صفر', { amount: 0, over: 12 }],
    ['موجب أكبر من القسط', { amount: 83.33, over: 13 }],
    ['سالب أكبر من القسط', { amount: -90, over: 13 }],
    ['موجب وover صفر', { amount: 10, over: 0 }],
    ['سالب وover واحد', { amount: -10, over: 1 }],
  ])('شرط مش متحقق (%s) ← null', (_n, over) => {
    const r = { forInstallment: 83.33, increasesTotal: 0, ...over } as InstallmentResidue;
    expect(absorbLeftover(r)).toBeNull();
  });
});

describe('العدّ مع العلم', () => {
  const d0 = created(1000, 12);

  it('A على +100: العدد 13 والمتبقي 1100 وـinstallmentResidueOf = الباقي 16.71', () => {
    const d = afterIncrease(d0, 100, 'absorb');
    expect(installmentCountFor(d)).toBe(13);
    expect(installmentResidueOf(d)).toBeCloseTo(16.71, 2);
    expect(d.installmentCount).toBe(13);
  });

  it('B على +100: العدد 14 ومفيش علم (سلوك النهارده)', () => {
    const d = afterIncrease(d0, 100, 'separate');
    expect(installmentCountFor(d)).toBe(14);
    expect(installmentResidueOf(d)).toBe(0);
  });

  it('A على +60 (سالب): العدد 12 وinstallmentResidueOf = amount + القسط = 60.04', () => {
    const d = afterIncrease(d0, 60, 'absorb');
    expect(installmentCountFor(d)).toBe(12);
    expect(installmentResidueOf(d)).toBeCloseTo(60.04, 2);
    expect(installmentCountFor(afterIncrease(d0, 60, 'separate'))).toBe(13);
  });

  it('A على +0.03: العدد 12 (مش 13)', () => {
    expect(installmentCountFor(afterIncrease(d0, 0.03, 'absorb'))).toBe(12);
    expect(installmentCountFor(afterIncrease(d0, 0.03, 'separate'))).toBe(13);
  });

  it('بعد A على +100 و12 دفعة بـ83.33: المتبقي 100.04، قسط واحد فاضل، الاقتراح 100.04', () => {
    const d = afterIncrease(d0, 100, 'absorb');
    const payments = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, amount: 83.33, date: '2026-02-01', walletId: 'w1' }));
    const paid = { ...d, payments } as Debt;
    expect(debtRemaining(paid)).toBeCloseTo(100.04, 2);
    expect(installmentCountFor(paid)).toBe(13);
    expect(suggestedInstallmentPayment(paid)).toBeCloseTo(100.04, 2);
  });

  it('B بعد 12 دفعة: فاضل قسطين (83.33 ثم 16.71) والاقتراح القسط', () => {
    const d = afterIncrease(d0, 100, 'separate');
    const payments = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, amount: 83.33, date: '2026-02-01', walletId: 'w1' }));
    const paid = { ...d, payments } as Debt;
    expect(installmentCountFor(paid)).toBe(14);
    expect(suggestedInstallmentPayment(paid)).toBe(83.33);
  });
});

describe('storedResidue بيتحقق من العلم', () => {
  const d0 = created(1000, 12);
  const base = (flag: unknown, over: Partial<InstallmentResidue> = {}): Debt => {
    const r = { amount: 16.71, forInstallment: 83.33, over: 13, increasesTotal: 100, ...over, lastAbsorbs: flag } as unknown as InstallmentResidue;
    return { ...d0, increases: [entry(100)], installmentResidue: r, installmentCount: 13 } as Debt;
  };

  it('true بالظبط ← مقبول', () => {
    expect(installmentResidueKnown(base(true))).toBe(true);
    expect(installmentResidueOf(base(true))).toBeCloseTo(16.71, 2);
  });

  it.each([['"true"', 'true'], ['1', 1], ['false', false], ['{}', {}], ['null', null]])('علم %s ← الفرق كله متجاهَل', (_n, flag) => {
    const d = base(flag);
    expect(installmentResidueKnown(d)).toBe(false);
    expect(installmentResidueOf(d)).toBeNull();
  });

  it('علم + amount صفر ← متجاهَل', () => {
    expect(installmentResidueKnown(base(true, { amount: 0 }))).toBe(false);
  });

  it('علم + |amount| ≥ القسط ← متجاهَل', () => {
    expect(installmentResidueKnown(base(true, { amount: 83.33 }))).toBe(false);
    expect(installmentResidueKnown(base(true, { amount: -83.33 }))).toBe(false);
  });

  it('علم + موجب وover صفر ← متجاهَل، وسالب وover واحد ← متجاهَل', () => {
    expect(installmentResidueKnown(base(true, { amount: 10, over: 0 }))).toBe(false);
    expect(installmentResidueKnown(base(true, { amount: -10, over: 1 }))).toBe(false);
  });

  it('علم + سالب وover 2 ← مقبول، والفرق = amount + القسط', () => {
    const d = base(true, { amount: -23.29, over: 2 });
    expect(installmentResidueKnown(d)).toBe(true);
    expect(installmentResidueOf(d)).toBeCloseTo(60.04, 2);
  });

  it('علم على فرق تقريب (0.04 على 12): نفس العدّ من غيره', () => {
    const plain = { ...d0 } as Debt;
    const flagged = { ...d0, installmentResidue: { ...d0.installmentResidue!, lastAbsorbs: true } } as Debt;
    expect(installmentResidueOf(flagged)).toBe(installmentResidueOf(plain));
    expect(installmentCountFor(flagged)).toBe(installmentCountFor(plain));
  });
});

describe('الطيّ والعلم', () => {
  const d0 = created(1000, 12);
  // lazy: لو الدالة لسه مش موجودة الفشل يبقى في الاختبارات مش في تحميل الملف
  let dA: Debt;
  beforeEach(() => { dA = afterIncrease(d0, 100, 'absorb'); });
  const hasFlag = (r: unknown) => (r as { lastAbsorbs?: unknown } | null)?.lastAbsorbs === true;

  it('delta صفر (تعديل تاريخ الزيادة بس) ← العلم بيفضل، وبتتعاد البصمة', () => {
    const r = foldInstallmentResidue(dA, { kind: 'increase', delta: 0, increasesAfter: [{ ...entry(100), date: '2026-01-20' }] })!;
    expect(hasFlag(r)).toBe(true);
    expect(r).toMatchObject({ amount: 16.71, over: 13, increasesTotal: 100 });
  });

  it('delta صفر من تعديل الأصل ← العلم بيفضل', () => {
    expect(hasFlag(foldInstallmentResidue(dA, { kind: 'initial', delta: 0 }))).toBe(true);
  });

  it('أي delta مش صفر ← العلم بيتشال', () => {
    const r = foldInstallmentResidue(dA, { kind: 'increase', delta: 10, increasesAfter: [entry(110)] })!;
    expect(r).not.toBeNull();
    expect(hasFlag(r)).toBe(false);
    expect(hasFlag(foldInstallmentResidue(dA, { kind: 'initial', delta: 1000 }))).toBe(false);
  });

  it('A ثم مسح الزيادة ← الفرق الأصلي {0.04، 12، بصمة 0} من غير علم، والعدد 12', () => {
    const plan = transactionDeleteDebtPlan(dA, 'tx_i1')!;
    expect(plan.residue).toEqual({ op: 'set', value: { amount: 0.04, forInstallment: 83.33, over: 12, increasesTotal: 0 } });
    expect(hasFlag(plan.residue && plan.residue.op === 'set' ? plan.residue.value : null)).toBe(false);
    expect(plan.countAfter).toBe(12);
  });

  it('A ثم مسح الزيادة بالطيّ المباشر ← نفس النتيجة', () => {
    const r = foldInstallmentResidue(dA, { kind: 'increase', delta: -100, increasesAfter: [] })!;
    expect(r).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12, increasesTotal: 0 });
  });

  it('A ثم تعديل تاريخ الزيادة بس (debtLinkedEditPlan) ← العلم بيفضل والعدد 13', () => {
    const p = debtLinkedEditPlan(dA, 'tx_i1', { amount: 100, walletId: 'w1', date: '2026-01-25' }, '2026-01-30')!;
    expect(hasFlag(p.patch.installmentResidue)).toBe(true);
    expect(installmentCountFor(p.debtAfter)).toBe(13);
  });

  it('A ثم تعديل مبلغ الزيادة ← العلم بيتشال', () => {
    const p = debtLinkedEditPlan(dA, 'tx_i1', { amount: 110, walletId: 'w1', date: '2026-01-10' }, '2026-01-30')!;
    expect(hasFlag(p.patch.installmentResidue)).toBe(false);
  });
});

describe('residueForIncrease', () => {
  const d = created(1000, 12);

  it('من غير mode = الطيّ نفسه (سلوك النهارده)', () => {
    expect(residueForIncrease(d, 100, [entry(100)])).toEqual(
      foldInstallmentResidue(d, { kind: 'increase', delta: 100, increasesAfter: [entry(100)] }));
  });

  it('absorb من غير سؤال (تقريب بس +0.01) ← من غير علم', () => {
    const r = residueForIncrease(d, 0.01, [entry(0.01)], 'absorb')!;
    expect((r as { lastAbsorbs?: unknown }).lastAbsorbs).toBeUndefined();
  });

  it('مفيش فرق معروف ← null حتى مع absorb', () => {
    const legacy = baseDebt({ installmentCount: 12, installmentAmount: 83.33 });
    expect(residueForIncrease(legacy, 100, [entry(100)], 'absorb')).toBeNull();
  });

  it('pin ما يغيّرش حاجة: دين قديم بعد pinInstallmentAmount بيدّي نفس سؤال دين جديد', () => {
    const legacy = baseDebt({ installmentCount: 12 });
    const pin = pinInstallmentAmount(legacy)!;
    const pinned = { ...legacy, ...pin } as Debt;
    const c = increaseLeftoverChoice(pinned, 100);
    expect(c).not.toBeNull();
    expect(c!.absorb.count).toBe(13);
  });
});

/**
 * جولة 1 (money-reviewer، BLOCKER): دفعة مختلفة عن القسط قبل الزيادة بتحرّك الذيل الحقيقي،
 * فالباقي المعروض لازم يبقى هو آخر قسط لو اتفصل — مش فرق الخطة (16.71)
 */
describe('increaseLeftoverChoice — دفعات مختلفة عن القسط قبل الزيادة', () => {
  const pay = (amount: number) => ({ id: 'p1', date: '2026-01-05', amount, walletId: 'w1', transactionId: 'tx_p1' });

  it.each([
    [100, 0.04, 83.37],
    [90, 10.04, 93.37],
    [83.33, 16.71, 100.04],
  ])('دفعة %d ثم +100 ← الباقي %d = آخر قسط "منفصل"، و"يتضاف" آخره %d', (paid, tail, absorbLast) => {
    const d = created(1000, 12, { payments: [pay(paid)] } as Partial<Debt>);
    const c = increaseLeftoverChoice({ ...d, ...pinInstallmentAmount(d) }, 100)!;
    expect(c.leftover).toBe(tail);
    expect(c.separate.last).toBe(tail);
    expect(c.absorb.last).toBe(absorbLast);
    // اللي هيتكتب بيدّي نفس الأرقام اللي اتعرضت
    for (const mode of ['absorb', 'separate'] as const) {
      const e = entry(100);
      const pinned = { ...d, ...pinInstallmentAmount(d) } as Debt;
      const next = { ...pinned, increases: [e], installmentResidue: residueForIncrease(pinned, 100, [e], mode)! } as Debt;
      const count = installmentCountFor(next)!;
      expect(count).toBe(c[mode].count);
      expect(lastInstalmentOf({ ...next, installmentCount: count } as Debt)).toBe(c[mode].last);
    }
  });
});

describe('sameLeftoverSeen — الذرة بتقارن الباقي والعدد وآخر قسط', () => {
  const d = created(1000, 12);
  const c = increaseLeftoverChoice({ ...d, ...pinInstallmentAmount(d) }, 100)!;

  it('نفس اللي اتشاف ← true للاختيارين', () => {
    expect(sameLeftoverSeen(c, leftoverSeen(c, 'absorb'))).toBe(true);
    expect(sameLeftoverSeen(c, leftoverSeen(c, 'separate'))).toBe(true);
  });
  it('الباقي نفسه والعدد أو آخر قسط مختلف ← false', () => {
    expect(sameLeftoverSeen(c, { ...leftoverSeen(c, 'absorb'), count: 12 })).toBe(false);
    expect(sameLeftoverSeen(c, { ...leftoverSeen(c, 'absorb'), last: 100.03 })).toBe(false);
    expect(sameLeftoverSeen(c, { ...leftoverSeen(c, 'separate'), count: 13 })).toBe(false);
  });
  it('الباقي مختلف ← false؛ مفيش سؤال ومفيش اختيار ← true؛ واحد من غير التاني ← false', () => {
    expect(sameLeftoverSeen(c, { ...leftoverSeen(c, 'absorb'), amount: 16.7 })).toBe(false);
    expect(sameLeftoverSeen(null, undefined)).toBe(true);
    expect(sameLeftoverSeen(c, undefined)).toBe(false);
    expect(sameLeftoverSeen(null, leftoverSeen(c, 'absorb'))).toBe(false);
  });
});
