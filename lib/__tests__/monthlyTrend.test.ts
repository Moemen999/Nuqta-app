import { monthlyTrend } from '@/lib/monthlyTrend';

const e = (date: string, amount: number, categoryId = 'c1') => ({ date, amount, categoryId });

describe('monthlyTrend', () => {
  it('6 شهور من الأقدم للأحدث، والشهر الحالي partial', () => {
    const r = monthlyTrend([], '2026-11-05');
    expect(r.map(x => x.key)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(r.map(x => x.label)).toEqual(['يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر']);
    expect(r.filter(x => x.partial).map(x => x.key)).toEqual(['2026-11']);
  });

  it('بيعدّي السنة صح (يناير ← أغسطس اللي فات)', () => {
    const r = monthlyTrend([], '2027-01-31');
    expect(r[0].key).toBe('2026-08');
    expect(r[5].key).toBe('2027-01');
  });

  it('بيجمع كل شهر لوحده وبيتجاهل اللي برّه الست شهور', () => {
    const r = monthlyTrend([
      e('2026-11-01', 100), e('2026-11-04', 50),
      e('2026-10-15', 300),
      e('2026-05-31', 9999), // قبل الفترة
      e('2026-12-01', 7777), // بعد النهارده (عملية بتاريخ قدام)
    ], '2026-11-05');
    expect(r[5].amount).toBe(150);
    expect(r[4].amount).toBe(300);
    expect(r.reduce((s, x) => s + x.amount, 0)).toBe(450);
  });

  it('عملية بتاريخ قدام جوه الشهر الحالي مبتتعدّش', () => {
    const r = monthlyTrend([e('2026-11-05', 10), e('2026-11-20', 500)], '2026-11-05');
    expect(r[5].amount).toBe(10);
  });

  it('مبلغ NaN/Infinity أو تاريخ مش نص بيتشال وبيتعدّ، والباقي سليم', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const r = monthlyTrend([
      e('2026-11-01', 100), e('2026-11-02', NaN), e('2026-11-03', Infinity),
      { date: undefined as unknown as string, amount: 5 },
    ], '2026-11-05');
    expect(r[5].amount).toBe(100);
    expect(r.every(x => Number.isFinite(x.share))).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('3 صف'));
    warn.mockRestore();
  });

  it('اليوم بشكل غلط ← مفيش أعمدة', () => {
    expect(monthlyTrend([e('2026-11-01', 1)], '')).toEqual([]);
  });

  it('share نسبةً لأكبر شهر، وكله صفر من غير NaN', () => {
    const r = monthlyTrend([e('2026-10-01', 400), e('2026-11-01', 100)], '2026-11-05');
    expect(r[4].share).toBe(1);
    expect(r[5].share).toBe(0.25);
    expect(monthlyTrend([], '2026-11-05').every(x => x.share === 0)).toBe(true);
  });

  it('فلتر الفئات بنفس قاعدة periodExpenseTotal (من غير فئة بيتشال لما فيه فلتر)', () => {
    const rows = [e('2026-11-01', 100, 'c1'), e('2026-11-01', 40, 'c2'), { date: '2026-11-02', amount: 7 }];
    expect(monthlyTrend(rows, '2026-11-05')[5].amount).toBe(147);
    expect(monthlyTrend(rows, '2026-11-05', ['c2'])[5].amount).toBe(40);
  });
});
