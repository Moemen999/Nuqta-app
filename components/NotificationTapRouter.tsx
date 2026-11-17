import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { shouldShowLock, useAppLock } from '@/context/AppLockContext';
import { useAuth } from '@/context/AuthContext';
import { canRouteNotification, notificationTarget } from '@/lib/notificationRoute';

/** آخر رد اتعالج — الكومبوننت بيتركّب تاني بعد كل فتح من القفل، ومينفعش الدوسة القديمة تنفّذ مرتين */
let handledKey: string | null = null;
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
    if (!canRouteNotification({ signedIn: !!user, lockShown })) return;
    const key = `${response.notification.request.identifier}|${response.notification.date}`;
    if (key === handledKey) return;
    handledKey = key;
    const target = notificationTarget(response.notification.request.content.data);
    if (!target) return;
    try {
      if ('params' in target) {
        // nonce: الدوسة التانية على نفس التاب لازم تغيّر البارامتر عشان الشاشة تتفاعل
        router.navigate({ pathname: target.pathname, params: { ...target.params, at: String(Date.now()) } });
      } else if (target.pathname === '/modal') router.push('/modal');
      else router.navigate('/');
    } catch {
      // التنقل فشل: التطبيق مفتوح عادي على الشاشة الحالية
    }
  }, [response, navReady, user, lockShown]);

  return null;
}
