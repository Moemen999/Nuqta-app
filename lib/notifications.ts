import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const CHANNEL_ID = 'nuqta-reminders';

/**
 * إعداد سلوك الإشعارات وقناة أندرويد.
 * لازم يتنفذ مرة واحدة عند تشغيل التطبيق — من غير القناة، إشعارات أندرويد بتفشل بصمت.
 */
export async function setupNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'تذكيرات نقطة',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#C9A961',
    });
  }
}

/** بيطلب إذن الإشعارات من المستخدم. بيرجع true لو اتوافق عليه. */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function hasNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

/** بيمسح كل التذكيرات المجدولة — بنستخدمها قبل ما نعيد الجدولة من الأول */
export async function cancelAllReminders() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * بيجدول تذكير في تاريخ معين الساعة 10 صباحًا.
 * لو التاريخ عدّى خلاص، مبيجدولش حاجة.
 */
export async function scheduleReminder(opts: {
  title: string;
  body: string;
  date: string; // YYYY-MM-DD
  hour?: number;
}) {
  const [y, m, d] = opts.date.split('-').map(Number);
  if (!y || !m || !d) return;

  const when = new Date(y, m - 1, d, opts.hour ?? 10, 0, 0);
  if (when.getTime() <= Date.now()) return; // الموعد فات

  await Notifications.scheduleNotificationAsync({
    content: {
      title: opts.title,
      body: opts.body,
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: when,
    },
  });
}

/** تذكير يومي ثابت بمعاد محدد (للتذكير بتسجيل مصاريف اليوم) */
export async function scheduleDailyReminder(hour: number, minute: number) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'نقطة',
      body: 'سجّلت مصاريف النهاردة؟',
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
}
