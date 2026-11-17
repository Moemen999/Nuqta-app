import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Sentry from '@sentry/react-native';
import { createHash } from 'crypto';
import { openEntry, outboxSecureKeyName, outboxStorageKey, parseStored } from '@/lib/outbox';
import {
  OUTBOX_KEY_REGISTRY, OutboxEntriesClearError, __resetOutboxKeyRegistryCacheForTests, OutboxKeyDeleteError, clearOutboxForUid, putOutboxEntry, readOutboxKey, sweepOtherOutboxes,
} from '@/lib/outboxStore';

/**
 * مفاتيح SecureStore اليتيمة (security-reviewer قبل الدمج، 2026-11-17): SecureStore مالوش "هات كل المفاتيح"، فمفتاح حساب
 * خرج غصب أو بـ«نسيت الكود؟» كان بيفضل للأبد. السجل في AsyncStorage فيه الأسامي بس (من غير uid خام)، والكنس بيمسح الباقي.
 */

jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn(), captureException: jest.fn(), addBreadcrumb: jest.fn() }));
jest.mock('@/firebaseConfig', () => ({ db: {}, auth: {} }));
jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    __store: store,
    getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});
jest.mock('expo-crypto', () => {
  const nodeCrypto = require('crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
    digestStringAsync: async (_alg: string, s: string) => nodeCrypto.createHash('sha256').update(s).digest('hex'),
  };
});

const secure = (SecureStore as unknown as { __store: Record<string, string> }).__store;
const keyNameFor = (uid: string) => outboxSecureKeyName(createHash('sha256').update(uid).digest('hex'));
const registry = async (): Promise<string[]> => JSON.parse((await AsyncStorage.getItem(OUTBOX_KEY_REGISTRY)) ?? '[]');
const tx = { type: 'expense', amount: 5, walletId: 'w1', date: '2026-11-17' };

