import type { Debt } from '@/context/DataContext';
import {
  foldInstallmentResidue, installmentCountFor, installmentResidueIgnored, installmentResidueKnown,
  installmentResidueOf, pinInstallmentAmount, planInstallmentCountEdit, planInstallments,
  stampResidue, sumIncreasesCents,
} from '@/lib/finance';

/**
 * بصمة فرق التقريب (`installmentResidue.increasesTotal`، قرار مؤمن D2، بند 8).
 *
 * المشكلة: نسخة قديمة من التطبيق بتضيف زيادة (`{increases:[...]}` بس) من غير ما تلمس
 * الفرق، فالفرق المتخزّن بيفضل على خطة قديمة ويتعدّ بيه كأنه سليم. العلاج: الفرق بيتكتب
 * معاه **مجموع الزيادات وقت الكتابة** (بالقرش)، وبيتقري **بس** لو البصمة = مجموع
 * زيادات الدين دلوقتي. غير كده ← القاعدة القديمة ومتعلَّم إنه اتجاهل.
 *
 * البصمة بتفرّق "الزيادات اتغيّرت من وراء الفرق" عن "الزيادات رجعت لحالها": زيادة
 * اتضافت واتمسحت بنفس المبلغ بإيد نسخة قديمة ← البصمة بتتطابق تاني والفرق بيتقري.
 *
 * اختبارات المحاكي الحقيقية (patches خام على فايرستور) في
 * `context/__tests__/installmentResidue.emulator.test.tsx`.
 */

const base = (over: Partial<Debt>) => ({
  id: 'd', personName: 'أحمد', direction: 'i_owe', isInstallment: true,
  date: '2026-01-01', createdAt: '2026-01-01', payments: [], increases: [], ...over,
}) as unknown as Debt;

const inc = (id: string, amount: number) => ({ id, date: '2026-03-01', amount });

/** نفس `addDebt`: البصمة = زيادات الدين وقت الإنشاء */
function created(total: number, n: number, over: Partial<Debt> = {}): Debt {
  const plan = planInstallments(total, n)!;
  const increases = (over.increases ?? []) as Debt['increases'];
  return base({
    totalAmount: total, installmentCount: n, installmentAmount: plan.value,
    installmentResidue: stampResidue({ amount: plan.residue, forInstallment: plan.value, over: n }, increases)!,
    ...over,
  });
}

/** نفس مسار الزيادة/المسح/التعديل في `DataContext`: الطي بالبصمة الجديدة، والزيادات الجديدة */
function withIncreases(d: Debt, increasesAfter: Debt['increases'], delta: number): Debt {
  const folded = foldInstallmentResidue(d, { kind: 'increase', delta, increasesAfter });
  return { ...d, ...(folded ? { installmentResidue: folded } : {}), increases: increasesAfter } as Debt;
}

describe('sumIncreasesCents', () => {
  it('مجموع بالقروش الصحيحة', () => {
    expect(sumIncreasesCents([])).toBe(0);
    expect(sumIncreasesCents([inc('a', 100), inc('b', 50.25)] as never)).toBe(15025);
  });

  it('زيادات مش موجودة ← صفر', () => {
    expect(sumIncreasesCents(undefined as never)).toBe(0);
  });

  it('ضجيج الفاصلة العايمة: 0.1 + 0.2 هو نفس 0.3 بالقرش', () => {
    // 0.1 + 0.2 = 0.30000000000000004 بالكسور — بالقروش 30 بالظبط
    expect(sumIncreasesCents([inc('a', 0.1), inc('b', 0.2)] as never)).toBe(30);
    expect(sumIncreasesCents([inc('a', 0.1), inc('b', 0.2)] as never)).toBe(sumIncreasesCents([inc('c', 0.3)] as never));
  });

  it('الترتيب مالوش دعوة', () => {
    const xs = [1321.48, 277.5, 2.47, 877.8, 1734.01, 1254.77];
    const fwd = sumIncreasesCents(xs.map((x, i) => inc(`f${i}`, x)) as never);
    const rev = sumIncreasesCents([...xs].reverse().map((x, i) => inc(`r${i}`, x)) as never);
    expect(fwd).toBe(rev);
  });

  it('مبلغ مش رقم، أو لا نهائي، أو أكبر من الأعداد الآمنة ← null (مش 0 ساكت)', () => {
    expect(sumIncreasesCents([inc('a', 100), inc('b', 'x' as never)] as never)).toBeNull();
    expect(sumIncreasesCents([inc('a', NaN)] as never)).toBeNull();
    expect(sumIncreasesCents([inc('a', Infinity)] as never)).toBeNull();
    expect(sumIncreasesCents([inc('a', 1e300)] as never)).toBeNull();
  });
});

