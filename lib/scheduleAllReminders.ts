import type { Gamiya, Subscription } from '@/context/DataContext';
import { cancelAllReminders, scheduleDailyReminder, scheduleReminder } from '@/lib/notifications';
import { addDays, fmt } from '@/lib/finance';

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
  const subscriptionReminders = opts.subscriptions.map(s =>
    scheduleReminder({
      title: `اشتراك ${s.name}`,
      body:
        s.reminderDaysBefore > 0
          ? `مستحق بعد ${s.reminderDaysBefore} يوم — ${fmt(s.amount)} ج.م`
          : `مستحق النهاردة — ${fmt(s.amount)} ج.م`,
      date: addDays(s.nextDueDate, -(s.reminderDaysBefore || 0)),
    })
  );

  // تذكيرات أقساط الجمعية (الشهور اللي لسه متسددتش)
  const gamiyaReminders = opts.gamiyas.flatMap(g =>
    g.months
      .filter(m => m.status !== 'done')
      .map(m =>
        scheduleReminder({
          title: `جمعية ${g.name}`,
          body: m.isPayoutMonth
            ? `شهر الاستلام قرب — ${fmt(m.amount)} ج.م`
            : `قسط الشهر قرب — ${fmt(m.amount)} ج.م`,
          date: addDays(m.dueDate, -(g.reminderDaysBefore || 0)),
        })
      )
  );

  await Promise.all([
    ...subscriptionReminders,
    ...gamiyaReminders,
    opts.dailyReminderEnabled ? scheduleDailyReminder(opts.dailyHour, opts.dailyMinute) : Promise.resolve(),
  ]);
}
