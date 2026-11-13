import { GROUPED_SLICE_ID, periodExpenseTotal } from '@/lib/finance';
import { DARK, LIGHT } from '@/context/ThemeContext';
import { barFillStyle, barFrameStyle, MAX_COLUMNS, PARTIAL_BAR_OPACITY, rangeText, sixMonthsStart, spendTimeline } from '@/lib/spendTimeline';

const e = (date: string, amount: number, categoryId?: string) => ({ date, amount, categoryId });
const run = (from: string, to: string, today = '2026-11-08', rows: ReturnType<typeof e>[] = []) =>
  spendTimeline(rows, { from, to }, today);

describe('الوحدة بتتغير مع طول الفترة', () => {
  it.each([
    ['يوم واحد', '2026-11-08', '2026-11-08', 'day', 1],
    ['آخر 7 أيام', '2026-11-02', '2026-11-08', 'day', 7],
    ['8 أيام (آخر حد لليومي)', '2026-11-01', '2026-11-08', 'day', 8],
    ['9 أيام ← أسابيع', '2026-11-01', '2026-11-09', 'week', 2],
    ['شهر 30 يوم', '2026-11-01', '2026-11-30', 'week', 5],
    ['56 يوم (آخر حد للأسابيع)', '2026-01-01', '2026-02-25', 'week', 8],
    ['57 يوم ← شهور', '2026-01-01', '2026-02-26', 'month', 2],
    ['آخر 6 شهور', '2026-06-01', '2026-11-30', 'month', 6],
    ['سنة ← أرباع', '2026-01-01', '2026-12-31', 'quarter', 4],
    ['سنتين', '2025-01-01', '2026-12-31', 'quarter', 8],
    ['3 سنين ← سنين', '2024-01-01', '2026-12-31', 'year', 3],
  ])('%s', (_name, from, to, unit, count) => {
    const t = run(from, to);
    expect(t.unit).toBe(unit);
    expect(t.buckets).toHaveLength(count);
  });

  it('مبيعدّيش الحد الأقصى حتى في فترة طويلة جدًا، والأعمدة بتغطي الفترة كلها', () => {
    const t = run('1990-03-15', '2026-11-08');
    expect(t.unit).toBe('years');
    expect(t.buckets.length).toBeLessThanOrEqual(MAX_COLUMNS);
    expect(t.buckets[0].from).toBe('1990-03-15');
    expect(t.buckets[t.buckets.length - 1].to).toBe('2026-11-08');
  });

  it.each([
    ['2026-11-01', '2026-11-30'], ['2026-06-17', '2026-11-08'], ['2024-02-29', '2026-03-01'], ['2025-12-31', '2026-01-09'], ['2010-05-05', '2026-11-08'],
  ])('الأعمدة ورا بعض من غير ثغرات ولا تداخل: %s لـ%s', (from, to) => {
    const { buckets } = run(from, to);
    expect(buckets[0].from).toBe(from);
    expect(buckets[buckets.length - 1].to).toBe(to);
    for (let i = 1; i < buckets.length; i++) {
      const prev = new Date(buckets[i - 1].to + 'T00:00:00Z').getTime();
      expect(new Date(buckets[i].from + 'T00:00:00Z').getTime() - prev).toBe(86400000);
    }
  });
});

