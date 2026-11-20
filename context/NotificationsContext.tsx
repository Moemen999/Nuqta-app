import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useData } from '@/context/DataContext';
import { usePrivacy } from '@/context/PrivacyContext';
import { hasNotificationPermission, requestNotificationPermission, setupNotifications } from '@/lib/notifications';
import { scheduleAllReminders } from '@/lib/scheduleAllReminders';
import { openExactAlarmSettings as openExactAlarmSettingsRaw } from '@/lib/exactAlarm';
import { reportAtomicFailure } from '@/lib/atomicFailure';

const K_ENABLED = 'nuqta_notifs_enabled';
const K_DAILY = 'nuqta_notifs_daily';
const K_DAILY_HOUR = 'nuqta_notifs_daily_hour';
/** الدقيقة (0–59). المستخدمين القدام مالهمش المفتاح ← :00، يعني بيحتفظوا بساعتهم زي ما هي */
const K_DAILY_MINUTE = 'nuqta_notifs_daily_minute';

/** سقف جدولة واحدة — بعده بتتعتبر فشلت والجاية تبدأ */
export const SCHEDULE_TIMEOUT_MS = 20_000;
class ScheduleTimeoutError extends Error { name = 'ScheduleTimeoutError'; }
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new ScheduleTimeoutError()), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

/** ساعة التذكير اليومي لو مفيش اختيار — نفس الافتراضي من الأول (20) */
export const DEFAULT_DAILY_HOUR = 20;
/** ساعة صالحة 0–23؛ غير كده ← الافتراضي. `Number(x) || 20` كان بيقلب 0 (12 بالليل) لـ20 */
export function parseDailyHour(raw: string | number | null | undefined): number {
  const h = typeof raw === 'number' ? raw : raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : DEFAULT_DAILY_HOUR;
}

/** دقيقة صالحة 0–59؛ غير كده (أو مفيش) ← 0 */
export function parseDailyMinute(raw: string | number | null | undefined): number {
  const m = typeof raw === 'number' ? raw : raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isInteger(m) && m >= 0 && m <= 59 ? m : 0;
}