describe('stampResidue', () => {
  const plan = { amount: 0.04, forInstallment: 83.33, over: 12 };

  it('بتضيف مجموع الزيادات (بالقرش) من غير ما تلمس الباقي', () => {
    expect(stampResidue(plan, [] as never)).toEqual({ ...plan, increasesTotal: 0 });
    expect(stampResidue(plan, [inc('a', 0.1), inc('b', 0.2)] as never)).toEqual({ ...plan, increasesTotal: 0.3 });
  });

  it('مجموع مش رقم حقيقي ← null (الكتابة بتشيل الفرق)', () => {
    expect(stampResidue(plan, [inc('a', 'x' as never)] as never)).toBeNull();
    expect(stampResidue(plan, [inc('a', 1e300)] as never)).toBeNull();
  });
});

describe('الفرق بيتقري بس لو البصمة = مجموع زيادات الدين', () => {
  /**
   * 1 على 24: قسط 0.04 وفرق 0.04. بعد زيادة 1: الإجمالي 2 — بالفرق المقبول العدد 49،
   * وبالقاعدة القديمة 50 (2 ÷ 0.04 − 0.005). الفرق في العدد هو اللي بيثبت مين اتقرى.
   */
  const fresh = () => created(1, 24);

  it('الحالة السليمة: بصمة 0 على دين من غير زيادات ← معروف، والعدد 24', () => {
    const d = fresh();
    expect(d.installmentResidue!.increasesTotal).toBe(0);
    expect(installmentResidueKnown(d)).toBe(true);
    expect(installmentResidueIgnored(d)).toBe(false);
    expect(installmentResidueOf(d)).toBe(0.04);
    expect(installmentCountFor(d)).toBe(24);
  });

  it('بصمة ≠ مجموع الزيادات ← متجاهَل ومتعلَّم، والعدد بالقاعدة القديمة', () => {
    const d = { ...fresh(), increases: [inc('i1', 1)] } as unknown as Debt;
    expect(installmentResidueKnown(d)).toBe(false);
    expect(installmentResidueIgnored(d)).toBe(true);
    expect(installmentResidueOf(d)).toBeNull();
    // (2 ÷ 0.04 − 0.005) = 49.995 ← 50. لو الفرق اتقرى كان 49
    expect(installmentCountFor(d)).toBe(50);
  });

  it('من غير بصمة (شكل قبل D2) ← متجاهَل ومتعلَّم، والعدد بالقاعدة القديمة', () => {
    const d = fresh();
    const { increasesTotal: _gone, ...unstamped } = d.installmentResidue!;
    const legacy = { ...d, installmentResidue: unstamped } as unknown as Debt;
    expect(installmentResidueKnown(legacy)).toBe(false);
    expect(installmentResidueIgnored(legacy)).toBe(true);
    expect(installmentResidueOf(legacy)).toBeNull();
    // 1 ÷ 0.04 − 0.005 = 24.995 ← 25 (بالفرق المعروف 24)
    expect(installmentCountFor(legacy)).toBe(25);
  });

  it('بصمة مش رقم (نص، NaN، لا نهائي) ← متجاهَل', () => {
    for (const bad of ['0', NaN, Infinity, null]) {
      const d = fresh();
      const broken = { ...d, installmentResidue: { ...d.installmentResidue!, increasesTotal: bad } } as unknown as Debt;
      expect([bad, installmentResidueKnown(broken), installmentResidueIgnored(broken)]).toEqual([bad, false, true]);
    }
  });

  it('زيادة مبلغها مش رقم ← متجاهَل حتى لو البصمة 0 (مش "مجموع 0" ساكت)', () => {
    for (const bad of ['x', NaN, Infinity, 1e300]) {
      const d = { ...fresh(), increases: [inc('bad', bad as never)] } as unknown as Debt;
      expect([bad, installmentResidueKnown(d), installmentResidueIgnored(d)]).toEqual([bad, false, true]);
      expect([bad, installmentResidueOf(d)]).toEqual([bad, null]);
    }
  });

  it('نسخة قديمة أضافت زيادة من غير ما تلمس الفرق ← متجاهَل (patch `{increases}` بس)', () => {
    // 1000 على 12 بفرق 0.04، ونسخة قديمة كتبت زيادة 500 بس
    const d = created(1000, 12);
    const patched = { ...d, increases: [inc('old', 500)] } as unknown as Debt;
    expect(installmentResidueKnown(patched)).toBe(false);
    expect(installmentResidueIgnored(patched)).toBe(true);
    expect(installmentResidueOf(patched)).toBeNull();
    // والعدد بالقاعدة القديمة: ceil(1500 ÷ 83.33 − 0.005) = 18
    expect(installmentCountFor(patched)).toBe(18);
  });

  it('أضافتها نسخة قديمة وبعدين مسحتها بنفس المبلغ ← البصمة بتتطابق تاني والفرق مقبول', () => {
    const d = fresh();
    const added = { ...d, increases: [inc('old', 1)] } as unknown as Debt;
    expect(installmentResidueKnown(added)).toBe(false);
    const deleted = { ...added, increases: [] } as unknown as Debt;
    expect(installmentResidueKnown(deleted)).toBe(true);
    expect(installmentResidueOf(deleted)).toBe(0.04);
    expect(installmentCountFor(deleted)).toBe(24);
  });

  it('تبديل زيادتين بمجموع واحد (100+50 ← 50+100، أو 120+30) ← مقبول', () => {
    const d = withIncreases(created(1000, 12), [inc('a', 100), inc('b', 50)] as never, 150);
    expect(d.installmentResidue!.increasesTotal).toBe(150);
    expect(installmentResidueKnown(d)).toBe(true);
    const swapped = { ...d, increases: [inc('a', 50), inc('b', 100)] } as unknown as Debt;
    expect(installmentResidueKnown(swapped)).toBe(true);
    const redistributed = { ...d, increases: [inc('a', 120), inc('b', 30)] } as unknown as Debt;
    expect(installmentResidueKnown(redistributed)).toBe(true);
    // ...وأي مجموع تاني ← لأ
    const other = { ...d, increases: [inc('a', 120), inc('b', 31)] } as unknown as Debt;
    expect(installmentResidueKnown(other)).toBe(false);
  });

  it('ضجيج الفاصلة: زيادات 0.1 + 0.2 والبصمة 0.3 ← مقبول', () => {
    const d = created(1000, 12, { increases: [inc('a', 0.1), inc('b', 0.2)] as never });
    expect(d.installmentResidue!.increasesTotal).toBe(0.3);
    expect(installmentResidueKnown(d)).toBe(true);
    // وعكسها: 0.3 زيادة واحدة على بصمة اتكتبت من 0.1 + 0.2
    expect(installmentResidueKnown({ ...d, increases: [inc('c', 0.3)] } as unknown as Debt)).toBe(true);
  });

  it('الفحوصات القديمة لسه شغالة مع البصمة السليمة (قسط تاني، فوق السقف)', () => {
    const d = fresh();
    const otherInstallment = { ...d, installmentAmount: 0.05 } as unknown as Debt;
    expect(installmentResidueKnown(otherInstallment)).toBe(false);
    const overCeiling = { ...d, installmentResidue: { ...d.installmentResidue!, amount: 1e6 } } as unknown as Debt;
    expect(installmentResidueKnown(overCeiling)).toBe(false);
  });

  it('الطي على فرق متجاهَل ← null (مبنطويش على خطة بايظة)', () => {
    const stale = { ...fresh(), increases: [inc('old', 1)] } as unknown as Debt;
    expect(foldInstallmentResidue(stale, { kind: 'initial', delta: 10 })).toBeNull();
    expect(foldInstallmentResidue(stale, { kind: 'increase', delta: 1, increasesAfter: [inc('old', 1), inc('n', 1)] as never })).toBeNull();
  });
});

