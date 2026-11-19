import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLockProvider, useAppLock, useLockShown } from '@/context/AppLockContext';
import { ChargeAutoNotices } from '@/components/ChargeHomeCards';
import { IncomeAutoNotices } from '@/components/IncomeHomeCards';
import { ThemeProvider } from '@/context/ThemeContext';
import { addDays, addMonths, todayStr } from '@/lib/finance';
import { useLockAwareAnnounce } from '@/lib/useLockAwareAnnounce';

/**
 * الميزة 11، security M1: الشجرة متركّبة تحت القفل (`LockGate`)، فالتسجيل التلقائي (إشعار بالاسم والمبلغ) وإعلانات قارئ
 * الشاشة كانوا بيشتغلوا والتطبيق مقفول. دلوقتي بيستنوا الفتح.
 */

const mockStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockStore[k]; }),
}));
jest.mock('@/lib/atomicFailure', () => ({ reportAtomicFailure: jest.fn() }));
const mockData: any = {};
const mockNotify = jest.fn(async () => {});
jest.mock('@/context/DataContext', () => ({
  ...jest.requireActual('@/context/DataContext'),
  useData: () => mockData,
}));
jest.mock('@/context/NotificationsContext', () => ({ useNotifications: () => ({ enabled: true }) }));
jest.mock('@/context/PrivacyContext', () => ({
  usePrivacy: () => ({ amountsHidden: false, hidePreference: false, loaded: true, money: (n: number) => String(n) }),
}));
jest.mock('@/lib/notifications', () => ({ notifyNow: (...a: unknown[]) => (mockNotify as any)(...a) }));

const today = todayStr();
const start = addMonths(today, -1);

const holder: { current: ReturnType<typeof useAppLock> | null } = { current: null };
function Probe() { holder.current = useAppLock(); return null; }

let announceSpy: jest.SpyInstance;
beforeEach(async () => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  await AsyncStorage.clear();
  mockNotify.mockClear();
  announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  Object.assign(mockStore, { nuqta_lock_enabled: '1', nuqta_lock_type: 'pin', nuqta_lock_hash: 'h', nuqta_lock_freq: 'onOpen' });
  Object.assign(mockData, {
    subscriptions: [{
      id: 's1', name: 'نتفليكس', amount: 200, walletId: 'w', frequency: 'monthly', nextDueDate: start,
      reminderDaysBefore: 3, active: true, createdAt: '', history: [], chargeMode: 'auto', chargeAutoSince: start,
    }],
    gamiyas: [],
    incomes: [{
      id: 'i1', name: 'المرتب', amount: 8000, walletId: 'w', frequency: 'weekly',
      weekday: new Date(`${addDays(today, -1)}T00:00:00Z`).getUTCDay(),
      mode: 'auto', status: 'active', startDate: addDays(today, -15), closed: {}, createdAt: '',
    }],
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }],
    serverReachable: true,
    recordCharges: jest.fn(async (_k: string, _id: string, entries: { key: string }[]) => ({ outcome: 'done', recorded: entries.map(e => e.key) })),
    recordIncomePeriods: jest.fn(async (_id: string, entries: { key: string }[]) => ({ outcome: 'done', recorded: entries.map(e => e.key) })),
  });
});
afterEach(() => announceSpy.mockRestore());

const tree = () => (
  <ThemeProvider>
    <AppLockProvider>
      <Probe />
      <ChargeAutoNotices />
      <IncomeAutoNotices />
    </AppLockProvider>
  </ThemeProvider>
);

it('مقفول ← مفيش تسجيل تلقائي ولا إشعار ولا إعلان؛ بعد الفتح بيكمّل', async () => {
  await render(tree());
  await waitFor(() => expect(holder.current!.loading).toBe(false));
  expect(holder.current!.isLocked).toBe(true);
  await act(async () => { await new Promise(r => setTimeout(r, 50)); });
  expect(mockData.recordCharges).not.toHaveBeenCalled();
  expect(mockData.recordIncomePeriods).not.toHaveBeenCalled();
  expect(mockNotify).not.toHaveBeenCalled();
  expect(announceSpy).not.toHaveBeenCalled();

  await act(async () => { holder.current!.unlock(); });
  await waitFor(() => expect(mockNotify).toHaveBeenCalledTimes(2));
  expect(mockData.recordCharges).toHaveBeenCalled();
  expect(mockData.recordIncomePeriods).toHaveBeenCalled();
  // الخصم بيتقال على المنصتين (الإعلان بعد الفتح)
  await waitFor(() => expect(announceSpy).toHaveBeenCalled());
});

it('useLockAwareAnnounce: مقفول ← «defer» بيتقال بعد الفتح مرة واحدة، و«drop» مبيتقالش خالص', async () => {
  let api: { announce: (t: string, m?: 'defer' | 'drop') => void; shown: boolean } | null = null;
  function A() { api = { announce: useLockAwareAnnounce(), shown: useLockShown() }; return null; }
  await render(<ThemeProvider><AppLockProvider><Probe /><A /></AppLockProvider></ThemeProvider>);
  await waitFor(() => expect(holder.current!.loading).toBe(false));
  expect(api!.shown).toBe(true);
  await act(async () => {
    api!.announce('اتسجل "نتفليكس"');
    api!.announce('اتسجل "نتفليكس"');
    api!.announce('عندك حاجتين مستنيين ردك', 'drop');
  });
  expect(announceSpy).not.toHaveBeenCalled();
  await act(async () => { holder.current!.unlock(); });
  expect(api!.shown).toBe(false);
  expect(announceSpy).toHaveBeenCalledTimes(1);
  expect(announceSpy).toHaveBeenCalledWith('اتسجل "نتفليكس"');
  await act(async () => { api!.announce('الأرقام اتحدّثت'); });
  expect(announceSpy).toHaveBeenLastCalledWith('الأرقام اتحدّثت');
});

it('useLockShown: وإحنا لسه بنقرا إعداد القفل ← true', async () => {
  const seen: boolean[] = [];
  function S() { seen.push(useLockShown()); return null; }
  await render(<AppLockProvider><S /></AppLockProvider>);
  expect(seen[0]).toBe(true);
});
