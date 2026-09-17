import { GROUPED_SLICE_ID, PIE_TOP_N, buildPieSlices, groupedSliceName, type PieSlice } from '@/lib/finance';

const GROUPED_COLOR = '#999999';

function cats(n: number, startAmount = 100): PieSlice[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    name: `فئة ${i}`,
    amount: startAmount - i,
    color: `#00000${i}`,
  }));
}

describe('groupedSliceName', () => {
  it('بيحط العدد جوه الاسم', () => {
    expect(groupedSliceName(3)).toBe('فئات تانية (3)');
    expect(groupedSliceName(1)).toBe('فئات تانية (1)');
    expect(groupedSliceName(12)).toBe('فئات تانية (12)');
  });

  it('مختلف عن فئة المستخدم المسماة "أخرى" — دي فئة افتراضية بتتزرع لكل حساب', () => {
    expect(groupedSliceName(4, ['أخرى'])).toBe('فئات تانية (4)');
    expect(groupedSliceName(4, ['أخرى'])).not.toBe('أخرى');
  });

  it('مختلف عن فئة المستخدم لو اسمها حرفيًا "فئات تانية"', () => {
    const name = groupedSliceName(4, ['فئات تانية']);
    expect(name).toBe('فئات تانية (4)');
    expect(name).not.toBe('فئات تانية');
  });

  it('بيفضل فريد حتى لو فئة المستخدم اسمها الاسم بالعدد بالظبط', () => {
    expect(groupedSliceName(2, ['فئات تانية (2)'])).toBe('فئات تانية (2) *');
    expect(groupedSliceName(2, ['فئات تانية (2)', 'فئات تانية (2) *'])).toBe('فئات تانية (2) **');
  });

  it('مش بيتأثر باسم مشابه لعدد تاني', () => {
    expect(groupedSliceName(2, ['فئات تانية (3)'])).toBe('فئات تانية (2)');
  });
});

describe('buildPieSlices', () => {
  it('لغاية العدد الأقصى: مفيش شريحة مجمّعة خالص', () => {
    for (let n = 0; n <= PIE_TOP_N; n++) {
      const out = buildPieSlices(cats(n), GROUPED_COLOR);
      expect(out).toHaveLength(n);
      expect(out.some(s => s.id === GROUPED_SLICE_ID)).toBe(false);
    }
  });

  it('بيرتب تنازليًا بالمصروف', () => {
    const out = buildPieSlices(
      [
        { id: 'a', name: 'أ', amount: 10, color: '#1' },
        { id: 'b', name: 'ب', amount: 90, color: '#2' },
        { id: 'c', name: 'ج', amount: 50, color: '#3' },
      ],
      GROUPED_COLOR
    );
    expect(out.map(s => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('العدد في الاسم = عدد الفئات المجمّعة، مش إجمالي الفئات', () => {
    const out = buildPieSlices(cats(PIE_TOP_N + 3), GROUPED_COLOR);
    expect(out).toHaveLength(PIE_TOP_N + 1);
    expect(out[out.length - 1].name).toBe('فئات تانية (3)');
  });

  it('فئة واحدة زيادة بس: العدد بيبقى 1', () => {
    const out = buildPieSlices(cats(PIE_TOP_N + 1), GROUPED_COLOR);
    expect(out[out.length - 1].name).toBe('فئات تانية (1)');
  });

  it('مبلغ الشريحة المجمّعة = مجموع اللي اتلمّ، ومجموع الشرايح كلها ما اتغيرش', () => {
    const input = cats(PIE_TOP_N + 4);
    const total = input.reduce((s, c) => s + c.amount, 0);
    const out = buildPieSlices(input, GROUPED_COLOR);

    const grouped = out[out.length - 1];
    const smallest = [...input].sort((a, b) => b.amount - a.amount).slice(PIE_TOP_N);
    expect(grouped.amount).toBe(smallest.reduce((s, c) => s + c.amount, 0));
    expect(out.reduce((s, c) => s + c.amount, 0)).toBe(total);
  });

  it('الشريحة المجمّعة بتاخد اللون المحايد ومعرّف ثابت', () => {
    const out = buildPieSlices(cats(PIE_TOP_N + 2), GROUPED_COLOR);
    const grouped = out[out.length - 1];
    expect(grouped.id).toBe(GROUPED_SLICE_ID);
    expect(grouped.color).toBe(GROUPED_COLOR);
  });

  it('فئة المستخدم المسماة "أخرى" بتفضل باسمها، والمجمّعة اسم تاني', () => {
    const input: PieSlice[] = [
      { id: 'other-cat', name: 'أخرى', amount: 1000, color: '#1' },
      ...cats(PIE_TOP_N + 2, 100),
    ];
    const out = buildPieSlices(input, GROUPED_COLOR);

    const userOther = out.find(s => s.id === 'other-cat');
    expect(userOther?.name).toBe('أخرى');
    // 10 شرايح كلها، 7 فوق، فـ3 اتلمّوا
    const grouped = out.find(s => s.id === GROUPED_SLICE_ID);
    expect(grouped?.name).toBe('فئات تانية (3)');
    expect(new Set(out.map(s => s.name)).size).toBe(out.length);
  });

  it('فئة مستخدم اسمها "فئات تانية" ظاهرة في الرسم: الأسماء بتفضل كلها مختلفة', () => {
    const input: PieSlice[] = [
      { id: 'clash', name: 'فئات تانية', amount: 1000, color: '#1' },
      ...cats(PIE_TOP_N + 1, 100),
    ];
    const out = buildPieSlices(input, GROUPED_COLOR);

    expect(out.find(s => s.id === 'clash')?.name).toBe('فئات تانية');
    expect(out.find(s => s.id === GROUPED_SLICE_ID)?.name).toBe('فئات تانية (2)');
    expect(new Set(out.map(s => s.name)).size).toBe(out.length);
  });

  it('فئة مستخدم اسمها الاسم بالعدد بالظبط: الأسماء برضه بتفضل مختلفة', () => {
    // فئة غالية عشان تفضل في أول 7 ويحصل التصادم فعلاً
    const input: PieSlice[] = [
      { id: 'clash', name: 'فئات تانية (2)', amount: 1000, color: '#1' },
      ...cats(PIE_TOP_N + 1, 100),
    ];
    const out = buildPieSlices(input, GROUPED_COLOR);

    expect(out.find(s => s.id === 'clash')?.name).toBe('فئات تانية (2)');
    expect(out.find(s => s.id === GROUPED_SLICE_ID)?.name).toBe('فئات تانية (2) *');
    expect(new Set(out.map(s => s.name)).size).toBe(out.length);
  });

  it('مبيغيّرش المصفوفة الأصلية', () => {
    const input = cats(PIE_TOP_N + 2);
    const snapshot = input.map(c => c.id);
    buildPieSlices(input, GROUPED_COLOR);
    expect(input.map(c => c.id)).toEqual(snapshot);
    expect(input).toHaveLength(PIE_TOP_N + 2);
  });
});