describe('البصمة بعد الطي = مجموع الزيادات النهائية', () => {
  const start = () => created(1000, 12);

  it('إضافة: البصمة = مجموع الزيادات بعدها', () => {
    const one = withIncreases(start(), [inc('a', 100)] as never, 100);
    expect(one.installmentResidue!.increasesTotal).toBe(100);
    const two = withIncreases(one, [inc('a', 100), inc('b', 66.68)] as never, 66.68);
    expect(two.installmentResidue!.increasesTotal).toBe(166.68);
    expect(installmentResidueKnown(two)).toBe(true);
  });

  it('مسح: البصمة بترجع للمجموع الفاضل، وللصفر لما الزيادات تخلص', () => {
    const two = withIncreases(withIncreases(start(), [inc('a', 100)] as never, 100), [inc('a', 100), inc('b', 50)] as never, 50);
    const oneLeft = withIncreases(two, [inc('b', 50)] as never, -100);
    expect(oneLeft.installmentResidue!.increasesTotal).toBe(50);
    expect(installmentResidueKnown(oneLeft)).toBe(true);
    const none = withIncreases(oneLeft, [] as never, -50);
    expect(none.installmentResidue!.increasesTotal).toBe(0);
    expect(none.installmentResidue).toEqual(start().installmentResidue);
  });

  it('تعديل زيادة (500 ← 600): البصمة = المجموع بالمبلغ الجديد', () => {
    const one = withIncreases(start(), [inc('a', 500)] as never, 500);
    const edited = withIncreases(one, [inc('a', 600)] as never, 100);
    expect(edited.installmentResidue!.increasesTotal).toBe(600);
    expect(installmentResidueKnown(edited)).toBe(true);
  });

  it('الترتيب مالوش دعوة: أ ثم ب = ب ثم أ، والمسح بالعكس برضه', () => {
    const ab = withIncreases(withIncreases(start(), [inc('a', 100)] as never, 100), [inc('a', 100), inc('b', 66.68)] as never, 66.68);
    const ba = withIncreases(withIncreases(start(), [inc('b', 66.68)] as never, 66.68), [inc('b', 66.68), inc('a', 100)] as never, 100);
    expect(ab.installmentResidue).toEqual(ba.installmentResidue);
    const delAB = withIncreases(withIncreases(ab, [inc('b', 66.68)] as never, -100), [] as never, -66.68);
    const delBA = withIncreases(withIncreases(ab, [inc('a', 100)] as never, -66.68), [] as never, -100);
    expect(delAB.installmentResidue).toEqual(start().installmentResidue);
    expect(delBA.installmentResidue).toEqual(start().installmentResidue);
  });

  it("'initial': تعديل مبلغ الأصل بيطوي الفرق وبيسيب البصمة زي ما هي (الزيادات مااتغيّرتش)", () => {
    const d = withIncreases(start(), [inc('a', 100)] as never, 100);
    const folded = foldInstallmentResidue(d, { kind: 'initial', delta: 1000 })!;
    expect(folded.increasesTotal).toBe(100);
    expect(folded.over).toBeGreaterThan(d.installmentResidue!.over);
    // وبعد الطي الدين لسه مقبول
    expect(installmentResidueKnown({ ...d, totalAmount: 2000, installmentResidue: folded } as unknown as Debt)).toBe(true);
  });

  it("'initial' من غير زيادات ← البصمة 0", () => {
    expect(foldInstallmentResidue(start(), { kind: 'initial', delta: 1000 })!.increasesTotal).toBe(0);
  });

  it('زيادات بعد الطي مبلغها مش رقم ← null (مش بصمة NaN)', () => {
    expect(foldInstallmentResidue(start(), { kind: 'increase', delta: 100, increasesAfter: [inc('a', 'x' as never)] as never })).toBeNull();
  });

  it('طي بمبلغ ضخم (مش آمن بالقروش) ← null زي الأول', () => {
    expect(foldInstallmentResidue(start(), { kind: 'initial', delta: 1e20 })).toBeNull();
  });
});

