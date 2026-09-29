import { readFileSync } from 'fs';
import type { Debt } from '@/context/DataContext';
import { reopenedDueDate } from '@/lib/finance';

/**
 * زيادة فتحت دين أقساط متسدد ← المعاد يتقدّم (خطوة 7). من غير ده التذكير كان
 * بيرجع على معاد آخر قسط اللي عدّى. المسار الكامل على المحاكي:
 * `debtReopenDueDate.emulator.test.tsx` (**ما اتشغلش في السحابة**).
 */

const settled = (over: Partial<Debt> = {}) => ({
  id: 'd', personName: 'أحمد', direction: 'i_owe', isInstallment: true, totalAmount: 3000,
  installmentAmount: 1000, installmentCount: 3, dueDate: '2026-03-15',
  payments: [1, 2, 3].map(i => ({ id: `p${i}`, date: '', amount: 1000, walletId: 'w' })), increases: [],
  date: '2026-01-01', createdAt: '2026-01-01', ...over,
}) as unknown as Debt;

const TODAY = '2026-09-29';

describe('reopenedDueDate', () => {
  it('معاد فات من شهور ← أول معاد بنفس اليوم من النهارده ورايح', () => {
    expect(reopenedDueDate(settled(), 500, TODAY, TODAY)).toBe('2026-10-15');
  });

  it('المعاد لسه جاي ← الشهر اللي بعده (القسط اللي اتدفع خلاص)', () => {
    expect(reopenedDueDate(settled({ dueDate: '2026-10-05' }), 500, TODAY, TODAY)).toBe('2026-11-05');
  });

  it('المعاد الجاي بيقع النهارده بالظبط ← النهارده', () => {
    expect(reopenedDueDate(settled({ dueDate: '2026-08-29' }), 500, TODAY, TODAY)).toBe('2026-09-29');
  });

  it('زيادة بتاريخ قديم ← من النهارده مش من تاريخ الزيادة', () => {
    expect(reopenedDueDate(settled(), 500, '2026-04-01', TODAY)).toBe('2026-10-15');
  });

  it('مدفوع زيادة بس الزيادة أكبر من الفايض ← الدين اتفتح والمعاد يتقدّم', () => {
    const over = settled({ payments: [{ id: 'p', date: '', amount: 3200, walletId: 'w' }] as Debt['payments'] });
    expect(reopenedDueDate(over, 500, TODAY, TODAY)).toBe('2026-10-15');
  });

  it('زيادة بتاريخ جاي ← من تاريخ الزيادة', () => {
    expect(reopenedDueDate(settled(), 500, '2026-12-20', TODAY)).toBe('2027-01-15');
  });

  it('31 في الشهر مبيتقصّش لـ28 على طول (كل مرشّح من المعاد الأصلي)', () => {
    // سبتمبر 30 يوم ← 30، وده مش قبل 29
    expect(reopenedDueDate(settled({ dueDate: '2026-01-31' }), 500, TODAY, TODAY)).toBe('2026-09-30');
    // بعد فبراير ميفضلش 28: أكتوبر فيه 31
    expect(reopenedDueDate(settled({ dueDate: '2026-01-31' }), 500, '2026-10-05', TODAY)).toBe('2026-10-31');
  });

  it.each<[string, Partial<Debt>, number]>([
    ['الدين لسه مفتوح', { payments: [] }, 500],
    ['مش قسط', { isInstallment: false }, 500],
    ['مفيش معاد', { dueDate: undefined }, 500],
    ['الزيادة صفر', {}, 0],
    ['الزيادة مش رقم', {}, NaN],
    // مدفوع 3800 من 3000 ← زيادة 500 لسه سايباه متسدد (فايض 300)
    ['الدين لسه متسدد بعد الزيادة (كان مدفوع زيادة)', {
      payments: [{ id: 'p', date: '', amount: 3800, walletId: 'w' }] as Debt['payments'] }, 500],
    ['معاد متخزّن بايظ', { dueDate: 'abc' }, 500],
    ['معاد متخزّن مش نص', { dueDate: { seconds: 1 } as unknown as string }, 500],
  ])('%s ← المعاد مبيتغيّرش', (_n, over, amount) => {
    expect(reopenedDueDate(settled(over), amount, TODAY, TODAY)).toBeNull();
  });
});

it('DataContext: addDebtIncrease بيكتب المعاد الجديد في نفس الـpatch', () => {
  const src = readFileSync('context/DataContext.tsx', 'utf8');
  const start = src.indexOf('  async function addDebtIncrease(');
  const body = src.slice(start, src.indexOf('\n  }\n', start));
  expect(body).toMatch(/const nextDue = reopenedDueDate\(debt, amount, date, todayStr\(\)\);\s*if \(nextDue\) patch\.dueDate = nextDue;/);
});
