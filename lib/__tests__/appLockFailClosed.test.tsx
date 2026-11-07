import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AppLockProvider, useAppLock } from '@/context/AppLockContext';

/**
 * بند A (مراجعة المشروع 2026-11-05، OWASP: الفشل = رفض):
 * - قراية الإعدادات وقت الفتح فشلت (بعد محاولات) ← **مقفول** و`readFailed`، مش مفتوح ساكت؛ و"جرّب تاني" بيقرا تاني.
 * - التفعيل: علم "مفعّل" **آخر** حاجة — وقوع في النص مبيسيبش قفل مفعّل من غير هاش.
 * - التحقق: فشل التخزين = `error` مش `wrong`.
 * - تغيير الكود: لو النوع وقع بعد الهاش، الهاش القديم بيرجع.
 * - المهلة وامتى يقفل: الفشل بيرجّع false مش رمية ساكتة.
 */

const mockStore: Record<string, string> = {};
let mockFailGet = 0; // عدد مرات قراية K_ENABLED اللي هترمي
let mockFailSet: string | null = null;
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => {
    if (k === 'nuqta_lock_enabled' && mockFailGet > 0) { mockFailGet--; throw new Error('keystore'); }
    return mockStore[k] ?? null;
  }),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (k === mockFailSet) throw new Error('keystore');
    mockStore[k] = v;
  }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockStore[k]; }),
}));
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
// الهاش الحقيقي native — هنا ثابت وبيفرّق بين الأكواد
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_a: string, s: string) => `h:${s}`),
  getRandomBytesAsync: jest.fn(async (n: number) => new Uint8Array(n).fill(7)),
}));

const holder: { current: ReturnType<typeof useAppLock> | null } = { current: null };
function Probe() { holder.current = useAppLock(); return null; }
const lock = () => holder.current!;

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockFailGet = 0; mockFailSet = null;
  // اختبارات بتغيّر القراية — نرجّعها للأصل
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => {
    if (k === 'nuqta_lock_enabled' && mockFailGet > 0) { mockFailGet--; throw new Error('keystore'); }
    return mockStore[k] ?? null;
  });
});

async function mount() {
  await render(<AppLockProvider><Probe /></AppLockProvider>);
  await waitFor(() => expect(lock().loading).toBe(false), { timeout: 3000 });
}

it('القراية فشلت كل المحاولات ← مقفول وreadFailed (مش مفتوح)، و"جرّب تاني" بيفتح لما التخزين يرجع', async () => {
  mockFailGet = 99;
  await mount();
  expect(lock().readFailed).toBe(true);
  expect(lock().isLocked).toBe(true);
  // التخزين رجع، ومفيش قفل متخزّن أصلاً ← مفتوح
  mockFailGet = 0;
  await act(async () => { await lock().retryRead(); });
  expect(lock().readFailed).toBe(false);
  expect(lock().isLocked).toBe(false);
});

it('القراية وقعت مرة ورجعت ← المحاولة التانية بتنجح (مش readFailed)', async () => {
  mockFailGet = 1;
  mockStore.nuqta_lock_enabled = '1'; mockStore.nuqta_lock_hash = 'x';
  await mount();
  expect(lock().readFailed).toBe(false);
  expect(lock().isLocked).toBe(true);
});

it('التفعيل وقع في النص (النوع) ← العلم ما اتكتبش، فمفيش قفل نص-نص؛ والدالة بترمي', async () => {
  await mount();
  mockFailSet = 'nuqta_lock_type';
  await expect(lock().setupLock('pin', '1234')).rejects.toThrow();
  expect(mockStore.nuqta_lock_enabled).toBeUndefined();
  expect(lock().enabled).toBe(false);
});

it('التفعيل الكامل ← العلم آخر حاجة اتكتبت', async () => {
  await mount();
  await act(async () => { await lock().setupLock('pin', '1234'); });
  const keys = (SecureStore.setItemAsync as jest.Mock).mock.calls.map(c => c[0]);
  expect(keys[keys.length - 1]).toBe('nuqta_lock_enabled');
  expect(keys.indexOf('nuqta_lock_hash')).toBeLessThan(keys.indexOf('nuqta_lock_enabled'));
});

it('التحقق: صح ← ok، غلط ← wrong، التخزين فشل ← error', async () => {
  await mount();
  await act(async () => { await lock().setupLock('pin', '1234'); });
  expect(await lock().verify('1234')).toBe('ok');
  expect(await lock().verify('9999')).toBe('wrong');
  // قراية الهاش بالاسم (أول قراية في verify بقت عدّاد المحاولات — فشلها مش حرج)
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => {
    if (k === 'nuqta_lock_hash') throw new Error('keystore');
    return mockStore[k] ?? null;
  });
  expect(await lock().verify('1234')).toBe('error');
});

it('تغيير الكود: النوع وقع بعد الهاش ← الهاش القديم رجع والنتيجة error (الكود القديم لسه شغال)', async () => {
  await mount();
  await act(async () => { await lock().setupLock('pin', '1234'); });
  const oldHash = mockStore.nuqta_lock_hash;
  mockFailSet = 'nuqta_lock_type';
  let res: string | undefined;
  await act(async () => { res = await lock().changeCode('1234', 'abcd', 'password'); });
  expect(res).toBe('error');
  expect(mockStore.nuqta_lock_hash).toBe(oldHash);
  mockFailSet = null;
  expect(await lock().verify('1234')).toBe('ok');
});

