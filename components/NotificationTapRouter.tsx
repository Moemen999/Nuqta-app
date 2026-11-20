import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { shouldShowLock, useAppLock } from '@/context/AppLockContext';
import { useAuth } from '@/context/AuthContext';
import { reportAtomicFailure } from '@/lib/atomicFailure';
import { canRouteNotification, notificationTarget } from '@/lib/notificationRoute';

/** آخر رد اتعالج — الكومبوننت بيتركّب تاني بعد كل فتح من القفل، ومينفعش الدوسة القديمة تنفّذ مرتين */
let handledKey: string | null = null;
/** دوسة أقدم من كده والمستخدم مش داخل ← تتهمل بدل ما تنفّذ فجأة بعد تسجيل دخول متأخر */
export const STALE_TAP_MS = 5 * 60 * 1000;
/** للاختبارات */
export function resetHandledNotification() { handledKey = null; }

/**
 * بيفتح المكان المناسب لما المستخدم يدوس على إشعار — والتطبيق مقفول أو مفتوح من
 * البارد (`useLastNotificationResponse` بترجّع آخر دوسة حتى لو هي اللي فتحت
 * التطبيق). مركّب جنب الـStack في `app/_layout.tsx` ← مبيتركّبش وشاشة القفل
 * ظاهرة، وكمان بيفحص نفسه: الدوسة بتستنى لحد ما التطبيق يتفتح.
 */
export default function NotificationTapRouter() {
  const response = Notifications.useLastNotificationResponse();
  const { user } = useAuth();
  const { enabled, isLocked, readFailed } = useAppLock();
  const navReady = !!useRootNavigationState()?.key;
  const lockShown = shouldShowLock({ enabled, isLocked, readFailed });

  useEffect(() => {
    if (!response || !navReady) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const key = `${response.notification.request.identifier}|${response.notification.date}`;
    if (key === handledKey) return;
    if (!user) {
      // مش داخل: الدوسة القديمة تتعلّم اتعالجت (متنفّذش بعد تسجيل الدخول)، والجديدة تستنى
      const at = Number(response.notification.date);
      if (Number.isFinite(at) && Date.now() - at > STALE_TAP_MS) handledKey = key;
      return;
    }
    if (!canRouteNotification({ signedIn: true, lockShown })) return;
    const target = notificationTarget(response.notification.request.content.data);
    if (!target) { handledKey = key; return; }
    try {
      if ('params' in target) {
        // nonce: الدوسة التانية على نفس التاب لازم تغيّر البارامتر عشان الشاشة تتفاعل
        router.navigate({ pathname: target.pathname, params: { ...target.params, at: String(Date.now()) } });
      } else if (target.pathname === '/modal') router.push('/modal');
      else router.navigate('/');
      handledKey = key;
    } catch (e) {
      // التنقل فشل: التطبيق مفتوح عادي على الشاشة الحالية — بس مش ساكتين
      console.warn('[notification-tap] التنقل فشل');
      reportAtomicFailure('فتح مكان الإشعار', e);
    }
  }, [response, navReady, user, lockShown]);

  return null;
}
