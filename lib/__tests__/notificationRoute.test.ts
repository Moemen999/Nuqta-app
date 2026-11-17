import { canRouteNotification, notificationData, notificationTarget } from '@/lib/notificationRoute';

describe('الدوس على إشعار ← المكان', () => {
  it.each([
    ['income', { pathname: '/' }],
    ['charge', { pathname: '/' }],
    ['debt', { pathname: '/debts', params: { tab: 'debts' } }],
    ['subscription', { pathname: '/debts', params: { tab: 'subscriptions' } }],
    ['gamiya', { pathname: '/debts', params: { tab: 'gamiya' } }],
    ['daily', { pathname: '/modal' }],
  ] as const)('%s', (kind, target) => {
    expect(notificationTarget(notificationData(kind))).toEqual(target);
  });

  it('data مش بتاعتنا أو نوع مجهول ← null', () => {
    for (const d of [undefined, null, {}, { kind: 'x' }, { kind: 5 }, 'debt']) expect(notificationTarget(d)).toBeNull();
  });

  it('الـdata نوع بس — مفيش مبالغ ولا أسامي', () => {
    expect(Object.keys(notificationData('debt'))).toEqual(['kind']);
  });

  it('مفيش تنقل والقفل ظاهر أو من غير تسجيل دخول', () => {
    expect(canRouteNotification({ signedIn: true, lockShown: false })).toBe(true);
    expect(canRouteNotification({ signedIn: true, lockShown: true })).toBe(false);
    expect(canRouteNotification({ signedIn: false, lockShown: false })).toBe(false);
  });
});
