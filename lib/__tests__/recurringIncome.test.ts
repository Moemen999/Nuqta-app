import {
  INCOME_CATCHUP_MAX, WEEKDAY_NAMES, incomeDiffNote, incomeRecordedNotification, incomeDueDate, incomeOpenPeriods, incomePeriodLabel,
  incomeHasRecords, incomeRecordedMessage, incomeRescheduleStart, incomeScheduleKeysChange, incomeScheduleLabel, incomeTxDate, incomeTxId,
  incomeUpcomingPeriod, morePeriodsPhrase, validateIncomeDraft,
  type RecurringIncome,
} from '@/lib/recurringIncome';

/**
 * الدخل الثابت: كل حاجة هنا تواريخ ومعرّفات — ولو واحدة غلطت، يا المرتب
 * بيتسجل مرتين يا بيتفوّت شهر. فكل حالة تاريخ ليها اختبار.
 */

function income(over: Partial<RecurringIncome> = {}): RecurringIncome {
  return {
    id: 'inc1', name: 'المرتب', amount: 8000, walletId: 'w1',
    frequency: 'monthly', dayOfMonth: 25, mode: 'confirm', status: 'active',
    startDate: '2026-01-01', closed: {}, createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('يوم الاستحقاق الشهري', () => {
  it('اليوم العادي', () => {
    expect(incomeDueDate(income(), '2026-03')).toBe('2026-03-25');
  });

  it('يوم 31 في شهر أقصر ← آخر يوم', () => {
    const i = income({ dayOfMonth: 31 });
    expect(incomeDueDate(i, '2026-04')).toBe('2026-04-30');
    expect(incomeDueDate(i, '2026-02')).toBe('2026-02-28');
    expect(incomeDueDate(i, '2026-01')).toBe('2026-01-31');
  });

  it('فبراير الكبيسة', () => {
    expect(incomeDueDate(income({ dayOfMonth: 30 }), '2028-02')).toBe('2028-02-29');
  });
});

describe('الفترات المفتوحة (معادها جه وما اتقفلتش)', () => {
  it('قبل المعاد ← مفيش', () => {
    expect(incomeOpenPeriods(income(), '2026-01-24')).toEqual([]);
  });

  it('يوم المعاد نفسه ← مفتوحة', () => {
    expect(incomeOpenPeriods(income(), '2026-01-25')).toEqual(['2026-01']);
  });

  it('فات كذا شهر ← كلهم بالترتيب', () => {
    expect(incomeOpenPeriods(income(), '2026-03-26')).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('المقفولة (اتسجلت أو اتشالت) مش بترجع', () => {
    const i = income({ closed: { '2026-01': { txId: 't', at: 'x' }, '2026-02': { skipped: true, at: 'x' } } });
    expect(incomeOpenPeriods(i, '2026-03-26')).toEqual(['2026-03']);
  });

  it('اتعمل بعد معاد الشهر ده ← الشهر ده مش بيتحسب', () => {
    const i = income({ startDate: '2026-01-26' });
    expect(incomeOpenPeriods(i, '2026-02-25')).toEqual(['2026-02']);
  });

  it('اتعمل يوم المعاد ← الشهر ده بيتحسب', () => {
    expect(incomeOpenPeriods(income({ startDate: '2026-01-25' }), '2026-01-25')).toEqual(['2026-01']);
  });

  it('متوقف مؤقتًا أو خالص ← مفيش فترات', () => {
    expect(incomeOpenPeriods(income({ status: 'paused' }), '2026-05-01')).toEqual([]);
    expect(incomeOpenPeriods(income({ status: 'stopped' }), '2026-05-01')).toEqual([]);
  });

  it(`غاب سنين ← بيقف عند ${INCOME_CATCHUP_MAX} فترة (الأحدث)`, () => {
    const open = incomeOpenPeriods(income({ startDate: '2020-01-01' }), '2026-03-26');
    expect(open).toHaveLength(INCOME_CATCHUP_MAX);
    expect(open[open.length - 1]).toBe('2026-03');
  });
});

describe('أسبوعي', () => {
  // 2026-09-17 خميس
  const weekly = income({ frequency: 'weekly', dayOfMonth: undefined, weekday: 4, startDate: '2026-09-01' });

  it('المعاد = اليوم ده من الأسبوع', () => {
    expect(WEEKDAY_NAMES[4]).toBe('الخميس');
    expect(incomeOpenPeriods(weekly, '2026-09-17')).toEqual(['2026-09-03', '2026-09-10', '2026-09-17']);
  });

  it('المفتاح = تاريخ المعاد، والتاريخ = المفتاح', () => {
    expect(incomeDueDate(weekly, '2026-09-10')).toBe('2026-09-10');
  });

  it('بيعدّي الشهر والسنة عادي', () => {
    const w = income({ frequency: 'weekly', weekday: 4, startDate: '2026-12-28' });
    expect(incomeOpenPeriods(w, '2027-01-08')).toEqual(['2026-12-31', '2027-01-07']);
  });
});

describe('الفترة الجاية (عشان "نزل" قبل المعاد)', () => {
  it('أول فترة معادها لسه ما جاش', () => {
    expect(incomeUpcomingPeriod(income(), '2026-01-20')).toBe('2026-01');
    expect(incomeUpcomingPeriod(income(), '2026-01-25')).toBe('2026-02');
  });

  it('لو الجاية اتقفلت بدري ← اللي بعدها', () => {
    const i = income({ closed: { '2026-02': { txId: 't', at: 'x' } } });
    expect(incomeUpcomingPeriod(i, '2026-01-26')).toBe('2026-03');
  });

  it('متوقف ← مفيش', () => {
    expect(incomeUpcomingPeriod(income({ status: 'paused' }), '2026-01-20')).toBeNull();
  });
});

describe('ممنوع يتسجل مرتين — المعرّف ثابت', () => {
  it('نفس الدخل ونفس الفترة ← نفس المعرّف دايمًا', () => {
    expect(incomeTxId('inc1', '2026-09')).toBe(incomeTxId('inc1', '2026-09'));
    expect(incomeTxId('inc1', '2026-09')).toBe('income_inc1_2026-09');
  });

  it('فترة تانية أو دخل تاني ← معرّف تاني', () => {
    expect(incomeTxId('inc1', '2026-09')).not.toBe(incomeTxId('inc1', '2026-10'));
    expect(incomeTxId('inc1', '2026-09')).not.toBe(incomeTxId('inc2', '2026-09'));
  });

  it('المعرّف ينفع مستند فايرستور (من غير /)', () => {
    expect(incomeTxId('a-b_c', '2026-09-03')).not.toContain('/');
  });
});

describe('تاريخ العملية', () => {
  it('متأخر ← تاريخ المعاد (الفلوس نزلت ساعتها)', () => {
    expect(incomeTxDate(income(), '2026-01', '2026-02-03')).toBe('2026-01-25');
  });
  it('"نزل" قبل المعاد ← النهاردة', () => {
    expect(incomeTxDate(income(), '2026-02', '2026-02-20')).toBe('2026-02-20');
  });
});

describe('الكلام', () => {
  it('اسم الفترة: الشهر، والسنة لو مش السنة دي', () => {
    expect(incomePeriodLabel(income(), '2026-09', '2026-10-01')).toBe('سبتمبر');
    expect(incomePeriodLabel(income(), '2025-12', '2026-01-05')).toBe('ديسمبر 2025');
    const w = income({ frequency: 'weekly', weekday: 4 });
    expect(incomePeriodLabel(w, '2026-09-17', '2026-09-20')).toBe('أسبوع 17 سبتمبر');
  });

  it('رسالة واحدة للكذا فترة', () => {
    expect(incomeRecordedMessage('المرتب', ['سبتمبر'])).toBe('سجلنا "المرتب" عن سبتمبر');
    expect(incomeRecordedMessage('المرتب', ['سبتمبر', 'أكتوبر'])).toBe('سجلنا "المرتب" عن سبتمبر وأكتوبر');
    expect(incomeRecordedMessage('المرتب', ['سبتمبر', 'أكتوبر', 'نوفمبر'])).toBe('سجلنا "المرتب" عن سبتمبر وأكتوبر ونوفمبر');
    expect(incomeRecordedMessage('المرتب', ['يناير', 'فبراير', 'مارس', 'أبريل'])).toBe('سجلنا "المرتب" عن 4 فترات، من يناير لـ أبريل');
  });

  it('المواعيد بالكلام', () => {
    expect(incomeScheduleLabel(income())).toBe('كل شهر يوم 25');
    expect(incomeScheduleLabel(income({ dayOfMonth: 31 }))).toBe('كل شهر يوم 31 (أو آخر الشهر)');
    expect(incomeScheduleLabel(income({ frequency: 'weekly', weekday: 0 }))).toBe('كل أسبوع يوم الأحد');
  });

  it('الفرق عن المعتاد — هادي، ومن غير سطر لو نفس الرقم', () => {
    const m = (n: number) => String(n);
    expect(incomeDiffNote(7200, 8000, m)).toBe('أقل من المعتاد بـ 800 ج.م');
    expect(incomeDiffNote(8500, 8000, m)).toBe('أكتر من المعتاد بـ 500 ج.م');
    expect(incomeDiffNote(8000, 8000, m)).toBeNull();
    expect(incomeDiffNote(8000.004, 8000, m)).toBeNull();
  });
});

describe('validateIncomeDraft', () => {
  const ok = { name: 'المرتب', amount: 8000, walletId: 'w1', frequency: 'monthly' as const, dayOfMonth: 25 };
  it('سليم ← null', () => expect(validateIncomeDraft(ok)).toBeNull());
  it.each([
    [{ ...ok, name: '  ' }, 'اكتب اسم للدخل ده (زي "المرتب").'],
    [{ ...ok, amount: 0 }, 'المبلغ لازم يكون أكبر من صفر.'],
    [{ ...ok, amount: NaN }, 'المبلغ لازم يكون أكبر من صفر.'],
    [{ ...ok, walletId: '' }, 'اختار المحفظة اللي الفلوس بتنزل فيها.'],
    [{ ...ok, dayOfMonth: 0 }, 'اليوم لازم يكون من 1 لـ 31.'],
    [{ ...ok, dayOfMonth: 32 }, 'اليوم لازم يكون من 1 لـ 31.'],
    [{ ...ok, frequency: 'weekly' as const, dayOfMonth: undefined, weekday: 7 }, 'اختار يوم من الأسبوع.'],
  ])('%#', (draft, msg) => expect(validateIncomeDraft(draft)).toBe(msg));
});

describe('إشعار "اتسجل لوحده"', () => {
  it('بالرقم لما المبالغ ظاهرة', () => {
    expect(incomeRecordedNotification('سجلنا "المرتب" عن سبتمبر', 8000, false))
      .toBe('سجلنا "المرتب" عن سبتمبر — 8,000 ج.م. لو الرقم مختلف عدّله من الأرشيف.');
  });
  it('من غير رقم خالص لما مخفية (شاشة القفل)', () => {
    const body = incomeRecordedNotification('سجلنا "المرتب" عن سبتمبر', 8000, true);
    expect(body).not.toMatch(/[0-9٠-٩]|ج\.م|•/);
  });
});

/**
 * تغيير الجدول بعد فترات اتقفلت (money-reviewer): الأسابيع اللي اتسجلت يوم
 * الجمعة كانت هتبان مفتوحة تاني بمفاتيح الاتنين وتتسجل مرتين.
 */
describe('تغيير الجدول مايسجلش نفس الوقت مرتين', () => {
  const closedFridays = {
    '2026-09-04': { txId: 'a', at: 'x' }, '2026-09-11': { txId: 'b', at: 'x' }, '2026-09-18': { txId: 'c', at: 'x' },
  };
  const weeklyFri = income({ frequency: 'weekly', weekday: 5, startDate: '2026-09-01', closed: closedFridays });

  it('يوم الأسبوع أو التكرار اتغيّر ← مفاتيح جديدة', () => {
    expect(incomeScheduleKeysChange(weeklyFri, { weekday: 1 })).toBe(true);
    expect(incomeScheduleKeysChange(weeklyFri, { frequency: 'monthly' })).toBe(true);
    expect(incomeScheduleKeysChange(weeklyFri, { weekday: 5 })).toBe(false);
    expect(incomeScheduleKeysChange(income(), { frequency: 'monthly' })).toBe(false);
  });

  it('يوم الشهر بس اتغيّر ← نفس المفاتيح (الشهر مبيتغيّرش)', () => {
    expect(incomeScheduleKeysChange(income(), {})).toBe(false);
  });

  it('أسبوعي: الجديد بيبدأ بعد أسبوع من آخر معاد اتقفل', () => {
    expect(incomeRescheduleStart(weeklyFri, '2026-09-20')).toBe('2026-09-25');
  });

  it('وبعد التغيير مفيش أسابيع قديمة مفتوحة', () => {
    const start = incomeRescheduleStart(weeklyFri, '2026-09-20');
    const moved = { ...weeklyFri, weekday: 1, startDate: start };
    expect(incomeOpenPeriods(moved, '2026-09-27')).toEqual([]);
    expect(incomeUpcomingPeriod(moved, '2026-09-27')).toBe('2026-09-28');
  });

  it('شهري ← أسبوعي: الجديد بيبدأ أول الشهر اللي بعد آخر شهر اتقفل', () => {
    const monthly = income({ closed: { '2026-08': { txId: 'a', at: 'x' }, '2026-09': { txId: 'b', at: 'x' } } });
    expect(incomeRescheduleStart(monthly, '2026-09-26')).toBe('2026-10-01');
  });

  it('مفيش حاجة اتقفلت ← من النهاردة', () => {
    expect(incomeRescheduleStart(income(), '2026-09-26')).toBe('2026-09-26');
  });

  it('آخر فترة اتقفلت من زمان ← من النهاردة مش من الماضي', () => {
    const old = income({ closed: { '2025-01': { txId: 'a', at: 'x' } } });
    expect(incomeRescheduleStart(old, '2026-09-26')).toBe('2026-09-26');
  });
});

describe('العدد بالعربي (arabic-copy-reviewer)', () => {
  it('فترات تانية: واحدة، مثنى، جمع، وفوق العشرة مفرد', () => {
    expect(morePeriodsPhrase(1)).toBe('وفيه فترة تانية');
    expect(morePeriodsPhrase(2)).toBe('وفيه فترتين تانيين');
    expect(morePeriodsPhrase(3)).toBe('وفيه 3 فترات تانية');
    expect(morePeriodsPhrase(11)).toBe('وفيه 11 فترة تانية');
  });
  it('رسالة اللحاق فوق العشرة', () => {
    const labels = Array.from({ length: 12 }, (_, i) => `ش${i + 1}`);
    expect(incomeRecordedMessage('المرتب', labels)).toBe('سجلنا "المرتب" عن 12 فترة، من ش1 لـ ش12');
  });
});

/**
 * بند 1ب (2026-09-25): المسح للي عمره ما سجّل بس. اللي سجّل ولو مرة بيتوقف —
 * تاريخه لازم يفضل.
 */
describe('incomeHasRecords — ينفع يتمسح ولا لأ', () => {
  const at = '2026-09-01T00:00:00.000Z';
  it('جديد ولا حاجة اتقفلت ← ما سجّلش', () => {
    expect(incomeHasRecords({ id: 'i1', closed: {} }, [])).toBe(false);
    expect(incomeHasRecords({ id: 'i1' }, [])).toBe(false);
  });
  it('"ما نزلش" بس ← ما سجّلش (مفيش فلوس اتحركت)', () => {
    expect(incomeHasRecords({ id: 'i1', closed: { '2026-09': { skipped: true, at } } }, [])).toBe(false);
  });
  it('فترة اتسجلت ← سجّل، حتى لو المستخدم مسح العملية بعدين', () => {
    expect(incomeHasRecords({ id: 'i1', closed: { '2026-09': { txId: 'income_i1_2026-09', at } } }, [])).toBe(true);
  });
  it('العلامة اتحولت "ما نزلش" بس العملية موجودة (سباق skipIncomePeriod) ← سجّل', () => {
    expect(incomeHasRecords({ id: 'i1', closed: { '2026-09': { skipped: true, at } } }, [{ incomeId: 'i1' }])).toBe(true);
  });
  it('عملية دخل تاني ← مالهاش دعوة', () => {
    expect(incomeHasRecords({ id: 'i1', closed: {} }, [{ incomeId: 'i2' }, {}])).toBe(false);
  });
});