it('المهلة وامتى يقفل: الحفظ فشل ← false والقيمة القديمة بتفضل', async () => {
  await mount();
  mockFailSet = 'nuqta_lock_grace';
  let ok: boolean | undefined;
  await act(async () => { ok = await lock().setGraceMinutes(5); });
  expect(ok).toBe(false);
  expect(lock().graceMinutes).toBe(0);
  mockFailSet = 'nuqta_lock_freq';
  await act(async () => { ok = await lock().setFrequency('everyResume'); });
  expect(ok).toBe(false);
  expect(lock().frequency).toBe('onOpen');
});

describe('جولة 1 (security-reviewer + silent-failure-hunter)', () => {
  it('البوابة: القراية فشلت ← شاشة القفل حتى لو enabled=false (كانت بتتفتح)', () => {
    const { shouldShowLock } = require('@/context/AppLockContext');
    expect(shouldShowLock({ enabled: false, isLocked: true, readFailed: true })).toBe(true);
    expect(shouldShowLock({ enabled: true, isLocked: true, readFailed: false })).toBe(true);
    expect(shouldShowLock({ enabled: false, isLocked: false, readFailed: false })).toBe(false);
    expect(shouldShowLock({ enabled: true, isLocked: false, readFailed: false })).toBe(false);
  });

  it('app/_layout.tsx بيستخدم shouldShowLock (مش enabled && isLocked)', () => {
    const src = require('fs').readFileSync('app/_layout.tsx', 'utf8');
    expect(src).toContain('shouldShowLock({ enabled, isLocked, readFailed })');
    expect(src).not.toMatch(/if \(enabled && isLocked\)/);
  });

  it('مفتاح ثانوي (المهلة) فشل ← الافتراضي، مش مقفول برّه لمستخدم مالوش قفل', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => {
      if (k === 'nuqta_lock_grace') throw new Error('keystore');
      return mockStore[k] ?? null;
    });
    await mount();
    expect(lock().readFailed).toBe(false);
    expect(lock().isLocked).toBe(false);
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => {
      if (k === 'nuqta_lock_enabled' && mockFailGet > 0) { mockFailGet--; throw new Error('keystore'); }
      return mockStore[k] ?? null;
    });
  });

  it('القراية فشلت وبعدين "نسيت الكود؟" (clearLock) ← readFailed بيتشال', async () => {
    mockFailGet = 99;
    await mount();
    expect(lock().readFailed).toBe(true);
    await act(async () => { await lock().clearLock(); });
    expect(lock().readFailed).toBe(false);
    expect(lock().isLocked).toBe(false);
  });

  it('المسح: العلم اتمسح وبعده مفتاح وقع ← القفل اتشال (الحالة والتخزين متفقين)، مش رمية', async () => {
    await mount();
    await act(async () => { await lock().setupLock('pin', '1234'); });
    (SecureStore.deleteItemAsync as jest.Mock).mockImplementationOnce(async (k: string) => { delete mockStore[k]; })
      .mockImplementationOnce(async () => { throw new Error('keystore'); });
    await act(async () => { await lock().clearLock(); });
    expect(mockStore.nuqta_lock_enabled).toBeUndefined();
    expect(lock().enabled).toBe(false);
  });

  it('قراية لسه شغالة والمستخدم فتح ← القراية القديمة مبترجعش تقفل', async () => {
    mockStore.nuqta_lock_enabled = '1'; mockStore.nuqta_lock_hash = 'h:1234';
    await mount();
    expect(lock().isLocked).toBe(true);
    let release!: () => void;
    (SecureStore.getItemAsync as jest.Mock).mockImplementationOnce(() => new Promise(r => { release = () => r('1'); }));
    let p!: Promise<unknown>;
    await act(async () => { p = lock().retryRead(); });
    await act(async () => { lock().unlock(); });
    await act(async () => { release(); await p; });
    expect(lock().isLocked).toBe(false);
  });
});

describe('جولة 2', () => {
  it('القفل مفعّل ونوعه ما اتقراش ← "مقدرناش نقرا" (مش لوحة أرقام لصاحب باسورد)', async () => {
    mockStore.nuqta_lock_enabled = '1'; mockStore.nuqta_lock_type = 'password'; mockStore.nuqta_lock_hash = 'h:abcd';
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => {
      if (k === 'nuqta_lock_type') throw new Error('keystore');
      return mockStore[k] ?? null;
    });
    await mount();
    expect(lock().readFailed).toBe(true);
    expect(lock().isLocked).toBe(true);
  });

  it('مفيش قفل ونوعه ما اتقراش ← عادي (الافتراضي)، مش مقفول برّه', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => {
      if (k === 'nuqta_lock_type') throw new Error('keystore');
      return mockStore[k] ?? null;
    });
    await mount();
    expect(lock().readFailed).toBe(false);
    expect(lock().isLocked).toBe(false);
  });

  it('القراية فشلت وبعدين اتفتح بالكود ← readFailed بيتشال (الشاشة الجاية لوحة أرقام مش "مقدرناش")', async () => {
    mockFailGet = 99;
    await mount();
    await act(async () => { lock().unlock(); });
    expect(lock().readFailed).toBe(false);
  });

  it('retryRead بيرجّع true لما ينجح وfalse لما يفشل', async () => {
    mockFailGet = 99;
    await mount();
    let r: boolean | null = null;
    await act(async () => { r = await lock().retryRead(); });
    expect(r).toBe(false);
    mockFailGet = 0;
    await act(async () => { r = await lock().retryRead(); });
    expect(r).toBe(true);
  });
});
