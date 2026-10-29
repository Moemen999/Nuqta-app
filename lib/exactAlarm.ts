import { Linking } from 'react-native';
import { reportAtomicFailure } from '@/lib/atomicFailure';

/**
 * إذن "المنبهات والتذكيرات" (SCHEDULE_EXACT_ALARM) — 2026-10-28.
 *
 * expo-notifications 0.32.17 بيجدول التذكير **بالظبط** بس لو أندرويد أقل من 12 أو
 * `AlarmManager.canScheduleExactAlarms()` بـtrue (`ExpoSchedulingDelegate.kt:105-118`)،
 * غير كده `setAndAllowWhileIdle` — تقريبي، ممكن يتأخر لحد ساعة أو أكتر مع Doze.
 * والإذن ده أندرويد 14 مبيدّيهوش افتراضيًا للتثبيت الجديد، فالمستخدم لازم يفعّله بنفسه.
 *
 * **مفيش طريقة نقرا بيها الحالة** بالاعتماديات اللي عندنا: expo-notifications 0.32.17
 * مبيعرضش `canScheduleExactAlarms`، ومفيش module native تاني بيعرضها. فالحالة
 * `unknown` لحد ما قراية حقيقية تتوصّل في `canSchedule`.
 * `USE_EXACT_ALARM` مش هنا عن قصد: سياسة Play قاصراه على المنبّه والتقويم.
 */

export const EXACT_ALARM_ACTION = 'android.settings.REQUEST_SCHEDULE_EXACT_ALARM';
/** أندرويد 12 (S) — قبله التذكير بالظبط من غير إذن */
export const EXACT_ALARM_MIN_API = 31;

export type ExactAlarmStatus = 'not-needed' | 'granted' | 'denied' | 'unknown';

export function exactAlarmStatus(opts: { os: string; apiLevel: unknown; canSchedule?: boolean }): ExactAlarmStatus {
  if (opts.os !== 'android') return 'not-needed';
  const api = typeof opts.apiLevel === 'number' ? opts.apiLevel : Number(opts.apiLevel);
  if (!Number.isFinite(api) || api < EXACT_ALARM_MIN_API) return 'not-needed';
  if (opts.canSchedule === true) return 'granted';
  if (opts.canSchedule === false) return 'denied';
  return 'unknown';
}

/**
 * بيفتح إعداد "المنبهات والتذكيرات". `Linking.sendIntent` مبيقدرش يبعت `package:`
 * (extras بس — `IntentModule.kt:191`)، فغالبًا هيفتح قايمة كل التطبيقات مش صفحة نقطة
 * (ما اتجربش على جهاز). لو رفض ← تفاصيل التطبيق (`openSettings`). بيرجّع false لو
 * الاتنين فشلوا — مبيرميش.
 */
export async function openExactAlarmSettings(): Promise<boolean> {
  try {
    await Linking.sendIntent(EXACT_ALARM_ACTION);
    return true;
  } catch (e) {
    // الاحتياطي كان بيخبّي إن الأكشن نفسه مش شغال على جهاز معيّن (silent-failure-hunter) — Sentry بالكود بس
    reportAtomicFailure('فتح إعداد المنبهات', e);
    try {
      await Linking.openSettings();
      return true;
    } catch {
      return false;
    }
  }
}
