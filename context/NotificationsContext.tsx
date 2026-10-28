import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useData } from '@/context/DataContext';
import { usePrivacy } from '@/context/PrivacyContext';
import { hasNotificationPermission, requestNotificationPermission, setupNotifications } from '@/lib/notifications';
import { scheduleAllReminders } from '@/lib/scheduleAllReminders';

const K_ENABLED = 'nuqta_notifs_enabled';
const K_DAILY = 'nuqta_notifs_daily';
const K_DAILY_HOUR = 'nuqta_notifs_daily_hour';

/** ساعة التذكير اليومي لو مفيش اختيار — نفس الافتراضي من الأول (20) */
export const DEFAULT_DAILY_HOUR = 20;
/** ساعة صالحة 0–23؛ غير كده ← الافتراضي. `Number(x) || 20` كان بيقلب 0 (12 بالليل) لـ20 */
export function parseDailyHour(raw: string | number | null | undefined): number {
  const h = typeof raw === 'number' ? raw : raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : DEFAULT_DAILY_HOUR;
}

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

/** مُصدَّر للاختبارات بس (قيمة جاهزة من غير Provider حقيقي) */
export const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { subscriptions, gamiyas, debts, incomes } = useData();
  // التفضيل نفسه مش النطاق: الإشعار بيظهر على شاشة القفل برّه أي شاشة
  const { hidePreference: amountsHidden, loaded: privacyLoaded } = usePrivacy();
  const [enabled, setEnabled] = useState(false);
  const [dailyEnabled, setDailyEnabledState] = useState(true);
  const [dailyHour, setDailyHourState] = useState(DEFAULT_DAILY_HOUR);
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
        if (hour !== null) setDailyHourState(parseDailyHour(hour));
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
    // مستنيين تفضيل الإخفاء كمان: من غيره أول جدولة كانت ممكن تحط المبالغ
    // في إشعارات مستخدم مختار يخبّيها
    if (loading || !enabled || !privacyLoaded) return;
    scheduleAllReminders({
      subscriptions,
      gamiyas,
      debts,
      dailyReminderEnabled: dailyEnabled,
      dailyHour,
      dailyMinute: 0,
      hideAmounts: amountsHidden,
      incomes,
    }).catch(() => {});
  }, [loading, enabled, privacyLoaded, amountsHidden, subscriptions, gamiyas, debts, incomes, dailyEnabled, dailyHour]);

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
    const hour = parseDailyHour(h);
    setDailyHourState(hour);
    // الحفظ وقع: الساعة متطبقة لحد ما التطبيق يتقفل، وبترجع للمتخزّن بعدها — مش رمي
    // من غير حد يمسكه من زرار المقبض (react-reviewer)
    await AsyncStorage.setItem(K_DAILY_HOUR, String(hour)).catch(() => {});
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

/**
 * ساعة التذكير اليومي لبانر "لسه ما سجلتش" في الرئيسية — `null` لحد ما الإعداد يتقري
 * (react-reviewer): الافتراضي (8 م) قبل القراية كان بيطلّع البانر للي اختار 10 م، أو
 * يخبّيه عن اللي اختار 2 الضهر. من غير Provider (اختبارات الشاشة) ← الافتراضي.
 */
export function useDailyReminderHour(): number | null {
  const ctx = useContext(NotificationsContext);
  if (!ctx) return DEFAULT_DAILY_HOUR;
  return ctx.loading ? null : ctx.dailyHour;
}