describe('شكل العمود الناقص', () => {
  // WCAG 2.x: تركيب اللون بشفافية فوق المسار، وبعدين النسبة بين الملو المركّب والمسار
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lum = (c: number[]) => {
    const [r, g, b] = c.map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const dimmedOverTrack = (fill: string, track: string, alpha: number) => {
    const f = rgb(fill), t = rgb(track);
    return contrast(f.map((v, i) => v * alpha + t[i] * (1 - alpha)), t);
  };

  it.each([['الفاتح', LIGHT], ['الغامق', DARK]] as const)(
    'ملو العمود الناقص (accentText بشفافيته) يفضل ≥3:1 على المسار surface2 في الثيم %s — ولسه أخف من الكامل',
    (_n, theme) => {
      expect(dimmedOverTrack(theme.accentText, theme.surface2, PARTIAL_BAR_OPACITY)).toBeGreaterThanOrEqual(3);
      expect(PARTIAL_BAR_OPACITY).toBeLessThanOrEqual(0.85);
      // ألوان فئات الباليتة مش متغطية هنا: بعضها ~3.4 حتى بملو كامل فمفيش شفافية تنفع لكلها
    },
  );

  it('الإطار بلون العمود كامل ومن غير شفافية، والملو الأخف جواه بنفس اللون', () => {
    const frame = barFrameStyle({ partial: true }, '#123456');
    expect(frame.borderColor).toBe('#123456');
    expect(frame.borderWidth).toBeGreaterThanOrEqual(2);
    expect(frame).not.toHaveProperty('opacity');
    const fill = barFillStyle({ partial: true }, false, '#123456');
    expect(fill.backgroundColor).toBe('#123456');
    expect(fill.opacity).toBeLessThan(1);
    expect(fill.opacity).toBeGreaterThan(0.5);
  });

  it('الكامل من غير إطار وبملو كامل', () => {
    expect(barFrameStyle({ partial: false }, '#123456')).toEqual({ borderWidth: 0 });
    expect(barFillStyle({ partial: false }, false, '#123456')).toEqual({ backgroundColor: '#123456', opacity: 1 });
  });

  it('مع فلتر الفئات الملو شفاف (الألوان في الأجزاء) والشفافية على الملو مش على الإطار', () => {
    const fill = barFillStyle({ partial: true }, true, '#123456');
    expect(fill.backgroundColor).toBe('transparent');
    expect(fill.opacity).toBe(PARTIAL_BAR_OPACITY);
    expect(barFrameStyle({ partial: true }, '#123456')).toEqual({ borderWidth: 2, borderColor: '#123456' });
  });

  it('العمود الناقص ارتفاعه (share) وفلوسه حقيقيين، ومجموع الأعمدة = الرقم البطل', () => {
    const rows = [e('2026-11-01', 400), e('2026-11-09', 1655)];
    const t = spendTimeline(rows, { from: '2026-11-01', to: '2026-11-30' }, '2026-11-10');
    const partial = t.buckets.find(b => b.partial)!;
    expect(partial.amount).toBe(1655);
    expect(partial.share).toBeGreaterThan(0);
    expect(t.buckets.reduce((s, b) => s + b.amount, 0)).toBe(periodExpenseTotal(rows));
  });
});

describe('الفلوس', () => {
  const rows = [
    e('2026-11-01', 100.25, 'c1'), e('2026-11-07', 50, 'c2'), e('2026-11-08', 10, 'c1'),
    e('2026-11-20', 500, 'c2'), e('2026-11-30', 3.5), // تاريخ قدام جوه الفترة + من غير فئة
  ];

  it('مجموع الأعمدة = رقم مصروفات الفترة بالظبط، حتى بعملية بتاريخ قدام', () => {
    const t = spendTimeline(rows, { from: '2026-11-01', to: '2026-11-30' }, '2026-11-08');
    expect(t.buckets.reduce((s, b) => s + b.amount, 0)).toBeCloseTo(periodExpenseTotal(rows), 6);
  });

  it('فلتر الفئات: نفس قاعدة periodExpenseTotal، واللي من غير فئة برّه', () => {
    const t = spendTimeline(rows, { from: '2026-11-01', to: '2026-11-30' }, '2026-11-08', ['c1']);
    expect(t.buckets.reduce((s, b) => s + b.amount, 0)).toBeCloseTo(periodExpenseTotal(rows, ['c1']), 6);
    expect(t.buckets[0].amount).toBe(100.25);
    expect(t.buckets[1].amount).toBe(10);
  });

  it('أكبر عمود share = 1 والباقي بالنسبة ليه، ومن غير مصروف كله صفر', () => {
    const t = spendTimeline([e('2026-11-02', 400), e('2026-11-03', 100)], { from: '2026-11-02', to: '2026-11-08' }, '2026-11-08');
    expect(t.buckets[0].share).toBe(1);
    expect(t.buckets[1].share).toBe(0.25);
    expect(run('2026-11-02', '2026-11-08').buckets.every(b => b.share === 0)).toBe(true);
  });

  it('صف بايظ (NaN أو تاريخ مش نص) مبيبوّظش الأعمدة', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = [e('2026-11-02', NaN), { date: undefined as unknown as string, amount: 5 }, e('2026-11-02', 7)];
    const t = spendTimeline(bad, { from: '2026-11-02', to: '2026-11-08' }, '2026-11-08');
    expect(t.buckets[0].amount).toBe(7);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toMatch(/7/);
    warn.mockRestore();
  });

  it('تواريخ بايظة أو من بعد لحد ← مفيش أعمدة', () => {
    expect(run('2026-11-08', '2026-11-01').buckets).toEqual([]);
    expect(run('', '2026-11-01').buckets).toEqual([]);
    expect(run('2026-11-01', '2026-11-02', '').buckets).toEqual([]);
  });
});

