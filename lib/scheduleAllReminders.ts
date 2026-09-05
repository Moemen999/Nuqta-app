import type { Gamiya, Subscription } from '@/context/DataContext';
import { cancelAllReminders, scheduleDailyReminder, scheduleReminder } from '@/lib/notifications';
import { fmt } from '@/lib/finance';

function addDaysStr(dateStr: string, n: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * بيعيد جدولة كل التذكيرات من الأول بناءً على البيانات الحالية.
 * بنمسح القديم الأول عشان منكررش نفس التذكير مع كل تحديث.
 */
export async function scheduleAllReminders(opts: {
  subscriptions: Subscription[];
  gamiyas: Gamiya[];
  dailyReminderEnabled: boolean;
  dailyHour: number;
  dailyMinute: number;
}) {
  await cancelAllReminders();

  // تذكيرات الاشتراكات
  for (const s of opts.subscriptions) {
    const remindDate = addDaysStr(s.nextDueDate, -(s.reminderDaysBefore || 0));
    await scheduleReminder({
      title: `اشتراك ${s.name}`,
      body:
        s.reminderDaysBefore > 0
          ? `مستحق بعد ${s.reminderDaysBefore} يوم — ${fmt(s.amount)} ج.م`
          : `مستحق النهاردة — ${fmt(s.amount)} ج.م`,
      date: remindDate,
    });
  }

  // تذكيرات أقساط الجمعية (الشهور اللي لسه متسددتش)
  for (const g of opts.gamiyas) {
    for (const m of g.months) {
      if (m.status === 'done') continue;
      const remindDate = addDaysStr(m.dueDate, -(g.reminderDaysBefore || 0));
      await scheduleReminder({
        title: `جمعية ${g.name}`,
        body: m.isPayoutMonth
          ? `شهر الاستلام قرب — ${fmt(m.amount)} ج.م`
          : `قسط الشهر قرب — ${fmt(m.amount)} ج.م`,
        date: remindDate,
      });
    }
  }

  // التذكير اليومي
  if (opts.dailyReminderEnabled) {
    await scheduleDailyReminder(opts.dailyHour, opts.dailyMinute);
  }
}
