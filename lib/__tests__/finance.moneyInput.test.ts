import { readFileSync } from 'fs';
import type { Debt } from '@/context/DataContext';
import {
  foldInstallmentResidue, installmentCountFor, planInstallmentCountEdit, planInstallments,
  storableCount, toMoneyAmount,
} from '@/lib/finance';

/**
 * مبالغ وأعداد مينفعش تتسجل (2026-09-30، الجولة 3 على فرق التقريب). الرجوع اللي
 * اتعالج: `addDebtIncrease` كان بيفحص `isFinite` **قبل** التقريب، و`roundMoney(1e307)`
 * = Infinity فكان بيتكتب. الفحص بقى بعد التقريب في مكان واحد (`toMoneyAmount`)،
 * وكل كتابة لعدد الأقساط بتعدّي على `storableCount`.
 */

describe('toMoneyAmount — التقريب الأول وبعدين الفحص', () => {
  it.each<[string, number, number | null]>([
    ['1e307 (بيعدّي isFinite وبيطلع Infinity بعد التقريب)', 1e307, null],
    ['1e999 = Infinity', Number('1e999'), null],
    ['Infinity', Infinity, null],
    ['-Infinity', -Infinity, null],
    ['NaN', NaN, null],
    ['سالب', -5, null],
    ['صفر', 0, null],
    ['0.004 ← 0 بعد التقريب', 0.004, null],
    ['0.006 ← 0.01', 0.006, 0.01],
    ['100.004 ← 100', 100.004, 100],
    ['83.33', 83.33, 83.33],
    ['1e306 رقم ضخم بس محدود (مفيش سقف — STANDARDS 5.9)', 1e306, 1e306],
  ])('%s', (_, input, expected) => {
    expect(toMoneyAmount(input)).toBe(expected);
  });
});

describe('storableCount — عدد أقساط بيتخزّن بقيمته', () => {
  it.each<[unknown, boolean]>([
    [1, true], [12, true], [2 ** 53 - 1, true],
    [0, false], [-1, false], [1.5, false], [NaN, false], [Infinity, false],
    [2 ** 53, false], [1e20, false], ['12', false], [undefined, false],
  ])('%p ← %p', (n, ok) => {
    expect(storableCount(n)).toBe(ok);
  });
});

const created = (total: number, n: number, over: Partial<Debt> = {}) => {
  const plan = planInstallments(total, n)!;
  return {
    id: 'd', personName: 'أحمد', direction: 'i_owe', isInstallment: true, date: '2026-01-01',
    createdAt: '2026-01-01', payments: [], increases: [], totalAmount: total, installmentCount: n,
    installmentAmount: plan.value, installmentResidue: { amount: plan.residue, forInstallment: plan.value, over: n },
    ...over,
  } as unknown as Debt;
};

describe('أعداد ضخمة في الدوال اللي الفرع ضافها', () => {
  it('خطة الأقساط بعدد مش آمن ← مرفوضة', () => {
    expect(planInstallments(1000, 1e20)).toBeNull();
    expect(planInstallments(1e25, 2 ** 53)).toBeNull();
  });

  it('تعديل العدد لـ1e20 ← مرفوض (كان "صحيح" فبيعدّي)', () => {
    expect(planInstallmentCountEdit(created(1e25, 12), 1e20)).toBeNull();
  });

  it('زيادة ضخمة (1e300) ← حسبة الفرق بتفشل صريح (الكتابة بتشيله) مش رقم مش دقيق', () => {
    expect(foldInstallmentResidue(created(1000, 12), 1e300)).toBeNull();
  });

  it('...والعدد اللي بيطلع منها مبيتخزّنش ← لازم الحارس في الكتابة', () => {
    const d = created(1000, 12, { increases: [{ id: 'i', date: '', amount: 1e300 }] as never });
    const n = installmentCountFor({ ...d, installmentResidue: undefined });
    expect(Number.isFinite(n)).toBe(true);
    expect(storableCount(n)).toBe(false);
  });
});

describe('كل مدخل بيكتب مبلغ أو عدد بيعدّي على الحارس', () => {
  const ctx = readFileSync('context/DataContext.tsx', 'utf8');
  const modals = readFileSync('components/DebtEntryModals.tsx', 'utf8');
  const screen = readFileSync('app/(tabs)/debts.tsx', 'utf8');
  const body = (src: string, start: string) => {
    const at = src.indexOf(start);
    expect(at).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('\n  }\n', at));
  };

  it.each(['addDebtPayment', 'addDebtIncrease', 'addDebt'])('%s: toMoneyAmount قبل أي كتابة', (name) => {
    const b = body(ctx, `  async function ${name}(`);
    const guard = b.indexOf('toMoneyAmount(');
    expect(guard).toBeGreaterThan(-1);
    const firstWrite = Math.min(...['runTransaction(', 'addTransaction(', 'addDocNoWait('].map(w => {
      const i = b.indexOf(w); return i === -1 ? Infinity : i;
    }));
    expect(guard).toBeLessThan(firstWrite);
  });

  it('مفيش `isFinite` على المبلغ قبل التقريب في الزيادة (الرجوع نفسه)', () => {
    expect(body(ctx, '  async function addDebtIncrease(')).not.toMatch(/Number\.isFinite\(amount\)/);
  });

  it('كل كتابة لعدد الأقساط بتعدّي على countToWrite (مفيش كتابة مباشرة)', () => {
    expect(ctx).not.toMatch(/patch\.installmentCount = (recount|nextCount)/);
    expect((ctx.match(/countToWrite\(/g) || []).length).toBeGreaterThanOrEqual(7);
  });

  it('رسالة الدفعة بالعدد اللي اتكتب — مش `nextCount ??` (مبيمسكش NaN)', () => {
    expect(ctx).not.toMatch(/nextCount \?\? debt\.installmentCount/);
  });

  it('المودالات التلاتة بتقرّب وتفحص (toMoneyAmount) مش `!amt || amt <= 0`', () => {
    expect(modals).not.toMatch(/!amt \|\| amt <= 0/);
    expect((modals.match(/const amt = toMoneyAmount\(Number\(/g) || []).length).toBe(3);
  });

  it('تعديل العدد في الشاشة بـstorableCount (1e20 كان بيعدّي Number.isInteger)', () => {
    expect(screen).toMatch(/if \(!storableCount\(next\)\) \{ setError\(INSTALLMENT_COUNT_INVALID\)/);
  });
});
