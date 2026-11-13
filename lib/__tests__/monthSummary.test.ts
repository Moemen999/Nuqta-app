import { monthSummary } from '@/lib/monthSummary';

const exp = (id: string, amount: number, date: string, type = 'expense') => ({ id, type, amount, date });
const none = new Set<string>();
const run = (transactions: ReturnType<typeof exp>[], today: string, totalBudget = 0, transfers = none) =>
  monthSummary({ transactions, transfers, today, totalBudget });

describe('monthSummary: spent', () => {
  it('مصروف الشهر كله من غير التحويلات والدخل (وفيه عملية تاريخها جاي)', () => {
    const tx = [exp('a', 100, '2026-11-02'), exp('b', 50, '2026-11-25'), exp('loan', 2000, '2026-11-03'), exp('i', 900, '2026-11-04', 'income'), exp('o', 7, '2026-10-30')];
    expect(run(tx, '2026-11-13', 0, new Set(['loan'])).spent).toBe(150);
  });
  it('مفيش عمليات ← 0', () => {
    expect(run([], '2026-11-13').spent).toBe(0);
  });
});

describe('monthSummary: budget', () => {
  it('مفيش ميزانية (0 أو سالب أو NaN) ← null', () => {
    expect(run([], '2026-11-13', 0).budget).toBeNull();
    expect(run([], '2026-11-13', -5).budget).toBeNull();
    expect(run([], '2026-11-13', NaN).budget).toBeNull();
  });
  it('تحت: الفاضل والدرجة', () => {
    expect(run([exp('a', 5650, '2026-11-02')], '2026-11-13', 8000).budget).toEqual({ limit: 8000, remaining: 2350, level: 'under' });
  });
  it('قربت / خلصت / عدّيت', () => {
    expect(run([exp('a', 6800, '2026-11-02')], '2026-11-13', 8000).budget).toEqual({ limit: 8000, remaining: 1200, level: 'near' });
    expect(run([exp('a', 8000, '2026-11-02')], '2026-11-13', 8000).budget).toEqual({ limit: 8000, remaining: 0, level: 'at' });
    expect(run([exp('a', 8450, '2026-11-02')], '2026-11-13', 8000).budget).toEqual({ limit: 8000, remaining: -450, level: 'over' });
  });
  it('كسور الجمع: الفاضل مبيطلعش 4e-17', () => {
    const b = run([exp('a', 0.1, '2026-11-02'), exp('b', 0.2, '2026-11-03')], '2026-11-13', 0.3).budget!;
    expect(b.remaining).toBe(0);
    expect(b.level).toBe('at');
  });
});

describe('monthSummary: previous', () => {
  const history = [exp('o1', 1000, '2026-10-05'), exp('o2', 2775, '2026-10-13'), exp('o3', 9999, '2026-10-20'), exp('n1', 100, '2026-11-02')];

  it('النهارده 13 نوفمبر ← أكتوبر 1–13، مش الشهر كله', () => {
    expect(run(history, '2026-11-13').previous).toEqual({ total: 3775, to: '2026-10-13', wholeMonth: false });
  });
  it('النهارده 31 أكتوبر ← سبتمبر كله (30)، wholeMonth', () => {
    const tx = [exp('s1', 400, '2026-09-10'), exp('s2', 100, '2026-09-30'), exp('o1', 50, '2026-10-02')];
    expect(run(tx, '2026-10-31').previous).toEqual({ total: 500, to: '2026-09-30', wholeMonth: true });
  });
  it('النهارده 28 مارس ← فبراير كله بس مش «كله» (28 مش أقل من 28)', () => {
    const tx = [exp('f1', 10, '2026-02-28'), exp('m1', 1, '2026-03-01')];
    expect(run(tx, '2026-03-28').previous).toEqual({ total: 10, to: '2026-02-28', wholeMonth: false });
  });
  it('النهارده 30 نوفمبر ← أكتوبر لحد 30 (مش آخر الشهر) ← مش wholeMonth', () => {
    expect(run(history, '2026-11-30').previous).toMatchObject({ to: '2026-10-30', wholeMonth: false });
  });
  it('الشهر اللي فات صفر بس فيه تاريخ أقدم ← total 0 مش null', () => {
    const tx = [exp('old', 50, '2026-08-01'), exp('n1', 100, '2026-11-02')];
    expect(run(tx, '2026-11-13').previous).toEqual({ total: 0, to: '2026-10-13', wholeMonth: false });
  });
  it('الدخل قبل أول الشهر كفاية يثبت إن فيه تاريخ (مش أول شهر)', () => {
    const tx = [exp('inc', 5000, '2026-10-01', 'income'), exp('n1', 100, '2026-11-02')];
    expect(run(tx, '2026-11-13').previous).toEqual({ total: 0, to: '2026-10-13', wholeMonth: false });
  });
  it('عمليات الشهر ده بس ← null (أول شهر في الاستخدام)', () => {
    expect(run([exp('n1', 100, '2026-11-02')], '2026-11-13').previous).toBeNull();
    expect(run([], '2026-11-13').previous).toBeNull();
  });
  it('سجل بتاريخ فاضي أو بايظ مش بيثبت إن فيه تاريخ ← previous null', () => {
    expect(run([exp('n1', 100, '2026-11-02'), exp('bad', 5, '')], '2026-11-13').previous).toBeNull();
    expect(run([exp('n1', 100, '2026-11-02'), exp('bad', 5, 'garbage')], '2026-11-13').previous).toBeNull();
  });
  it('السلفة مش داخلة في الشهر اللي فات', () => {
    const tx = [exp('loan', 3000, '2026-10-05'), exp('o1', 10, '2026-10-06')];
    expect(run(tx, '2026-11-13', 0, new Set(['loan'])).previous?.total).toBe(10);
  });
  it('تاريخ النهارده بايظ ← previous null ومفيش كراش', () => {
    expect(run(history, 'garbage').previous).toBeNull();
  });
});
