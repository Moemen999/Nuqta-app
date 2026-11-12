import { comparisonWindows } from '@/lib/periodCompare';

const w = (cf: string, ct: string, pf: string, pt: string) => ({
  current: { from: cf, to: ct },
  previous: { from: pf, to: pt },
});

describe('comparisonWindows', () => {
  it('thisMonth في نص الشهر: نفس أيام الشهر اللي فات (مثال 12 نوفمبر)', () => {
    expect(comparisonWindows({ from: '2026-11-01', to: '2026-11-30' }, '2026-11-12', 'thisMonth'))
      .toEqual(w('2026-11-01', '2026-11-12', '2026-10-01', '2026-10-12'));
  });

  it('thisMonth يوم 31 والشهر اللي فات 30 يوم: بيتقص على آخر يوم', () => {
    expect(comparisonWindows({ from: '2026-10-01', to: '2026-10-31' }, '2026-10-31', 'thisMonth'))
      .toEqual(w('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30'));
  });

  it('thisMonth يوم 31 والشهر اللي فات 28 يوم', () => {
    expect(comparisonWindows({ from: '2026-03-01', to: '2026-03-31' }, '2026-03-31', 'thisMonth'))
      .toEqual(w('2026-03-01', '2026-03-31', '2026-02-01', '2026-02-28'));
  });

  it('thisMonth يوم 31 والشهر اللي فات 29 يوم (سنة كبيسة)', () => {
    expect(comparisonWindows({ from: '2028-03-01', to: '2028-03-31' }, '2028-03-31', 'thisMonth'))
      .toEqual(w('2028-03-01', '2028-03-31', '2028-02-01', '2028-02-29'));
  });

  it('thisMonth يوم 1: يوم واحد قصاد يوم واحد', () => {
    expect(comparisonWindows({ from: '2026-11-01', to: '2026-11-30' }, '2026-11-01', 'thisMonth'))
      .toEqual(w('2026-11-01', '2026-11-01', '2026-10-01', '2026-10-01'));
  });

  it('thisMonth في يناير: الشهر اللي فات ديسمبر السنة اللي فاتت', () => {
    expect(comparisonWindows({ from: '2027-01-01', to: '2027-01-31' }, '2027-01-15', 'thisMonth'))
      .toEqual(w('2027-01-01', '2027-01-15', '2026-12-01', '2026-12-15'));
  });

  it('last6Months في نص الشهر: النهاية بتتقص على النهارده، والسابقة بنفس الطول قبل البداية', () => {
    // 2026-06-01..2026-11-12 = 30+31+31+30+31+12 = 165 يوم
    expect(comparisonWindows({ from: '2026-06-01', to: '2026-11-30' }, '2026-11-12', 'last6Months'))
      .toEqual(w('2026-06-01', '2026-11-12', '2025-12-18', '2026-05-31'));
  });

  it('lastMonth زي ما هي', () => {
    // أكتوبر 31 يوم ← السابقة 31 يوم قبل 1 أكتوبر
    expect(comparisonWindows({ from: '2026-10-01', to: '2026-10-31' }, '2026-11-12', 'lastMonth'))
      .toEqual(w('2026-10-01', '2026-10-31', '2026-08-31', '2026-09-30'));
  });

  it('last7 زي ما هي', () => {
    expect(comparisonWindows({ from: '2026-11-06', to: '2026-11-12' }, '2026-11-12', 'last7'))
      .toEqual(w('2026-11-06', '2026-11-12', '2026-10-30', '2026-11-05'));
  });

  it('custom كله في الماضي زي ما هو', () => {
    expect(comparisonWindows({ from: '2026-09-10', to: '2026-09-19' }, '2026-11-12', 'custom'))
      .toEqual(w('2026-09-10', '2026-09-19', '2026-08-31', '2026-09-09'));
  });

  it('custom بيخلص في المستقبل: بيتقص على النهارده', () => {
    expect(comparisonWindows({ from: '2026-11-10', to: '2026-11-20' }, '2026-11-12', 'custom'))
      .toEqual(w('2026-11-10', '2026-11-12', '2026-11-07', '2026-11-09'));
  });

  it('custom كله في المستقبل: null', () => {
    expect(comparisonWindows({ from: '2026-11-13', to: '2026-11-20' }, '2026-11-12', 'custom')).toBeNull();
  });

  it('custom بيبدأ النهارده: يوم واحد', () => {
    expect(comparisonWindows({ from: '2026-11-12', to: '2026-11-20' }, '2026-11-12', 'custom'))
      .toEqual(w('2026-11-12', '2026-11-12', '2026-11-11', '2026-11-11'));
  });
});