describe('كل مسار كتابة بيبصم', () => {
  it('pinInstallmentAmount: الفرق متبصم بالزيادات اللي كانت عليه قبل التثبيت', () => {
    const legacy = base({ totalAmount: 1000, installmentCount: 12, increases: [inc('old', 500)] as never });
    expect(pinInstallmentAmount(legacy)!.installmentResidue).toEqual({
      amount: 0.06, forInstallment: 83.33, over: 18, increasesTotal: 500,
    });
    const none = base({ totalAmount: 1000, installmentCount: 12 });
    expect(pinInstallmentAmount(none)!.installmentResidue.increasesTotal).toBe(0);
  });

  it('...والدين بعد التثبيت بيقري الفرق (البصمة بتطابق زياداته)', () => {
    const legacy = base({ totalAmount: 1000, installmentCount: 12, increases: [inc('old', 500)] as never });
    const pinned = { ...legacy, ...pinInstallmentAmount(legacy)! } as Debt;
    expect(installmentResidueKnown(pinned)).toBe(true);
  });

  it('خطة تعديل العدد (setInstallmentCount) متبصمة بزيادات الدين الحالية', () => {
    const d = created(1000, 4, { increases: [inc('a', 500)] as never });
    const plan = planInstallmentCountEdit(d, 6)!;
    const stamped = stampResidue({ amount: plan.residue, forInstallment: plan.value, over: plan.over }, d.increases)!;
    expect(stamped.increasesTotal).toBe(500);
    expect(installmentResidueKnown({ ...d, installmentAmount: plan.value, installmentCount: plan.count, installmentResidue: stamped } as Debt)).toBe(true);
  });
});

