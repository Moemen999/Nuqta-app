import { budgetForecastText, budgetRunOutDay } from '@/lib/budgetForecast';

/** مصروف موزّع على 3 عمليات عادية */
const three = (total: number) => [total / 2, total / 4, total / 4].map(amount => ({ amount }));
const run = (spend: number, limit: number, today: string, shown = spend) => budgetRunOutDay(three(spend), limit, today, shown);

describe('budgetRunOutDay', () => {
  it('بالمعدل ده هتخلص قبل آخر الشهر ← اليوم', () => {
    // 10 أيام، صرف 500 من 1000 ← 50 في اليوم ← يوم 20
    expect(run(500, 1000, '2026-11-10')).toBe(20);
  });

  it('بيقرّب لفوق: لسه ما وصلش السقف إلا في اليوم ده', () => {
    // 10 أيام، 450 من 1000 ← 45 في اليوم ← 22.2 ← يوم 23
    expect(run(450, 1000, '2026-11-10')).toBe(23);
  });

  it('أول 7 أيام مفيش نصيحة (قرار مؤمن)، ويوم 8 فيه', () => {
    expect(run(300, 1000, '2026-11-07')).toBeNull();
    expect(run(300, 1000, '2026-11-08')).toBe(27);
  });

  it('أقل من 3 مصاريف ← مفيش (قرار مؤمن: فاتورة واحدة مش معدل)', () => {
    expect(budgetRunOutDay([{ amount: 500 }], 1000, '2026-11-10', 500)).toBeNull();
    expect(budgetRunOutDay([{ amount: 250 }, { amount: 250 }], 1000, '2026-11-10', 500)).toBeNull();
    expect(budgetRunOutDay([{ amount: 250 }, { amount: 200 }, { amount: 50 }], 1000, '2026-11-10', 500)).toBe(20);
  });

  it('اللي اتسجل لوحده مش في المعدل ولا العدد، بس محسوب من الفاضل', () => {
    // اشتراك 300 لوحده + 200 عادي على 3 عمليات، يوم 10: الفاضل 500، المعدل 20/يوم ← 10 + 25 = يوم 35 ← بعد آخر الشهر
    const rows = [{ amount: 300, autoRecorded: true }, { amount: 100 }, { amount: 50 }, { amount: 50 }];
    expect(budgetRunOutDay(rows, 1000, '2026-11-10', 500)).toBeNull();
    // نفس الكلام والسقف 700: الفاضل 200 ← 10 + 10 = يوم 20
    expect(budgetRunOutDay(rows, 700, '2026-11-10', 500)).toBe(20);
    // الاشتراك + عمليتين عاديتين بس ← مفيش
    expect(budgetRunOutDay(rows.slice(0, 3), 700, '2026-11-10', 450)).toBeNull();
  });

  it('لو اليوم المتوقع بعد آخر الشهر ← مفيش', () => {
    expect(run(100, 1000, '2026-11-10')).toBeNull();
    // فبراير 28 يوم: 10 أيام، 350 من 1000 ← يوم 29 ← مفيش
    expect(run(350, 1000, '2027-02-10')).toBeNull();
  });

  it('رقم الكارت وصل 80% أو عدّى ← مفيش (لون "قربت تخلص" بيقولها)، والحد بالظبط 80% مفيش', () => {
    expect(run(800, 1000, '2026-11-10')).toBeNull();
    expect(run(1200, 1000, '2026-11-10')).toBeNull();
    expect(run(799, 1000, '2026-11-10')).toBe(13);
  });

  it('أرقام مظبوطة متتأخرش يوم من التقريب العشري', () => {
    // يوم 14، 150 من 300 ← بالظبط يوم 28 (القسمة الأول كانت بتدّي 29)
    expect(run(150, 300, '2026-11-14')).toBe(28);
  });

  it('المعدل من المصروف لحد النهارده، والفاضل وشرط 80% من رقم الكارت', () => {
    // لحد النهارده 400 (40/يوم)، والكارت 500 بعملية بتاريخ قدام: الفاضل 500 ← 10 + 12.5 ← يوم 23
    expect(run(400, 1000, '2026-11-10', 500)).toBe(23);
    expect(run(400, 1000, '2026-11-10', 800)).toBeNull();
  });

  it('مفيش ميزانية أو مفيش صرف أو رقم بايظ أو شهر بايظ ← مفيش', () => {
    expect(run(500, 0, '2026-11-10')).toBeNull();
    expect(run(0, 1000, '2026-11-10')).toBeNull();
    expect(budgetRunOutDay([{ amount: NaN }, { amount: 1 }, { amount: 1 }], 1000, '2026-11-10', 2)).toBeNull();
    expect(run(500, Infinity, '2026-11-10')).toBeNull();
    expect(run(500, 1000, '')).toBeNull();
    expect(run(500, 1000, '2026-13-10')).toBeNull();
  });
});

it('النص باسم الشهر', () => {
  expect(budgetForecastText(20, '2026-11-10')).toBe('لو كمّلت بنفس المعدل، الميزانية هتخلص يوم 20 نوفمبر');
});
