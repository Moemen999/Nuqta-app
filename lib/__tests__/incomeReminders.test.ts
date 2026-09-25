import { addDays, todayStr } from '@/lib/finance';
import type { RecurringIncome } from '@/lib/recurringIncome';
import { scheduleAllReminders } from '@/lib/scheduleAllReminders';

/**
 * الدخل اللي بيستنى تأكيد: إشعار يوم المعاد `"المرتب" نزل؟`. التلقائي مالوش
 * تذكير — ده بيبعت "اتسجل" بعد ما يتسجل فعلاً.
 */

const scheduled: { title: string; body: string; date: string }[] = [];
jest.mock('@/lib/notifications', () => ({
  cancelAllReminders: jest.fn(async () => {}),
  scheduleReminder: jest.fn(async (o: any) => { scheduled.push(o); }),
  scheduleDailyReminder: jest.fn(async () => {}),
}));

beforeEach(() => { scheduled.length = 0; });

const today = todayStr();

function income(over: Partial<RecurringIncome> = {}): RecurringIncome {
  return {
    id: 'i', name: 'المرتب', amount: 8000, walletId: 'w', frequency: 'weekly',
    weekday: new Date(`${addDays(today, 3)}T00:00:00Z`).getUTCDay(),
    mode: 'confirm', status: 'active', startDate: today, closed: {}, createdAt: '',
    ...over,
  };
}

const run = (incomes: RecurringIncome[], hideAmounts = false) => scheduleAllReminders({
  subscriptions: [], gamiyas: [], debts: [], incomes,
  dailyReminderEnabled: false, dailyHour: 20, dailyMinute: 0, hideAmounts,
});

it('بيستنى تأكيد ← إشعار يوم المعاد', async () => {
  await run([income()]);
  expect(scheduled).toEqual([
    { title: '"المرتب" نزل؟', body: 'معاده النهاردة — 8,000 ج.م. افتح نقطة وأكّد إنه نزل.', date: addDays(today, 3) },
  ]);
});

it('المبالغ مخفية ← من غير رقم', async () => {
  await run([income()], true);
  expect(scheduled[0].body).toBe('معاده النهاردة. افتح نقطة وأكّد إنه نزل.');
});

it('التلقائي والمتوقف ← مفيش تذكير', async () => {
  await run([income({ mode: 'auto' }), income({ id: 'p', status: 'paused' }), income({ id: 's', status: 'stopped' })]);
  expect(scheduled).toEqual([]);
});

it('الفترة الجاية اتقفلت بدري ← التذكير على اللي بعدها', async () => {
  await run([income({ closed: { [addDays(today, 3)]: { txId: 't', at: 'x' } } })]);
  expect(scheduled.map(s => s.date)).toEqual([addDays(today, 10)]);
});

