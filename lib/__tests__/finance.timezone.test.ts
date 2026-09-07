import { addDays, addMonths, currentMonth, daysUntil, endOfMonth, startOfMonth, todayStr } from '@/lib/finance';

/**
 * حسابات التواريخ اتكسرت قبل كده بسبب الخلط بين UTC والتوقيت المحلي، والباجات
 * دي مكانتش بتظهر خالص لما الاختبارات بتشتغل بتوقيت UTC (وده الافتراضي على
 * أغلب أجهزة الـ CI) — كانت بتظهر بس عند المستخدم المصري.
 *
 * الملف ده بيتشغّل في كذا توقيت حقيقي عن طريق `npm run test:tz` (شوف
 * scripts/test-timezones.js). تغيير التوقيت من جوه الاختبار مبينفعش لأن جيست
 * بيعزل process.env فالتغيير مبيوصلش للنظام — فبنشغّل جيست نفسه بتوقيت مختلف
 * كل مرة. التوقعات هنا مكتوبة عشان تبقى صح في أي توقيت، فأي رجوع للخلط بين
 * UTC والمحلي هيكسر الملف ده في القاهرة على الأقل.
 */

const pad = (n: number) => String(n).padStart(2, '0');

describe(`حسابات التواريخ بتوقيت ${process.env.TZ || '(توقيت الجهاز)'}`, () => {
  it('endOfMonth بيرجع آخر يوم حقيقي في الشهر مش اللي قبله', () => {
    expect(endOfMonth('2026-01-15')).toBe('2026-01-31');
    expect(endOfMonth('2026-04-10')).toBe('2026-04-30');
    expect(endOfMonth('2026-12-05')).toBe('2026-12-31');
  });

  it('endOfMonth بيعرف فبراير في السنة العادية والكبيسة', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
  });

  it('endOfMonth صح في كل شهور السنة (ده كان غلط في 12 شهر من 12 بتوقيت القاهرة)', () => {
    const lastDays2026 = ['31', '28', '31', '30', '31', '30', '31', '31', '30', '31', '30', '31'];
    lastDays2026.forEach((day, i) => {
      const month = pad(i + 1);
      expect(endOfMonth(`2026-${month}-10`)).toBe(`2026-${month}-${day}`);
    });
  });

  it('addDays مبيضيعش يوم في يوم بداية التوقيت الصيفي المصري', () => {
    // 24 أبريل 2026 هو يوم بداية التوقيت الصيفي في مصر — ده كان بيرجع نفس اليوم
    expect(addDays('2026-04-23', 1)).toBe('2026-04-24');
    expect(addDays('2026-04-24', 1)).toBe('2026-04-25');
  });

  it('addDays مبيضيعش يوم في يوم نهاية التوقيت الصيفي كمان', () => {
    expect(addDays('2026-10-29', 1)).toBe('2026-10-30');
    expect(addDays('2026-10-30', 1)).toBe('2026-10-31');
  });

  it('addDays على مدار سنة كاملة بيدي 365 يوم مختلفين من غير تكرار ولا نقص', () => {
    // لو ضاع يوم عند تغيير التوقيت، هيتكرر تاريخ والعدد هيقل
    const seen = new Set<string>();
    let cursor = '2026-01-01';
    for (let i = 0; i < 365; i++) {
      seen.add(cursor);
      cursor = addDays(cursor, 1);
    }
    expect(seen.size).toBe(365);
    expect(cursor).toBe('2027-01-01');
  });

  it('addDays بيعدّي حدود الشهر والسنة صح', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('addMonths (مواعيد الاشتراكات وشهور الجمعية) مبيضيعش يوم عند التوقيت الصيفي', () => {
    // ده كان بيرجع 2026-05-09 بتوقيت القاهرة
    expect(addMonths('2026-04-10', 1)).toBe('2026-05-10');
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
    expect(addMonths('2026-03-10', -1)).toBe('2026-02-10');
  });

  it('جدول جمعية 12 شهر بيقع كله في نفس اليوم من كل شهر', () => {
    const dueDates = Array.from({ length: 12 }, (_, i) => addMonths('2026-01-10', i));
    expect(dueDates).toEqual([
      '2026-01-10', '2026-02-10', '2026-03-10', '2026-04-10',
      '2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10',
      '2026-09-10', '2026-10-10', '2026-11-10', '2026-12-10',
    ]);
  });

  it('تقديم موعد الاشتراك ورجوعه خطوة بيرجّعوا لنفس التاريخ بالظبط', () => {
    // ده اللي بيعتمد عليه تنسيق الاشتراك لما آخر دفعة بتتحذف.
    // اليوم هنا لازم يكون موجود في كل الشهور (28 أو أقل) — شوف الاختبار اللي
    // بعده بخصوص أيام آخر الشهر
    ['2026-04-10', '2026-10-28', '2026-02-15', '2026-12-15'].forEach(date => {
      expect(addMonths(addMonths(date, 1), -1)).toBe(date);
      expect(addDays(addDays(date, 30), -30)).toBe(date);
    });
  });

  it('يوم 31 + شهر بيتقصّ على آخر يوم في الشهر مش بيقفز للشهر اللي بعده', () => {
    // اشتراك مستحق يوم 31 لازم يتخصم آخر فبراير، مش يفوّت فبراير كله ويروح مارس
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2026-05-31', -1)).toBe('2026-04-30');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
  });

  it('اليوم الأصلي بيرجع في الشهور اللي بتسمح بيه', () => {
    // الشهر اللي بعد المقصوص بياخد اليوم اللي التقصّ وصله (خاصية أصيلة في حساب
    // الشهور: اليوم الأصلي 31 مش متخزّن في أي مكان)
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonths(addMonths('2026-01-31', 1), -1)).toBe('2026-01-28');
  });

  it('جدول جمعية بادئ آخر الشهر مبيفوّتش شهر ومبيكررش تاريخ', () => {
    const dueDates = Array.from({ length: 6 }, (_, i) => addMonths('2026-01-31', i));
    expect(dueDates).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
    ]);
    expect(new Set(dueDates).size).toBe(6);
  });

  it('startOfMonth ثابت في أي توقيت', () => {
    expect(startOfMonth('2026-03-31')).toBe('2026-03-01');
    expect(startOfMonth('2026-01-01')).toBe('2026-01-01');
  });

  it('daysUntil بيحسب نفس عدد الأيام مهما كان التوقيت', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
      expect(daysUntil('2026-04-27')).toBe(7);
      expect(daysUntil('2026-04-20')).toBe(0);
      expect(daysUntil('2026-04-19')).toBe(-1);
      // الفترة دي بتعدّي بداية التوقيت الصيفي المصري (24 أبريل)
      expect(daysUntil('2026-05-01')).toBe(11);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('todayStr بياخد اليوم من ساعة الجهاز المحلية', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('بيطابق اليوم بالتقويم المحلي في أي ساعة من اليوم', () => {
    // ده الاختبار اللي بيمسك الباج الأصلي: المستخدم اللي بيسجل عملية الساعة 1
    // بالليل بالقاهرة كانت بتتحفظ بتاريخ امبارح لأن الحساب كان على UTC
    jest.useFakeTimers();
    for (let hour = 0; hour < 24; hour++) {
      jest.setSystemTime(new Date(Date.UTC(2026, 5, 14, hour, 30)));
      const now = new Date();
      const expected = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      expect(todayStr()).toBe(expected);
    }
  });

  it('بيطابق اليوم المحلي كمان في يوم تغيير التوقيت الصيفي', () => {
    jest.useFakeTimers();
    for (const day of [23, 24, 25]) {
      for (const hour of [0, 1, 12, 22, 23]) {
        jest.setSystemTime(new Date(Date.UTC(2026, 3, day, hour, 30)));
        const now = new Date();
        const expected = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        expect(todayStr()).toBe(expected);
      }
    }
  });

  it('currentMonth بيطلع من نفس اليوم المحلي', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.UTC(2026, 5, 14, 23, 30)));
    expect(currentMonth()).toBe(todayStr().slice(0, 7));
  });

  it('اليوم اللي بيطلع من todayStr بيشتغل مع باقي الحسابات من غير انزياح', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.UTC(2026, 0, 31, 23, 0)));
    const today = todayStr();
    expect(daysUntil(today)).toBe(0);
    expect(daysUntil(addDays(today, 1))).toBe(1);
    expect(startOfMonth(today) <= today).toBe(true);
    expect(today <= endOfMonth(today)).toBe(true);
    expect(endOfMonth(today).slice(0, 7)).toBe(currentMonth());
  });
});