type NotificationsContextType = {
  enabled: boolean;
  dailyEnabled: boolean;
  dailyHour: number;
  dailyMinute: number;
  loading: boolean;
  enableNotifications: () => Promise<boolean>;
  disableNotifications: () => Promise<void>;
  setDailyEnabled: (v: boolean) => Promise<void>;
  setDailyHour: (h: number) => Promise<void>;
  /** ساعة ودقيقة مع بعض (من منتقي الوقت) — حفظة واحدة */
  setDailyTime: (h: number, m: number) => Promise<void>;
  /** بيعيد قراية الإذن الحقيقي من النظام — بيتنادى لوحده كل رجوع للتطبيق */
  refreshPermission: () => Promise<void>;
  /**
   * بيفتح إعداد "المنبهات والتذكيرات" ويعلّم إن الجدولة تتعاد أول ما التطبيق يرجع للمقدمة:
   * الإذن بيأثر على المنبّهات اللي بتتجدول بعده بس، فاللي اتجدول قبله فاضل تقريبي.
   * بيرجّع false لو الإعداد ما اتفتحش.
   */
  openExactAlarmSettings: () => Promise<boolean>;
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
  const [dailyMinute, setDailyMinuteState] = useState(0);
  const [loading, setLoading] = useState(true);
  // إعادة جدولة بعد الرجوع من إعداد المنبّهات (tdd-guide: setEnabled(true) وهي true مبيعيدش الـeffect)
  const [rescheduleTick, setRescheduleTick] = useState(0);
  const rescheduleOnReturn = useRef(false);
  const scheduleChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    (async () => {
      try {
        await setupNotifications();
        const [en, daily, hour, minute] = await Promise.all([
          AsyncStorage.getItem(K_ENABLED),
          AsyncStorage.getItem(K_DAILY),
          AsyncStorage.getItem(K_DAILY_HOUR),
          AsyncStorage.getItem(K_DAILY_MINUTE),
        ]);
        const granted = await hasNotificationPermission();
        setEnabled(en === '1' && granted);
        if (daily !== null) setDailyEnabledState(daily === '1');
        if (hour !== null) setDailyHourState(parseDailyHour(hour));
        if (minute !== null) setDailyMinuteState(parseDailyMinute(minute));
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
      if (state !== 'active') return;
      const reschedule = rescheduleOnReturn.current;
      rescheduleOnReturn.current = false;
      // الجدولة بعد ما الإذن يتقري تاني (react-reviewer): لو الإشعارات اتقفلت من الموبايل
      // في النص، الـeffect يشوف enabled الجديد مش القديم
      void refreshPermission().then(() => { if (reschedule) setRescheduleTick(t => t + 1); });
    });
    return () => sub.remove();
  }, [refreshPermission]);

  // بنعيد جدولة التذكيرات كل ما البيانات أو الإعدادات تتغير
  useEffect(() => {
    // مستنيين تفضيل الإخفاء كمان: من غيره أول جدولة كانت ممكن تحط المبالغ
    // في إشعارات مستخدم مختار يخبّيها
    if (loading || !enabled || !privacyLoaded) return;
    // ورا بعض مش مع بعض (react-reviewer): كل جدولة "امسح الكل وبعدين جدول"، فاتنين متداخلين
    // كانوا ممكن يسيبوا تذكيرات مكررة أو ناقصة
    const opts = {
      subscriptions,
      gamiyas,
      debts,
      dailyReminderEnabled: dailyEnabled,
      dailyHour,
      dailyMinute,
      hideAmounts: amountsHidden,
      incomes,
    };
    // كانت `.catch(() => {})` (silent-failure-hunter): الجدولة بعد إذن المنبهات هي اللي بتحوّل
    // التذكير من تقريبي لبالظبط، وفشلها كان بيعدّي ساكت. Sentry بالكود بس، من غير أسامي ولا مبالغ
    // بسقف (silent-failure-hunter، الجولة التانية): نداء native علّق كان هيوقف كل جدولة بعده
    // ساكت. بعد السقف بيتبلّغ والسلسلة بتكمّل
    scheduleChain.current = scheduleChain.current
      .then(() => withTimeout(scheduleAllReminders(opts), SCHEDULE_TIMEOUT_MS))
      .catch(e => reportAtomicFailure('جدولة التذكيرات', e));
  }, [loading, enabled, privacyLoaded, amountsHidden, subscriptions, gamiyas, debts, incomes, dailyEnabled, dailyHour, dailyMinute, rescheduleTick]);

  async function openExactAlarmSettings() {
    // العلامة **قبل** الفتح (react-reviewer): لو الـpromise خلص متأخر والتطبيق كان راح ورجع،
    // العلامة كانت بتتحط بعد الرجوع والجدولة بتتفوّت
    rescheduleOnReturn.current = true;
    const opened = await openExactAlarmSettingsRaw();
    if (!opened) rescheduleOnReturn.current = false;
    return opened;
  }

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

  async function setDailyTime(h: number, m: number) {
    const hour = parseDailyHour(h);
    const minute = parseDailyMinute(m);
    setDailyHourState(hour);
    setDailyMinuteState(minute);
    await Promise.all([
      AsyncStorage.setItem(K_DAILY_HOUR, String(hour)),
      AsyncStorage.setItem(K_DAILY_MINUTE, String(minute)),
    ]).catch(() => {});
  }

  return (
    <NotificationsContext.Provider
      value={{ enabled, dailyEnabled, dailyHour, dailyMinute, loading, setDailyTime, enableNotifications, disableNotifications, setDailyEnabled, setDailyHour, refreshPermission, openExactAlarmSettings }}>
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
 * معاد التذكير اليومي لبانر "لسه ما سجلتش" في الرئيسية، كدقيقة من اليوم (ساعة×60 + دقيقة)
 * — `null` لحد ما الإعداد يتقري (react-reviewer): الافتراضي (8 م) قبل القراية كان بيطلّع
 * البانر للي اختار 10 م، أو يخبّيه عن اللي اختار 2 الضهر. من غير Provider (اختبارات
 * الشاشة) ← الافتراضي.
 */
export function useDailyReminderMinute(): number | null {
  const ctx = useContext(NotificationsContext);
  if (!ctx) return DEFAULT_DAILY_HOUR * 60;
  return ctx.loading ? null : ctx.dailyHour * 60 + (ctx.dailyMinute ?? 0);
}