describe('تقسيم العمود بالفئات', () => {
  const rows = [e('2026-11-02', 300, 'c1'), e('2026-11-02', 100, 'c2'), e('2026-11-02', 40, 'c3'), e('2026-11-03', 50, 'c2'), e('2026-11-03', 99, 'c9')];
  const range = { from: '2026-11-02', to: '2026-11-08' };

  it('الأجزاء بترتيب الشرايح ومجموعها = العمود، والفئة اللي مش مختارة برّه', () => {
    const { buckets } = spendTimeline(rows, range, '2026-11-08', ['c1', 'c2'], ['c1', 'c2']);
    expect(buckets[0].segments).toEqual([{ id: 'c1', amount: 300 }, { id: 'c2', amount: 100 }]);
    expect(buckets[0].amount).toBe(400);
    expect(buckets[1].segments).toEqual([{ id: 'c2', amount: 50 }]);
  });

  it('اللي برّه الشرايح بيتجمع في "فئات تانية" زي الرسم اللي فوقه', () => {
    const { buckets } = spendTimeline(rows, range, '2026-11-08', ['c1', 'c2', 'c3'], ['c1', GROUPED_SLICE_ID]);
    expect(buckets[0].segments).toEqual([{ id: 'c1', amount: 300 }, { id: GROUPED_SLICE_ID, amount: 140 }]);
  });

  it('من غير فلتر فئات مفيش أجزاء', () => {
    expect(spendTimeline(rows, range, '2026-11-08').buckets[0].segments).toEqual([]);
  });
});

describe('العمود الناقص واللي لسه ما جاش', () => {
  it('الأسبوع الأخير الأقصر ناقص، واللي فيه النهارده ناقص، واللي لسه ما جاش مش ناقص', () => {
    const { buckets } = run('2026-11-01', '2026-11-30', '2026-11-10');
    expect(buckets.map(b => [b.partial, b.future])).toEqual([
      [false, false], [true, false], [false, true], [false, true], [false, true],
    ]);
  });

  it('آخر يوم في العمود هو النهارده ← كامل، والأيام عمرها ما تبقى ناقصة', () => {
    expect(run('2026-11-01', '2026-11-28', '2026-11-07').buckets[0].partial).toBe(false);
    expect(run('2026-11-02', '2026-11-08', '2026-11-08').buckets.every(b => !b.partial)).toBe(true);
  });

  it('شهر متقصوص من أول الفترة ناقص، والشهر الكامل لأ', () => {
    const { buckets } = run('2026-01-15', '2026-04-30', '2026-11-08');
    expect(buckets.map(b => b.partial)).toEqual([true, false, false, false]);
  });
});

describe('الأسامي', () => {
  it('الأيام باسم اليوم والتاريخ', () => {
    const [b] = run('2026-11-08', '2026-11-08').buckets;
    expect([b.label, b.sublabel, b.spoken]).toEqual(['حد', '8/11', '8 نوفمبر 2026']);
  });

  it('أسبوع في شهر واحد، وأسبوع بين شهرين', () => {
    const { buckets } = run('2026-10-28', '2026-11-08');
    expect([buckets[0].label, buckets[0].sublabel]).toEqual(['28/10', '3/11']);
    expect([buckets[1].label, buckets[1].sublabel]).toEqual(['4–8', 'نوفمبر']);
    expect(buckets[1].spoken).toBe('من 4 نوفمبر 2026 لحد 8 نوفمبر 2026');
  });

  it('الشهور بالاسم، والسنة بتتكتب لو الفترة في سنتين بس', () => {
    expect(run('2026-06-01', '2026-11-30').buckets[0]).toMatchObject({ label: 'يونيو', sublabel: '' });
    expect(run('2025-11-01', '2026-02-28').buckets[0]).toMatchObject({ label: 'نوفمبر', sublabel: '2025' });
  });

  it('الأرباع: رقم الربع والسنة، حتى في سنة واحدة', () => {
    const { buckets } = run('2026-01-01', '2026-12-31');
    expect(buckets[3]).toMatchObject({ label: 'ربع 4', sublabel: '2026', spoken: 'من 1 أكتوبر 2026 لحد 31 ديسمبر 2026' });
  });

  it('آخر 6 شهور بتبدأ أول الشهر قبل 5 شهور، وبتعدّي السنة صح', () => {
    expect(sixMonthsStart('2026-11-08')).toBe('2026-06-01');
    expect(sixMonthsStart('2027-01-31')).toBe('2026-08-01');
  });

  it('سطر الفترة: يوم واحد من غير "من/لحد"', () => {
    expect(rangeText('2026-11-08', '2026-11-08')).toBe('8 نوفمبر 2026');
    expect(rangeText('2026-11-01', '2026-11-30')).toBe('من 1 نوفمبر 2026 لحد 30 نوفمبر 2026');
  });
});
