import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { NotificationsProvider, useNotifications } from '@/context/NotificationsContext';
import { scheduleAllReminders } from '@/lib/scheduleAllReminders';

/**
 * إذن "المنبهات والتذكيرات" بيأثر على المنبّهات اللي بتتجدول **بعده** بس (توثيق أندرويد)،
 * فلما المستخدم يرجع من الإعداد لازم الجدولة تتعاد — مرة واحدة، ومش في كل رجوع للتطبيق.
 */
const mockData = { subscriptions: [], gamiyas: [], debts: [], incomes: [] };
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('@/context/PrivacyContext', () => ({ usePrivacy: () => ({ hidePreference: false, loaded: true }) }));
jest.mock('@/lib/notifications', () => ({
  setupNotifications: jest.fn(async () => {}),
  hasNotificationPermission: jest.fn(async () => true),
  requestNotificationPermission: jest.fn(async () => true),
  cancelAllReminders: jest.fn(async () => {}),
}));
jest.mock('@/lib/scheduleAllReminders', () => ({ scheduleAllReminders: jest.fn(async () => {}) }));
jest.mock('@/lib/exactAlarm', () => ({ openExactAlarmSettings: jest.fn(async () => true) }));

let emit: (s: AppStateStatus) => void = () => {};
let api: ReturnType<typeof useNotifications>;
function Probe() { api = useNotifications(); return null; }

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('nuqta_notifs_enabled', '1');
  (scheduleAllReminders as jest.Mock).mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => {
    emit = cb as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});
afterEach(() => jest.restoreAllMocks());

async function mount() {
  await render(<NotificationsProvider><Probe /></NotificationsProvider>);
  await act(async () => {});
  await act(async () => {});
  return (scheduleAllReminders as jest.Mock).mock.calls.length;
}
const active = async (s: AppStateStatus = 'active') => { await act(async () => { emit(s); }); await act(async () => {}); };

it('فتح الإعداد ← رجوع للتطبيق ← الجدولة بتتعاد مرة واحدة', async () => {
  const before = await mount();
  expect(before).toBeGreaterThan(0);
  await act(async () => { expect(await api.openExactAlarmSettings()).toBe(true); });
  await active();
  expect((scheduleAllReminders as jest.Mock).mock.calls.length).toBe(before + 1);
  await active();
  expect((scheduleAllReminders as jest.Mock).mock.calls.length).toBe(before + 1);
});

it('رجوع للتطبيق من غير ما الإعداد يتفتح ← مفيش جدولة زيادة', async () => {
  const before = await mount();
  await active();
  await active('background');
  expect((scheduleAllReminders as jest.Mock).mock.calls.length).toBe(before);
});
