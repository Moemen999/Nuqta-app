import { NotificationsProvider, useNotifications } from '@/context/NotificationsContext';
import { PrivacyProvider } from '@/context/PrivacyContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import React from 'react';
import { AppState } from 'react-native';

/**
 * المستخدم بيقدر يقفل الإشعارات من إعدادات الموبايل ويرجع للتطبيق، والتطبيق
 * مش بيتبلّغ. من غير إعادة الفحص، المفتاح بيفضل شغّال وسطر الحالة بيقول
 * "تذكير يومي 8 م" وإحنا عارفين إن مفيش إشعار هيوصل — كدبة على شاشة
 * المستخدم نفسها.
 */

const granted = { current: true };

jest.mock('@/lib/notifications', () => ({
  setupNotifications: jest.fn(async () => {}),
  hasNotificationPermission: jest.fn(async () => granted.current),
  requestNotificationPermission: jest.fn(async () => granted.current),
  cancelAllReminders: jest.fn(async () => {}),
}));

jest.mock('@/lib/scheduleAllReminders', () => ({
  scheduleAllReminders: jest.fn(async () => {}),
}));

jest.mock('@/context/DataContext', () => ({
  useData: () => ({ subscriptions: [], gamiyas: [], debts: [] }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PrivacyProvider><NotificationsProvider>{children}</NotificationsProvider></PrivacyProvider>
);

async function setup() {
  const view = await renderHook(() => useNotifications(), { wrapper });
  // بننتظر التحميل الأولي يخلص
  await act(async () => {});
  return view;
}

beforeEach(async () => {
  granted.current = true;
  await AsyncStorage.clear();
});

describe('الإذن الحقيقي هو اللي بيحكم', () => {
  it('مفعّل في التخزين + الإذن موجود = شغّال', async () => {
    await AsyncStorage.setItem('nuqta_notifs_enabled', '1');
    const view = await setup();
    expect(view.result.current.enabled).toBe(true);
  });

  it('مفعّل في التخزين + الإذن مرفوض = مقفول — التخزين لوحده مش كفاية', async () => {
    await AsyncStorage.setItem('nuqta_notifs_enabled', '1');
    granted.current = false;
    const view = await setup();
    expect(view.result.current.enabled).toBe(false);
  });

  it('الرجوع للتطبيق بعد ما المستخدم قفلها من الإعدادات بيطفي المفتاح', async () => {
    await AsyncStorage.setItem('nuqta_notifs_enabled', '1');
    const view = await setup();
    expect(view.result.current.enabled).toBe(true);

    // المستخدم راح لإعدادات الموبايل وقفلها، وبعدين رجع
    granted.current = false;
    await act(async () => { view.result.current.refreshPermission(); });

    expect(view.result.current.enabled).toBe(false);
  });

  it('الرجوع بعد ما سمح من الإعدادات بيرجّع المفتاح من غير ما يدوس تاني', async () => {
    await AsyncStorage.setItem('nuqta_notifs_enabled', '1');
    granted.current = false;
    const view = await setup();
    expect(view.result.current.enabled).toBe(false);

    granted.current = true;
    await act(async () => { view.result.current.refreshPermission(); });

    expect(view.result.current.enabled).toBe(true);
  });

  it('الإذن موجود بس المستخدم مقفلها من التطبيق = بتفضل مقفولة', async () => {
    await AsyncStorage.setItem('nuqta_notifs_enabled', '0');
    const view = await setup();
    await act(async () => { view.result.current.refreshPermission(); });
    expect(view.result.current.enabled).toBe(false);
  });

  it('بيتسجّل على رجوع التطبيق — مش محتاج الشاشة تكون مفتوحة', async () => {
    const spy = jest.spyOn(AppState, 'addEventListener');
    await setup();
    expect(spy).toHaveBeenCalledWith('change', expect.any(Function));
    spy.mockRestore();
  });
});