let warn: jest.SpyInstance;
beforeEach(async () => {
  await AsyncStorage.clear();
  __resetOutboxKeyRegistryCacheForTests();
  Object.keys(secure).forEach(k => delete secure[k]);
  (SecureStore.deleteItemAsync as jest.Mock).mockClear();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

it('الحفظ بيسجّل اسم المفتاح بس — مفيش uid خام في السجل', async () => {
  await putOutboxEntry('uid_A_raw', 'tx1', tx);
  expect(await registry()).toEqual([keyNameFor('uid_A_raw')]);
  expect(await AsyncStorage.getItem(OUTBOX_KEY_REGISTRY)).not.toContain('uid_A_raw');
});

it('الدخول بحساب تاني ← مفتاح الحساب القديم (خرج غصب) بيتمسح من SecureStore ومن السجل، ومفتاح الحالي بيفضل', async () => {
  await putOutboxEntry('uid_A', 'tx1', tx); // خروج غصب: المدخلة والمفتاح فاضلين
  await putOutboxEntry('uid_B', 'tx2', tx);
  expect(secure[keyNameFor('uid_A')]).toBeDefined();
  await sweepOtherOutboxes('uid_B');
  expect(secure[keyNameFor('uid_A')]).toBeUndefined();
  expect(secure[keyNameFor('uid_B')]).toBeDefined();
  expect(await registry()).toEqual([keyNameFor('uid_B')]);
  expect(await AsyncStorage.getItem(outboxStorageKey('uid_A', 'tx1'))).toBeNull();
});

it('مسح مفتاح قديم فشل ← بيفضل في السجل والكنس الجاي بيمسحه', async () => {
  await putOutboxEntry('uid_A', 'tx1', tx);
  (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keystore'));
  await sweepOtherOutboxes('uid_B');
  expect(secure[keyNameFor('uid_A')]).toBeDefined();
  expect(await registry()).toContain(keyNameFor('uid_A'));
  await sweepOtherOutboxes('uid_B');
  expect(secure[keyNameFor('uid_A')]).toBeUndefined();
  expect(await registry()).not.toContain(keyNameFor('uid_A'));
});

it('clearOutboxForUid: مسح المفتاح نجح ← الاسم بيتشال من السجل؛ فشل ← OutboxKeyDeleteError والاسم بيفضل', async () => {
  await putOutboxEntry('uid_A', 'tx1', tx);
  (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keystore'));
  await expect(clearOutboxForUid('uid_A')).rejects.toBeInstanceOf(OutboxKeyDeleteError);
  expect(await registry()).toEqual([keyNameFor('uid_A')]);
  await clearOutboxForUid('uid_A');
  expect(await registry()).toEqual([]);
  expect(secure[keyNameFor('uid_A')]).toBeUndefined();
  expect(Sentry.captureMessage).not.toHaveBeenCalled(); // البلاغ عند اللي بينادي (مسح الحساب)، مش هنا
});

/* ─── المراجعة الأخيرة (security + silent-failure-hunter جولة 2) ─── */

it('السجل مش محمي: اسم مش بشكل مفتاح الطابور (قفل التطبيق مثلاً) عمره ما بيتمسح من SecureStore', async () => {
  secure.nuqta_lock_hash = 'h';
  secure['nuqta-lock-x'] = 'x';
  secure.nuqta_outbox_k_short = 'y';
  await putOutboxEntry('uid_A', 'tx1', tx);
  await AsyncStorage.setItem(OUTBOX_KEY_REGISTRY, JSON.stringify(['nuqta_lock_hash', 'nuqta-lock-x', 'nuqta_outbox_k_short', keyNameFor('uid_A')]));
  await sweepOtherOutboxes('uid_B');
  expect(secure.nuqta_lock_hash).toBe('h');
  expect(secure['nuqta-lock-x']).toBe('x');
  expect(secure.nuqta_outbox_k_short).toBe('y');
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(keyNameFor('uid_A'));
});

it('تبديل حساب في نص الكنس: مفتاح الحساب اللي بقى داخل دلوقتي ميتمسحش', async () => {
  await putOutboxEntry('uid_A', 'tx1', tx);
  await putOutboxEntry('uid_C', 'tx3', tx);
  let current = 'uid_B';
  // أول مسح (مفتاح A) بيخلّي الحساب الحالي C — الكنس اللي بدأ لـB لازم يسيب مفتاح C
  const del = SecureStore.deleteItemAsync as jest.Mock;
  const orig = del.getMockImplementation()!;
  del.mockImplementationOnce(async (k: string) => { current = 'uid_C'; return orig(k); });
  await sweepOtherOutboxes('uid_B', () => current);
  expect(secure[keyNameFor('uid_C')]).toBeDefined();
  expect(await registry()).toContain(keyNameFor('uid_C'));
});

it('إعادة مسح الخروج بعد ما نفس الحساب رجع دخل ← مفيش مسح للمفتاح ولا للمدخلات الجديدة', async () => {
  await putOutboxEntry('uid_A', 'tx1', tx);
  await clearOutboxForUid('uid_A', () => 'uid_A');
  expect(secure[keyNameFor('uid_A')]).toBeDefined();
  expect(await AsyncStorage.getItem(outboxStorageKey('uid_A', 'tx1'))).not.toBeNull();
});

it('رجع دخل في نص المسح (بعد شيل المدخلات، قبل مسح المفتاح) ← المفتاح بيفضل', async () => {
  await putOutboxEntry('uid_A', 'tx1', tx);
  let current: string | undefined;
  const multiRemove = jest.spyOn(AsyncStorage, 'multiRemove').mockImplementationOnce(async (keys) => {
    current = 'uid_A';
    await Promise.all((keys as string[]).map(k => AsyncStorage.removeItem(k)));
  });
  await clearOutboxForUid('uid_A', () => current);
  multiRemove.mockRestore();
  expect(secure[keyNameFor('uid_A')]).toBeDefined();
  expect(await registry()).toContain(keyNameFor('uid_A'));
});

it('مسح مفتاح شغال وحساب رجع دخل وحفظ: الحفظ بيستنى المسح (نفس الطابور) فبيعمل مفتاح جديد ويسجّله — المدخلة مقروءة', async () => {
  await putOutboxEntry('uid_A', 'tx1', tx);
  let current = 'uid_B';
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const del = SecureStore.deleteItemAsync as jest.Mock;
  const orig = del.getMockImplementation()!;
  let deleting!: () => void;
  const started = new Promise<void>(r => { deleting = r; });
  del.mockImplementationOnce(async (k: string) => { deleting(); await gate; return orig(k); });
  const sweep = sweepOtherOutboxes('uid_B', () => current);
  await started; // المسح بدأ فعلاً (قرر إن A مش الحالي)
  current = 'uid_A';
  const put = putOutboxEntry('uid_A', 'tx2', tx);
  await new Promise(r => setTimeout(r, 0));
  release();
  await Promise.all([sweep, put]);
  expect(secure[keyNameFor('uid_A')]).toBeDefined();
  expect(await registry()).toContain(keyNameFor('uid_A'));
  expect(await readOutboxKey('uid_A')).not.toBeNull();
  const stored = parseStored(await AsyncStorage.getItem(outboxStorageKey('uid_A', 'tx2')));
  expect(openEntry(stored!, 'uid_A', 'tx2', await readOutboxKey('uid_A')).ok).toBe(true);
});

it('السجل مش مقروء ← Sentry بالاسم، ومبيتكتبش فوقه، والحفظ بيكمّل', async () => {
  await AsyncStorage.setItem(OUTBOX_KEY_REGISTRY, '{not json');
  expect(await putOutboxEntry('uid_A', 'tx1', tx)).toBe('saved');
  expect(await AsyncStorage.getItem(OUTBOX_KEY_REGISTRY)).toBe('{not json');
  expect(Sentry.captureMessage).toHaveBeenCalledWith('outbox: key-registry-unreadable', expect.anything());
  await sweepOtherOutboxes('uid_B');
  expect(await AsyncStorage.getItem(OUTBOX_KEY_REGISTRY)).toBe('{not json');
  expect(secure[keyNameFor('uid_A')]).toBeDefined(); // السجل مش مقروء ← الكنس مبيمسحش مفاتيح على عماه
});

it('مسح المدخلات فشل ← OutboxEntriesClearError والمفتاح ما اتلمسش', async () => {
  await putOutboxEntry('uid_A', 'tx1', tx);
  const spy = jest.spyOn(AsyncStorage, 'multiRemove').mockRejectedValueOnce(new Error('disk'));
  await expect(clearOutboxForUid('uid_A')).rejects.toBeInstanceOf(OutboxEntriesClearError);
  spy.mockRestore();
  expect(secure[keyNameFor('uid_A')]).toBeDefined();
});
