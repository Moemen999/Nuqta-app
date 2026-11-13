import { MONTH_NAMES, dateText, dayText } from '@/lib/dateText';

describe('dateText', () => {
  it('نفس السنة: يوم وشهر من غير سنة', () => {
    expect(dateText('2026-11-12', '2026-11-13')).toBe('12 نوفمبر');
    expect(dateText('2026-01-05', '2026-11-13')).toBe('5 يناير');
  });
  it('سنة تانية: السنة بتتضاف، سابقة أو لاحقة', () => {
    expect(dateText('2025-11-12', '2026-11-13')).toBe('12 نوفمبر 2025');
    expect(dateText('2027-02-01', '2026-11-13')).toBe('1 فبراير 2027');
  });
  it('كل أسامي الشهور الـ12', () => {
    const expected = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    expect(MONTH_NAMES).toEqual(expected);
    expected.forEach((name, i) => {
      const mm = String(i + 1).padStart(2, '0');
      expect(dateText(`2026-${mm}-09`, '2026-06-01')).toBe(`9 ${name}`);
    });
  });
  it('مدخل مش تاريخ بيرجع زي ما هو من غير ما يرمي', () => {
    for (const bad of ['', undefined as any, '2026-13-45', 'abc', '2026-1-5']) {
      expect(() => dateText(bad, '2026-11-13')).not.toThrow();
      expect(dateText(bad, '2026-11-13')).toBe(bad);
      expect(dayText(bad, '2026-11-13')).toBe(bad);
    }
  });
});

describe('dayText', () => {
  const today = '2026-11-13';
  it('النهاردة وامبارح', () => {
    expect(dayText('2026-11-13', today)).toBe('النهاردة');
    expect(dayText('2026-11-12', today)).toBe('امبارح');
  });
  it('من يومين وأقدم: تاريخ عادي', () => {
    expect(dayText('2026-11-11', today)).toBe('11 نوفمبر');
    expect(dayText('2025-11-12', today)).toBe('12 نوفمبر 2025');
  });
  it('امبارح عبر حدود الشهر', () => {
    expect(dayText('2026-11-30', '2026-12-01')).toBe('امبارح');
    expect(dayText('2026-02-28', '2026-03-01')).toBe('امبارح');
  });
  it('امبارح عبر حدود السنة (وبعده بيوم بيبان بسنته)', () => {
    expect(dayText('2026-12-31', '2027-01-01')).toBe('امبارح');
    expect(dayText('2026-12-30', '2027-01-01')).toBe('30 ديسمبر 2026');
  });
  it('تاريخ جاي: تاريخ عادي من غير «بكرة»', () => {
    expect(dayText('2026-11-14', today)).toBe('14 نوفمبر');
    expect(dayText('2027-01-01', today)).toBe('1 يناير 2027');
  });
});

describe('coldFiguresText (بانر الأرقام القديمة)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { coldFiguresText } = require('@/lib/coldCache');
  const fmt = () => '11:34 ص';
  const now = new Date(2026, 10, 13, 9, 0);
  it('امبارح بالتوقيت المحلي', () => {
    expect(coldFiguresText(new Date(2026, 10, 12, 23, 34).getTime(), fmt, now)).toContain('(امبارح · 11:34 ص)');
  });
  it('النهاردة وتاريخ أقدم', () => {
    expect(coldFiguresText(new Date(2026, 10, 13, 0, 5).getTime(), fmt, now)).toContain('(النهاردة · 11:34 ص)');
    expect(coldFiguresText(new Date(2026, 10, 9, 8, 0).getTime(), fmt, now)).toContain('(9 نوفمبر · 11:34 ص)');
    expect(coldFiguresText(new Date(2025, 10, 9, 8, 0).getTime(), fmt, now)).toContain('(9 نوفمبر 2025 · 11:34 ص)');
  });
});
