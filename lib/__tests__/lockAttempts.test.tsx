import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppLockProvider, useAppLock } from '@/context/AppLockContext';

/**
 * حد محاولات كود القفل (2026-11-07): 3 غلط ← انتظار، والانتظار **محفوظ** (قفل التطبيق وفتحه ميصفّرهوش)، والكود الصح
 * كمان بيستنى، والملح بيتكتب مع الهاش في قيمة واحدة، والهاش القديم بيترقّى.
 */
const mockStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockStore[k]; }),
}));
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
let mockSaltByte = 7;
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_a: string, s: string) => `h:${s}`),
  getRandomBytesAsync: jest.fn(async (n: number) => new Uint8Array(n).fill(mockSaltByte)),
}));

const holder: { current: ReturnType<typeof useAppLock> | null } = { current: null };
function Probe() { holder.current = useAppLock(); return null; }
const lock = () => holder.current!;
let nowMs = 1_000_000;

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  nowMs = 1_000_000; mockSaltByte = 7;
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterEach(() => { jest.restoreAllMocks(); });

async function mount() {
  const r = await render(<AppLockProvider><Probe /></AppLockProvider>);
  await waitFor(() => expect(lock().loading).toBe(false), { timeout: 3000 });
  return r;
}
async function verify(c: string) { let r = ''; await act(async () => { r = await lock().verify(c); }); return r; }
async function setup(code = '1234') { await act(async () => { await lock().setupLock('pin', code); }); }

it('3 غلط ← بعدها "استنى" حتى بالكود الصح، وبعد 30 ثانية الكود الصح بيفتح والعدّاد بيتصفّر', async () => {
  await mount();
  await setup();
  expect(await verify('0000')).toBe('wrong');
  expect(await verify('0000')).toBe('wrong');
  expect(lock().waitUntil).toBe(0);
  expect(await verify('0000')).toBe('wrong');
  expect(lock().waitUntil).toBe(nowMs + 30_000);
  expect(await verify('1234')).toBe('wait');
  nowMs += 30_001;
  expect(await verify('1234')).toBe('ok');
  expect(mockStore.nuqta_lock_fails).toBeUndefined();
  expect(lock().waitUntil).toBe(0);
});

it('الانتظار محفوظ: قفل التطبيق وفتحه (Provider جديد) ميصفّرش العدّاد، والانتظار بيبان من أول الفتح', async () => {
  const r = await mount();
  await setup();
  for (let i = 0; i < 3; i++) await verify('0000');
  await r.unmount();
  await mount();
  expect(lock().waitUntil).toBe(nowMs + 30_000);
  expect(await verify('1234')).toBe('wait');
});

it('الغلط بعد الانتظار بيطوّل الانتظار (دقيقة)', async () => {
  await mount();
  await setup();
  for (let i = 0; i < 3; i++) await verify('0000');
  nowMs += 30_001;
  expect(await verify('0000')).toBe('wrong');
  expect(lock().waitUntil).toBe(nowMs + 60_000);
});

it('الهاش بملح في قيمة واحدة، وملح مختلف = هاش مختلف لنفس الكود', async () => {
  await mount();
  await setup();
  const salt7 = '07'.repeat(16);
  const a = mockStore.nuqta_lock_hash;
  expect(a).toBe(`v2:${salt7}:h:${salt7}1234`);
  mockSaltByte = 9;
  await setup();
  expect(mockStore.nuqta_lock_hash).not.toBe(a);
  expect(await verify('1234')).toBe('ok');
});

it('هاش قديم من غير ملح: الكود الصح بيفتح وبيترقّى لـv2، والغلط مبيرقّيش', async () => {
  mockStore.nuqta_lock_enabled = '1'; mockStore.nuqta_lock_type = 'pin'; mockStore.nuqta_lock_hash = 'h:1234';
  await mount();
  expect(await verify('9999')).toBe('wrong');
  expect(mockStore.nuqta_lock_hash).toBe('h:1234');
  expect(await verify('1234')).toBe('ok');
  expect(mockStore.nuqta_lock_hash.startsWith('v2:')).toBe(true);
  expect(await verify('1234')).toBe('ok');
});