describe('قيد معروف C1: نسخة قديمة بتعدّل العدد وتوصل لنفس القسط المقرّب', () => {
  /**
   * مقبول بوعي (type-design-analyzer + database-reviewer): النسخة القديمة من
   * `setInstallmentCount` بتكتب `installmentCount` و`installmentAmount` بس. لو القسط
   * الجديد طلع **نفس** القسط المقرّب، `forInstallment` والبصمة (الزيادات ما اتغيّرتش)
   * بيفضلوا مطابقين ← الفرق القديم بيتقري مع إنه فرق خطة العدد القديم.
   * الخطأ بيتحصر في ≤ نص قرش × `over` (فرق تقريب مش خطة حقيقية)، ومبيخبّيش فلوس:
   * المتبقي بيتعرض زي ما هو. **ده بيثبّت السلوك الحالي مش بيدافع عنه** — لو اتقفل
   * (مثلاً بتخزين العدد في البصمة)، الاختبار ده بيتغيّر عن قصد.
   */
  it('الفرق القديم 0.04 بيتقري مع إن الخطة الجديدة فرقها 0.02', () => {
    // 1000 على 12 (قسط 83.33، فرق 0.04)، واتدفع 500 (الدفعة مبتلمسش الفرق)
    const before = created(1000, 12, { payments: [{ id: 'p', date: '2026-02-01', amount: 500, walletId: 'w' }] as never });
    // العدد بقى 7: باقي 500 على (7 − 1) = 83.33 بالظبط نفس القسط، وفرق الخطة الجديدة 0.02
    const fresh = planInstallmentCountEdit(before, 7)!;
    expect(fresh.value).toBe(83.33);
    expect(fresh.residue).toBe(0.02);
    expect(fresh.over).toBe(6);
    // النسخة القديمة كتبت العدد والقسط بس
    const oldBuild = { ...before, installmentCount: 7, installmentAmount: 83.33 } as Debt;
    expect(installmentResidueKnown(oldBuild)).toBe(true);
    expect(installmentResidueIgnored(oldBuild)).toBe(false);
    expect(installmentResidueOf(oldBuild)).toBe(0.04); // مش 0.02: القيد المعروف
    // الخطأ ≤ نص قرش × over
    expect(Math.abs(0.04 - fresh.residue)).toBeLessThanOrEqual(0.005 * 12 + 1e-9);
  });

  it('...وقسط مختلف ← متجاهَل زي ما كان (القيد على نفس القسط بس)', () => {
    const before = created(1000, 12, { payments: [{ id: 'p', date: '2026-02-01', amount: 500, walletId: 'w' }] as never });
    // العدد بقى 8: 500 ÷ 7 = 71.43 ≠ 83.33
    const oldBuild = { ...before, installmentCount: 8, installmentAmount: 71.43 } as Debt;
    expect(installmentResidueKnown(oldBuild)).toBe(false);
    expect(installmentResidueIgnored(oldBuild)).toBe(true);
  });
});


