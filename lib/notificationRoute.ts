/**
 * الدوس على إشعار بيفتح المكان المناسب (2026-11-17).
 *
 * الإشعار بيشيل **النوع بس** في `data` (مفيش مبالغ ولا أسامي — الـdata بتفضل
 * على الجهاز، بس مفيش سبب نخزّن أكتر من اللازم). والخريطة من النوع للمسار دالة
 * صرفة هنا عشان تتختبر من غير navigation.
 */
export type NotificationKind = 'income' | 'charge' | 'debt' | 'subscription' | 'gamiya' | 'daily';

const KINDS: readonly NotificationKind[] = ['income', 'charge', 'debt', 'subscription', 'gamiya', 'daily'];

export function notificationData(kind: NotificationKind): Record<string, unknown> {
  return { kind };
}

/** مسار + بارامترات (من غير الـnonce — بيتضاف وقت التنقل) */
export type NotificationTarget =
  | { pathname: '/' }
  | { pathname: '/modal' }
  | { pathname: '/debts'; params: { tab: 'debts' | 'subscriptions' | 'gamiya' } };

/** `null` = data مش بتاعتنا أو نوع مش معروف ← التطبيق يفتح من غير ما يروح مكان */
export function notificationTarget(data: unknown): NotificationTarget | null {
  const kind = (data as { kind?: unknown } | null | undefined)?.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as NotificationKind)) return null;
  switch (kind as NotificationKind) {
    // الشيت "مستنيين ردك" مالوش طريقة تتطلب من برّه — الرئيسية بتعرض السطر
    case 'income':
    case 'charge': return { pathname: '/' };
    case 'debt': return { pathname: '/debts', params: { tab: 'debts' } };
    case 'subscription': return { pathname: '/debts', params: { tab: 'subscriptions' } };
    case 'gamiya': return { pathname: '/debts', params: { tab: 'gamiya' } };
    case 'daily': return { pathname: '/modal' };
  }
}

/**
 * مبنروحش لحاجة غير لما المستخدم داخل **والتطبيق مفتوح**: القفل بيمنع أي
 * دخول (الرد بيتعالج بعد ما يتفتح، مش بيعدّي من فوقه).
 */
export function canRouteNotification(s: { signedIn: boolean; lockShown: boolean }): boolean {
  return s.signedIn && !s.lockShown;
}
