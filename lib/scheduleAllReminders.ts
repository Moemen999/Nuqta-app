import type { Debt, Gamiya, Subscription } from '@/context/DataContext';
import { addDays, debtGrandTotal, debtPaid, fmt, todayStr } from '@/lib/finance';
import { cancelAllReminders, scheduleDailyReminder, scheduleReminder } from '@/lib/notifications';

/**
 * أبعد مدى بنجدول له. أي تذكير أبعد من كده بيتأجل لحد ما الجدولة تتعاد —
 * وده بيحصل مع كل فتح للتطبيق ومع كل تعديل على البيانات.
 */
const HORIZON_DAYS = 120;

/**
 * أقصى عدد تذكيرات بتاريخ. iOS بيحتفظ بـ 64 إشعار مجدول للتطبيق كحد أقصى
 * وبيرمي الزيادة **من غير أي رسالة خطأ**. فبنسيب فسحة للتذكير اليومي
 * وللسقف نفسه، وبنجدول الأقرب في المعاد الأول — لأن الأبعد عنده وقت
 * يتجدول في فتحة جاية.
 *
 * الحد ده كان خطر موجود قبل الديون (اشتراكات + شهور جمعية)، والديون بتقرّبنا
 * منه أكتر، فبقى مقيّد صريح بدل ما يكون اعتماد على إن المستخدم مش هيكتّر.
 */
const MAX_DATED_REMINDERS = 60;

type Candidate = { title: string; body: string; date: string };

export async function scheduleAllReminders(opts: {
  subscriptions: Subscription[];
  gamiyas: Gamiya[];
  debts: Debt[];
  dailyReminderEnabled: boolean;
  dailyHour: number;
  dailyMinute: number;
  /**
   * المستخدم مخبّي المبالغ: الإشعار بيظهر على شاشة القفل قدام أي حد، فمفيش
   * رقم فيه خالص — مش قناع «••••»، الجملة من غير مبلغ. العنوان (الاسم) بيفضل
   * زي ما هو: الإخفاء عن الأرقام بس.
   */
  hideAmounts?: boolean;
}) {
  await cancelAllReminders();
  const amount = (n: number) => (opts.hideAmounts ? '' : ` — ${fmt(n)} ج.م`);
  const debtLeft = (n: number) => (opts.hideAmounts ? ' — لسه فيه متبقي' : ` — متبقي ${fmt(n)} ج.م`);

  const candidates: Candidate[] = [];

  // تذكيرات الاشتراكات
  opts.subscriptions.forEach(s => {
    candidates.push({
      title: `اشتراك ${s.name}`,
      body:
        s.reminderDaysBefore > 0
          ? `مستحق بعد ${s.reminderDaysBefore} يوم${amount(s.amount)}`
          : `مستحق النهاردة${amount(s.amount)}`,
      date: addDays(s.nextDueDate, -(s.reminderDaysBefore || 0)),
    });
  });

  // تذكيرات أقساط الجمعية (الشهور اللي لسه متسددتش)
  opts.gamiyas.forEach(g => {
    g.months
      .filter(m => m.status !== 'done')
      .forEach(m => {
        candidates.push({
          title: `جمعية ${g.name}`,
          body: m.isPayoutMonth
            ? `شهر الاستلام قرب${amount(m.amount)}`
            : `قسط الشهر قرب${amount(m.amount)}`,
          date: addDays(m.dueDate, -(g.reminderDaysBefore || 0)),
        });
      });
  });

  /**
   * تذكيرات الديون. التذكير للمستخدم نفسه — مش رسالة بتتبعت للشخص التاني.
   * بنتخطى: اللي مالوش معاد، واللي التذكير مش مفعّل عليه، واللي اتسدد خلاص.
   */
  opts.debts.forEach(d => {
    if (!d.dueDate || d.reminderDaysBefore === undefined || d.reminderDaysBefore === null) return;
    const remaining = debtGrandTotal(d) - debtPaid(d);
    if (remaining <= 0.001) return;
    const mine = d.direction === 'owed_to_me';
    candidates.push({
      title: mine ? `ليا عند ${d.personName}` : `عليا لـ ${d.personName}`,
      body: d.reminderDaysBefore > 0
        ? `المعاد بعد ${d.reminderDaysBefore} يوم${debtLeft(remaining)}`
        : `المعاد النهاردة${debtLeft(remaining)}`,
      date: addDays(d.dueDate, -d.reminderDaysBefore),
    });
  });

  const today = todayStr();
  const horizon = addDays(today, HORIZON_DAYS);
  const due = candidates
    .filter(cd => cd.date >= today && cd.date <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MAX_DATED_REMINDERS);

  await Promise.all([
    ...due.map(cd => scheduleReminder(cd)),
    opts.dailyReminderEnabled ? scheduleDailyReminder(opts.dailyHour, opts.dailyMinute) : Promise.resolve(),
  ]);
}

/** مكشوفة للاختبارات عشان الحدود تبقى متأكدة مش متوقعة */
export const REMINDER_LIMITS = { HORIZON_DAYS, MAX_DATED_REMINDERS };