it('"نسيت الكود؟" (clearLock) بيمسح العدّاد — اللي يرجع يحط قفل جديد ميلاقيش انتظار قديم', async () => {
  await mount();
  await setup();
  for (let i = 0; i < 3; i++) await verify('0000');
  await act(async () => { await lock().clearLock(); });
  expect(mockStore.nuqta_lock_fails).toBeUndefined();
  expect(lock().waitUntil).toBe(0);
});

it('إلغاء القفل وتغيير الكود بيعدّوا على نفس الحد', async () => {
  await mount();
  await setup();
  for (let i = 0; i < 3; i++) await verify('0000');
  let d = ''; await act(async () => { d = await lock().disableLock('1234'); });
  expect(d).toBe('wait');
  let c = ''; await act(async () => { c = await lock().changeCode('1234', '5678', 'pin'); });
  expect(c).toBe('wait');
  expect(lock().enabled).toBe(true);
});

describe('جولة المراجعة (security-reviewer + silent-failure-hunter)', () => {
  const SS = () => require('expo-secure-store') as { getItemAsync: jest.Mock; setItemAsync: jest.Mock };
  // كل اختبار هنا بيغيّر التخزين — نرجّعه للأصل (restoreAllMocks مبيرجّعش تنفيذ jest.fn)
  beforeEach(() => {
    SS().getItemAsync.mockImplementation(async (k: string) => mockStore[k] ?? null);
    SS().setItemAsync.mockImplementation(async (k: string, v: string) => { mockStore[k] = v; });
  });

  it('5 محاولات غلط مع بعض (من غير استنى) بتتعدّ 5 مش 1', async () => {
    await mount();
    await setup();
    let results: string[] = [];
    await act(async () => { results = await Promise.all(['1', '2', '3', '4', '5'].map(d => lock().verify(d.repeat(4)))); });
    expect(results).toEqual(['wrong', 'wrong', 'wrong', 'wait', 'wait']);
    expect(JSON.parse(mockStore.nuqta_lock_fails).count).toBe(3);
  });

  it('كتابة العدّاد بتفشل دايمًا ← الحد لسه شغال (عدّاد الذاكرة)', async () => {
    await mount();
    await setup();
    SS().setItemAsync.mockImplementation(async (k: string, v: string) => {
      if (k === 'nuqta_lock_fails') throw new Error('keystore');
      mockStore[k] = v;
    });
    for (let i = 0; i < 3; i++) expect(await verify('0000')).toBe('wrong');
    expect(await verify('1234')).toBe('wait');
  });

  it('قراية العدّاد فشلت مرة ← مبيرجعش لصفر ومبيكتبش 1 فوق العدّ الحقيقي', async () => {
    await mount();
    await setup();
    for (let i = 0; i < 3; i++) await verify('0000');
    nowMs += 30_001;
    SS().getItemAsync.mockImplementationOnce(async () => { throw new Error('keystore'); });
    expect(await verify('0000')).toBe('wrong');
    expect(JSON.parse(mockStore.nuqta_lock_fails).count).toBe(4);
    expect(lock().waitUntil).toBe(nowMs + 60_000);
  });

  it('ساعة الموبايل كانت قدّام واتصلّحت ← الانتظار مبيزيدش عن تأخير العدّ', async () => {
    mockStore.nuqta_lock_enabled = '1'; mockStore.nuqta_lock_type = 'pin'; mockStore.nuqta_lock_hash = 'h:1234';
    mockStore.nuqta_lock_fails = JSON.stringify({ count: 3, until: nowMs + 5 * 86_400_000 });
    await mount();
    expect(lock().waitUntil).toBe(nowMs + 30_000);
    nowMs += 30_001;
    expect(await verify('1234')).toBe('ok');
  });

  it('تفعيل قفل جديد بيصفّر الانتظار الظاهر', async () => {
    await mount();
    await setup();
    for (let i = 0; i < 3; i++) await verify('0000');
    expect(lock().waitUntil).toBeGreaterThan(0);
    await setup('5678');
    expect(lock().waitUntil).toBe(0);
    expect(await verify('5678')).toBe('ok');
  });
});
