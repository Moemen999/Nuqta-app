import type { Debt, Gamiya, Subscription } from '@/context/DataContext';
import { addDays, todayStr } from '@/lib/finance';
// jest.mock بيتنقل لفوق تلقائيًا، فالاستيراد ده بياخد النسخة المقلّدة
import { REMINDER_LIMITS, scheduleAllReminders } from '@/lib/scheduleAllReminders';

const scheduled: { title: string; body: string; date: string; kind?: string }[] = [];
let dailyCount = 0;
let cancelCount = 0;

jest.mock('@/lib/notifications', () => ({
  cancelAllReminders: jest.fn(async () => { cancelCount += 1; }),
  scheduleReminder: jest.fn(async (o: any) => { scheduled.push(o); }),
  scheduleDailyReminder: jest.fn(async () => { dailyCount += 1; }),
}));

beforeEach(() => {
  scheduled.length = 0;
  dailyCount = 0;
  cancelCount = 0;
});

function debt(p: Partial<Debt> & { personName: string }): Debt {
  return {
    id: Math.random().toString(36).slice(2),
    direction: 'owed_to_me',
    totalAmount: 1000,
    date: '2026-01-01',
    isInstallment: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    payments: [],
    increases: [],
    ...p,
  } as Debt;
}

const run = (opts: Partial<Parameters<typeof scheduleAllReminders>[0]> = {}) =>
  scheduleAllReminders({
    subscriptions: [], gamiyas: [], debts: [],
    dailyReminderEnabled: false, dailyHour: 20, dailyMinute: 0,
    ...opts,
  });

const soon = (days: number) => addDays(todayStr(), days);

describe('تذكيرات الديون', () => {
  it('بيجدول تذكير لدين ليه معاد وتذكير مفعّل', async () => {
    await run({ debts: [debt({ personName: 'كريم', dueDate: soon(10), reminderDaysBefore: 3 })] });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].title).toBe('ليا عند كريم');
    expect(scheduled[0].date).toBe(soon(7));
  });

  it('الدين اللي عليا بيقول كده في العنوان', async () => {
    await run({ debts: [debt({ personName: 'سامي', direction: 'i_owe', dueDate: soon(5), reminderDaysBefore: 0 })] });
    expect(scheduled[0].title).toBe('عليا لـسامي');
    expect(scheduled[0].date).toBe(soon(5));
  });

  it('مبيجدولش لدين من غير معاد', async () => {
    await run({ debts: [debt({ personName: 'كريم', reminderDaysBefore: 3 })] });
    expect(scheduled).toHaveLength(0);
  });

  it('مبيجدولش لدين معاه معاد بس التذكير مقفول', async () => {
    await run({ debts: [debt({ personName: 'كريم', dueDate: soon(10) })] });
    expect(scheduled).toHaveLength(0);
  });

  it('مبيجدولش لدين متسدد بنفس تعريف الكارت (باقي 0.004 قديم، isDebtSettled)', async () => {
    await run({ debts: [debt({ personName: 'كريم', totalAmount: 100.004, dueDate: soon(10), reminderDaysBefore: 3,
      payments: [{ id: 'p1', date: '2026-02-01', amount: 100 }] as Debt['payments'] })] });
    expect(scheduled).toHaveLength(0);
  });

  it('مبيجدولش لدين اتسدد بالكامل', async () => {
    await run({
      debts: [debt({
        personName: 'كريم', dueDate: soon(10), reminderDaysBefore: 1,
        totalAmount: 500,
        payments: [{ id: 'p1', date: soon(-1), amount: 500, walletId: 'w1' }],
      })],
    });
    expect(scheduled).toHaveLength(0);
  });

  it('بيجدول لدين متسدد جزئي وبيقول المتبقي', async () => {
    await run({
      debts: [debt({
        personName: 'كريم', dueDate: soon(10), reminderDaysBefore: 1,
        totalAmount: 500,
        payments: [{ id: 'p1', date: soon(-1), amount: 200, walletId: 'w1' }],
      })],
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].body).toContain('300');
  });

  it('reminderDaysBefore = 0 معناها تذكير في يوم المعاد نفسه', async () => {
    await run({ debts: [debt({ personName: 'كريم', dueDate: soon(4), reminderDaysBefore: 0 })] });
    expect(scheduled[0].date).toBe(soon(4));
    expect(scheduled[0].body).toContain('النهاردة');
  });
});

describe('حدود الجدولة', () => {
  it('بيمسح القديم قبل ما يجدول من الأول', async () => {
    await run();
    expect(cancelCount).toBe(1);
  });

  it('بيتخطى التذكيرات اللي معادها فات', async () => {
    await run({ debts: [debt({ personName: 'كريم', dueDate: soon(-5), reminderDaysBefore: 0 })] });
    expect(scheduled).toHaveLength(0);
  });

  it('بيتخطى اللي أبعد من المدى المسموح', async () => {
    const far = REMINDER_LIMITS.HORIZON_DAYS + 30;
    await run({ debts: [debt({ personName: 'بعيد', dueDate: soon(far), reminderDaysBefore: 0 })] });
    expect(scheduled).toHaveLength(0);
  });

  it('مبيعديش سقف الإشعارات مهما كان عدد الديون', async () => {
    // الحد بتاع iOS 64 إشعار مجدول، وبيرمي الزيادة من غير رسالة
    const many = Array.from({ length: 200 }, (_, i) =>
      debt({ personName: `شخص ${i}`, dueDate: soon((i % 100) + 1), reminderDaysBefore: 0 })
    );
    await run({ debts: many });
    expect(scheduled.length).toBe(REMINDER_LIMITS.MAX_DATED_REMINDERS);
    expect(REMINDER_LIMITS.MAX_DATED_REMINDERS).toBeLessThan(64);
  });

  it('لما يزيد عن السقف بيقدّم الأقرب في المعاد', async () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      debt({ personName: `شخص ${i}`, dueDate: soon(i + 1), reminderDaysBefore: 0 })
    );
    await run({ debts: many });
    const dates = scheduled.map(x => x.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe(soon(1));
    // الأبعد اتساب لجدولة جاية، مش اتنسي
    expect(dates).not.toContain(soon(100));
  });

  it('التذكير اليومي بيتجدول لوحده وبرّه السقف', async () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      debt({ personName: `شخص ${i}`, dueDate: soon((i % 100) + 1), reminderDaysBefore: 0 })
    );
    await run({ debts: many, dailyReminderEnabled: true });
    expect(dailyCount).toBe(1);
    expect(scheduled.length + dailyCount).toBeLessThanOrEqual(64);
  });
});

