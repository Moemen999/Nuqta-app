import { barRows } from '@/lib/barRows';

const s = (id: string, amount: number) => ({ id, name: id, amount, color: '#000' });

describe('barRows — أعمدة التقارير', () => {
  it('أكبر فئة عمودها مليان، والباقي نسبةً ليها', () => {
    const rows = barRows([s('a', 300), s('b', 150), s('c', 30)], 480);
    expect(rows.map(r => r.share)).toEqual([1, 0.5, 0.1]);
  });

  it('النسبة من الإجمالي ومقرّبة', () => {
    expect(barRows([s('a', 2), s('b', 1)], 3).map(r => r.percent)).toEqual(['67%', '33%']);
  });

  it('أقل من 1% ← "أقل من 1%" مش "0%"', () => {
    expect(barRows([s('a', 999), s('b', 1)], 1000)[1].percent).toBe('أقل من 1%');
  });

  it('نفس الترتيب والألوان والأسامي (الشكل بس اللي بيتغيّر)', () => {
    const input = [s('x', 5), s('y', 9)];
    expect(barRows(input, 14).map(r => [r.id, r.name, r.color, r.amount])).toEqual(input.map(i => [i.id, i.name, i.color, i.amount]));
  });

  it('إجمالي صفر أو مفيش شرايح ← مبيقعش (مفيش قسمة على صفر)', () => {
    expect(barRows([], 0)).toEqual([]);
    expect(barRows([s('a', 0)], 0)[0]).toMatchObject({ share: 0, percent: '0%' });
  });
});
