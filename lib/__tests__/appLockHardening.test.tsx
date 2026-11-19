import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { AppLockProvider, LOCK_MARKER_KEY, useAppLock } from '@/context/AppLockContext';

/**
 * الميزة 11 (القفل/الدخول/الحساب) — المشكّك: كلها قايمة.
 * 4 HIGH: التخزين الآمن رجّع null (المفتاح ضاع / BadPadding) والقفل كان مفعّل ← مقفول، مش «مفيش قفل».
 * 5: الساعة رجعت لورا ← قفل (fail closed).
 * 8: التفعيل بيظبط «امتى» على المتخزّن؛ والمسح بيرجّعه «عند الفتح».
 * 9: الرقم السري 4 أرقام بس.
 * 14: فشل مسح القفل بعد مسح الحساب بيوصل Sentry.
 */

const mockStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockStore[k]; }),
}));
jest.mock('@/lib/atomicFailure', () => ({ reportAtomicFailure: jest.fn() }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_a: string, s: string) => `h:${s}`),
  getRandomBytesAsync: jest.fn(async (n: number) => new Uint8Array(n).fill(7)),
}));
// eslint-disable-next-line import/first
import { reportAtomicFailure } from '@/lib/atomicFailure';

const holder: { current: ReturnType<typeof useAppLock> | null } = { current: null };
function Probe() { holder.current = useAppLock(); return null; }
const lock = () => holder.current!;

let appStateHandler: ((s: string) => void) | null = null;
beforeEach(async () => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  await AsyncStorage.clear();
  jest.clearAllMocks();
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_e: any, h: any) => {
    appStateHandler = h;
    return { remove: () => {} } as any;
  });
});
afterEach(() => jest.restoreAllMocks());

async function mount() {
  await render(<AppLockProvider><Probe /></AppLockProvider>);
  await waitFor(() => expect(lock().loading).toBe(false), { timeout: 3000 });
}

describe('4: علامة «القفل كان مفعّل» برّه التخزين الآمن', () => {
  it('التفعيل بيكتب العلامة، والمسح بيشيلها', async () => {
    await mount();
    await act(async () => { await lock().setupLock('pin', '1234'); });
    expect(await AsyncStorage.getItem(LOCK_MARKER_KEY)).toBe('1');
    await act(async () => { await lock().clearLock(); });
    expect(await AsyncStorage.getItem(LOCK_MARKER_KEY)).toBeNull();
  });

  it('التخزين الآمن رجّع null والعلامة بتقول مفعّل ← مقفول وreadFailed، وبيوصل Sentry', async () => {
    await AsyncStorage.setItem(LOCK_MARKER_KEY, '1');
    await mount();
    expect(lock().readFailed).toBe(true);
    expect(lock().isLocked).toBe(true);
    expect(reportAtomicFailure).toHaveBeenCalledWith('قراية القفل', expect.objectContaining({ name: 'LockKeyLostError' }));
  });

  it('مفيش علامة ومفيش قفل ← مفتوح عادي', async () => {
    await mount();
    expect(lock().readFailed).toBe(false);
    expect(lock().isLocked).toBe(false);
  });

  it('قفل قديم (قبل العلامة) اتقرا ← العلامة بتتكتب', async () => {
    mockStore.nuqta_lock_enabled = '1'; mockStore.nuqta_lock_hash = 'h:1234';
    await mount();
    await waitFor(async () => expect(await AsyncStorage.getItem(LOCK_MARKER_KEY)).toBe('1'));
  });

  it('مسح الحساب بيشيل العلامة', async () => {
    await mount();
    await act(async () => { await lock().setupLock('pin', '1234'); });
    await act(async () => { await lock().wipeLockForDeletedAccount(); });
    expect(await AsyncStorage.getItem(LOCK_MARKER_KEY)).toBeNull();
  });
});

describe('5: الساعة رجعت لورا', () => {
  it('كل مرة ترجع + مهلة 15 دقيقة، والساعة رجعت ساعة ← بيقفل', async () => {
    mockStore.nuqta_lock_enabled = '1'; mockStore.nuqta_lock_hash = 'h:1234';
    mockStore.nuqta_lock_freq = 'everyResume'; mockStore.nuqta_lock_grace = '15';
    await mount();
    await act(async () => { lock().unlock(); });
    const real = Date.now;
    try {
      let t = real();
      Date.now = () => t;
      await act(async () => { appStateHandler!('background'); });
      t -= 60 * 60 * 1000;
      await act(async () => { appStateHandler!('active'); });
      expect(lock().isLocked).toBe(true);
    } finally { Date.now = real; }
  });

  it('رجع في المهلة والساعة سليمة ← مبيقفلش', async () => {
    mockStore.nuqta_lock_enabled = '1'; mockStore.nuqta_lock_hash = 'h:1234';
    mockStore.nuqta_lock_freq = 'everyResume'; mockStore.nuqta_lock_grace = '15';
    await mount();
    await act(async () => { lock().unlock(); });
    await act(async () => { appStateHandler!('background'); });
    await act(async () => { appStateHandler!('active'); });
    expect(lock().isLocked).toBe(false);
  });
});

describe('8: «امتى» متزامن مع المتخزّن', () => {
  it('اتفعّل قبل كده بـ«كل مرة» واتشال من غير ما «امتى» يتمسح ← التفعيل التاني بيعرض «كل مرة»', async () => {
    await mount();
    expect(lock().frequency).toBe('onOpen');
    // مسح قديم وقع في النص: «امتى» فاضل في التخزين والحالة بتقول «عند الفتح»
    mockStore.nuqta_lock_freq = 'everyResume';
    await act(async () => { await lock().setupLock('pin', '1234'); });
    expect(lock().frequency).toBe(mockStore.nuqta_lock_freq);
  });

  it('المسح بيرجّع «امتى» للافتراضي في الحالة', async () => {
    await mount();
    await act(async () => { await lock().setupLock('pin', '1234'); });
    await act(async () => { await lock().setFrequency('everyResume'); });
    await act(async () => { await lock().clearLock(); });
    expect(lock().frequency).toBe('onOpen');
  });
});

describe('9: الرقم السري 4 أرقام بس (حماية تانية ورا الشاشة)', () => {
  it('«12a4» مبيتفعّلش', async () => {
    await mount();
    await expect(lock().setupLock('pin', '12a4')).rejects.toThrow();
    expect(mockStore.nuqta_lock_enabled).toBeUndefined();
  });
  it('تغيير لرقم سري مش أرقام ← error ومفيش تغيير', async () => {
    await mount();
    await act(async () => { await lock().setupLock('pin', '1234'); });
    const before = mockStore.nuqta_lock_hash;
    let res: string | undefined;
    await act(async () => { res = await lock().changeCode('1234', '٫٫٫٫', 'pin'); });
    expect(res).toBe('error');
    expect(mockStore.nuqta_lock_hash).toBe(before);
  });
});

describe('14: مسح القفل بعد مسح الحساب', () => {
  it('مفتاح وقع ← Sentry (السبب بس)', async () => {
    await mount();
    (SecureStore.deleteItemAsync as jest.Mock).mockImplementationOnce(async () => { throw new Error('keystore'); });
    await act(async () => { await lock().wipeLockForDeletedAccount(); });
    expect(reportAtomicFailure).toHaveBeenCalledWith('مسح القفل', expect.anything());
  });
});