describe('الاشتراكات والجمعية لسه شغالين زي ما هما', () => {
  it('الاشتراك بيتجدول قبل معاده', async () => {
    const sub = {
      id: 's1', name: 'نتفليكس', amount: 200, walletId: 'w1', frequency: 'monthly',
      nextDueDate: soon(10), reminderDaysBefore: 2, active: true, createdAt: '', history: [],
    } as Subscription;
    await run({ subscriptions: [sub] });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].title).toBe('اشتراك نتفليكس');
    expect(scheduled[0].date).toBe(soon(8));
  });

  it('الاشتراك الواقف (active:false) مبيتجدولش', async () => {
    const sub = {
      id: 's1', name: 'نتفليكس', amount: 200, walletId: 'w1', frequency: 'monthly',
      nextDueDate: soon(10), reminderDaysBefore: 2, active: false, createdAt: '', history: [],
    } as Subscription;
    await run({ subscriptions: [sub] });
    expect(scheduled).toHaveLength(0);
  });

  it('شهور الجمعية المسددة مبتتجدولش', async () => {
    const gamiya = {
      id: 'g1', name: 'جمعية الشغل', monthlyAmount: 500, totalMonths: 2, payoutMonthIndex: 1,
      payoutAmount: 1000, walletId: 'w1', startDate: soon(1), reminderDaysBefore: 0,
      createdAt: '',
      months: [
        { id: 'm1', monthIndex: 0, dueDate: soon(5), isPayoutMonth: false, amount: 500, status: 'done' },
        { id: 'm2', monthIndex: 1, dueDate: soon(35), isPayoutMonth: true, amount: 1000, status: 'pending' },
      ],
    } as Gamiya;
    await run({ gamiyas: [gamiya] });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].body).toContain('استلام الجمعية');
  });
});

describe('نص "امتى" ونوع الإشعار (2026-11-17)', () => {
  const sub = (n: number) => ({
    id: 's1', name: 'نتفليكس', amount: 250, walletId: 'w1', frequency: 'monthly',
    nextDueDate: soon(30), reminderDaysBefore: n, active: true, createdAt: '', history: [],
  }) as Subscription;
  const gam = (n: number, payout = false) => ({
    id: 'g1', name: 'جمعية الشغل', monthlyAmount: 1000, totalMonths: 1, payoutMonthIndex: 0,
    payoutAmount: 1000, walletId: 'w1', startDate: soon(1), reminderDaysBefore: n, createdAt: '',
    months: [{ id: 'm1', monthIndex: 1, dueDate: soon(30), isPayoutMonth: payout, amount: 1000, status: 'pending' }],
  }) as unknown as Gamiya;

  it('الاشتراك: بكرة / بعد يومين / بعد 3 أيام / النهاردة', async () => {
    const bodies: string[] = [];
    for (const n of [1, 2, 3, 0]) { scheduled.length = 0; await run({ subscriptions: [sub(n)] }); bodies.push(scheduled[0].body); }
    expect(bodies).toEqual(['مستحق بكرة — 250 ج.م', 'مستحق بعد يومين — 250 ج.م', 'مستحق بعد 3 أيام — 250 ج.م', 'مستحق النهاردة — 250 ج.م']);
    expect(scheduled[0].kind).toBe('subscription');
  });

  it('الدين: المعاد بعد يومين — متبقي', async () => {
    await run({ debts: [debt({ personName: 'كريم', dueDate: soon(10), reminderDaysBefore: 2 })] });
    expect(scheduled[0].body).toBe('المعاد بعد يومين — متبقي 1,000 ج.م');
    expect(scheduled[0].kind).toBe('debt');
  });

  it('الجمعية: القسط والاستلام بيقولوا امتى، والمبالغ المخفية بتتشال', async () => {
    await run({ gamiyas: [gam(3)] });
    expect(scheduled[0].body).toBe('قسط شهر 1 بعد 3 أيام — 1,000 ج.م');
    expect(scheduled[0].kind).toBe('gamiya');
    scheduled.length = 0;
    await run({ gamiyas: [gam(1, true)], hideAmounts: true });
    expect(scheduled[0].body).toBe('استلام الجمعية بكرة');
    scheduled.length = 0;
    await run({ gamiyas: [gam(0)] });
    expect(scheduled[0].body).toBe('قسط شهر 1 النهاردة — 1,000 ج.م');
  });

  it('التذكير اليومي بيتجدول بالدقيقة', async () => {
    const { scheduleDailyReminder } = jest.requireMock('@/lib/notifications');
    await run({ dailyReminderEnabled: true, dailyHour: 21, dailyMinute: 13 });
    expect(scheduleDailyReminder).toHaveBeenCalledWith(21, 13);
  });
});
