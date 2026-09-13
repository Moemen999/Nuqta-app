import type { Debt, Gamiya, Subscription } from '@/context/DataContext';
import { addDays, todayStr } from '@/lib/finance';
// jest.mock بيتنقل لفوق تلقائيًا، فالاستيراد ده بياخد النسخة المقلّدة
import { REMINDER_LIMITS, scheduleAllReminders } from '@/lib/scheduleAllReminders';

const scheduled: { title: string; body: string; date: string }[] = [];
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
    expect(scheduled[0].title).toBe('عليا لـ سامي');
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
    expect(scheduled[0].body).toContain('الاستلام');
  });
});
