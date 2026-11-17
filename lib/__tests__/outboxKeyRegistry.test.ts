import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Sentry from '@sentry/react-native';
import { createHash } from 'crypto';
import { outboxSecureKeyName, outboxStorageKey } from '@/lib/outbox';
import {
  OUTBOX_KEY_REGISTRY, OutboxKeyDeleteError, clearOutboxForUid, putOutboxEntry, sweepOtherOutboxes,
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