/**
 * الجولة 1 على D2 (2026-10-30): silent-failure-hunter + money-reviewer. اختبارات على
 * مصدر `DataContext` (نفس نمط "DataContext (المراجعة الجولة 2)") — السطور دي لوج وكتابة
 * من جوه الكونتكست، مش دوال صافية.
 */
describe('DataContext — الجولة 1 على D2', () => {
  const { readFileSync } = require('fs');
  const src: string = readFileSync('context/DataContext.tsx', 'utf8');
  const fnBody = (header: string) => {
    const start = src.indexOf(header);
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('\n  }\n', start));
  };

  it('setInstallmentCount: البصمة مش ممكنة ← الفرق بيتشال **بسطر** (مش ساكت)، والفرق المتجاهَل بيتسجّل', () => {
    const b = fnBody('  async function setInstallmentCount(');
    expect(b).toMatch(/noteIgnoredResidue\(debt\)/);
    // الحالة اللي البصمة فيها null لازم يبقى فيها سطر fold قبل deleteField
    expect(b).toMatch(/if \(!stamped\) noteOnce\(`fold:\$\{debtId\}`/);
    expect(b).toMatch(/installmentResidue: stamped \?\? deleteField\(\)/);
  });

  it('stageReconcile (مسح عملية زيادة): الفرق المتجاهَل بيتسجّل قبل الطيّ زي باقي مسارات الدين', () => {
    const b = fnBody('  function stageReconcile(');
    const ignored = b.indexOf('noteIgnoredResidue(d);');
    const fold = b.indexOf('residueAfterIncreaseChange(d,');
    expect(ignored).toBeGreaterThan(-1);
    expect(ignored).toBeLessThan(fold);
  });

  // money-reviewer (NIT): النوع مبيمنعش فرق من غير بصمة لأن الـpatch `Record<string, unknown>`
  // — فالحارس هنا: مفيش ولا فرق بيتكتب كـliteral، كله من stampResidue أو الطيّ
  it('جرد: مفيش `installmentResidue: {` literal في DataContext ولا linkedEdit', () => {
    for (const file of ['context/DataContext.tsx', 'lib/linkedEdit.ts']) {
      const text: string = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/installmentResidue:\s*\{/);
    }
  });
});
