import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useData } from '@/context/DataContext';
import { hasNotificationPermission, requestNotificationPermission, setupNotifications } from '@/lib/notifications';
import { scheduleAllReminders } from '@/lib/scheduleAllReminders';

const K_ENABLED = 'nuqta_notifs_enabled';
const K_DAILY = 'nuqta_notifs_daily';
const K_DAILY_HOUR = 'nuqta_notifs_daily_hour';

type NotificationsContextType = {
  enabled: boolean;
  dailyEnabled: boolean;
  dailyHour: number;
  loading: boolean;
  enableNotifications: () => Promise<boolean>;
  disableNotifications: () => Promise<void>;
  setDailyEnabled: (v: boolean) => Promise<void>;
  setDailyHour: (h: number) => Promise<void>;
  /** بيعيد قراية الإذن الحقيقي من النظام — بيتنادى لوحده كل رجوع للتطبيق */
  refreshPermission: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { subscriptions, gamiyas, debts } = useData();
  const [enabled, setEnabled] = useState(false);
  const [dailyEnabled, setDailyEnabledState] = useState(true);
  const [dailyHour, setDailyHourState] = useState(20);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await setupNotifications();
        const [en, daily, hour] = await Promise.all([
          AsyncStorage.getItem(K_ENABLED),
          AsyncStorage.getItem(K_DAILY),
          AsyncStorage.getItem(K_DAILY_HOUR),
        ]);
        const granted = await hasNotificationPermission();
        setEnabled(en === '1' && granted);
        if (daily !== null) setDailyEnabledState(daily === '1');
        if (hour !== null) setDailyHourState(Number(hour) || 20);
      } catch {
        // لو أي حاجة فشلت، التطبيق يكمل عادي من غير إشعارات
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /**
   * بيعيد قراية الإذن الحقيقي من النظام.
   *
   * المستخدم بيقدر يقفل الإشعارات من إعدادات الموبايل ويرجع للتطبيق،
   * والتطبيق مش بيتبلّغ. من غير ده المفتاح بيفضل شغّال وسطر الحالة بيقول
   * "تذكير يومي 8 م" وإحنا عارفين إن مفيش إشعار هيوصل — كدبة على شاشة
   * المستخدم نفسها.
   *
   * والعكس صحيح: لو سمح من الإعدادات وكان مفعّلها عندنا قبل كده، بترجع
   * تشتغل من غير ما يدوس تاني.
   */
  const refreshPermission = useCallback(async () => {
    try {
      const granted = await hasNotificationPermission();
      const stored = await AsyncStorage.getItem(K_ENABLED);
      setEnabled(stored === '1' && granted);
    } catch {
      // مفيش تغيير — أحسن من إننا نطفيها غلط
    }
  }, []);

  // كل رجوع للتطبيق بيعيد الفحص: ده الوقت الوحيد اللي المستخدم ممكن يكون
  // غيّر الإذن من برّه فيه
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  // بنعيد جدولة التذكيرات كل ما البيانات أو الإعدادات تتغير
  useEffect(() => {
    if (loading || !enabled) return;
    scheduleAllReminders({
      subscriptions,
      gamiyas,
      debts,
      dailyReminderEnabled: dailyEnabled,
      dailyHour,
      dailyMinute: 0,
    }).catch(() => {});
  }, [loading, enabled, subscriptions, gamiyas, debts, dailyEnabled, dailyHour]);

  async function enableNotifications() {
    const granted = await requestNotificationPermission();
    if (!granted) return false;
    await AsyncStorage.setItem(K_ENABLED, '1');
    setEnabled(true);
    return true;
  }

  async function disableNotifications() {
    await AsyncStorage.setItem(K_ENABLED, '0');
    setEnabled(false);
    const { cancelAllReminders } = await import('@/lib/notifications');
    await cancelAllReminders();
  }

  async function setDailyEnabled(v: boolean) {
    await AsyncStorage.setItem(K_DAILY, v ? '1' : '0');
    setDailyEnabledState(v);
  }

  async function setDailyHour(h: number) {
    await AsyncStorage.setItem(K_DAILY_HOUR, String(h));
    setDailyHourState(h);
  }

  return (
    <NotificationsContext.Provider
      value={{ enabled, dailyEnabled, dailyHour, loading, enableNotifications, disableNotifications, setDailyEnabled, setDailyHour, refreshPermission }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
