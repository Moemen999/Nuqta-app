import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetOutboxKeyRegistryCacheForTests, clearOutboxForUid, putOutboxEntry, setOutboxClearedIds, sweepOtherOutboxes,
  readOutboxSweptCount, clearOutboxSweptCount,
} from '@/lib/outboxStore';

/**
 * الميزة 8 (M): الكنس عند دخول حساب تاني كان بيمسح مدخلات الحساب الأول (خرج غصب) ساكت. دلوقتي بيتعدّ لكل حساب، والعدد
 * بيتحفظ في علامة **برّه** بادئات الطابور (الكنس الجاي ميمسحهاش)، وصاحبها بيشوف رسالة أول ما يدخل.
 */

jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn(), captureException: jest.fn(), addBreadcrumb: jest.fn() }));
jest.mock('@/firebaseConfig', () => ({ db: {}, auth: {} }));
jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
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
    getRandomBytesAsync: async (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
    digestStringAsync: async (_alg: string, s: string) => nodeCrypto.createHash('sha256').update(s).digest('hex'),
  };
});

const tx = { type: 'expense', amount: 5, walletId: 'w1', date: '2026-11-17' };
let warn: jest.SpyInstance;
beforeEach(async () => {
  await AsyncStorage.clear();
  __resetOutboxKeyRegistryCacheForTests();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

it('الكنس بيعدّ مدخلات كل حساب، والعدد بيفضل لصاحبه حتى بعد كنسة تانية', async () => {
  await putOutboxEntry('uid_A', 't1', tx);
  await putOutboxEntry('uid_A', 't2', tx);
  await putOutboxEntry('uid_C', 't3', tx);
  expect(await sweepOtherOutboxes('uid_B')).toBe(3);
  // حساب تالت دخل بعده — العلامة مش مدخلة طابور ولا علامة حساب، فمبتتكنسش
  await sweepOtherOutboxes('uid_D');
  expect(await readOutboxSweptCount('uid_A')).toBe(2);
  expect(await readOutboxSweptCount('uid_C')).toBe(1);
  expect(await readOutboxSweptCount('uid_B')).toBe(0);
});

it('اللي المستخدم اختار إنه يضيع (مسح الخروج فشل) مش بيتعدّ', async () => {
  await putOutboxEntry('uid_A', 't1', tx);
  await putOutboxEntry('uid_A', 't2', tx);
  await setOutboxClearedIds('uid_A', ['t1']);
  await sweepOtherOutboxes('uid_B');
  expect(await readOutboxSweptCount('uid_A')).toBe(1);
});

it('كنستين ← العدد بيتجمع، وبعد «تمام» بيتشال', async () => {
  await putOutboxEntry('uid_A', 't1', tx);
  await sweepOtherOutboxes('uid_B');
  await putOutboxEntry('uid_A', 't2', tx);
  await sweepOtherOutboxes('uid_B');
  expect(await readOutboxSweptCount('uid_A')).toBe(2);
  await clearOutboxSweptCount('uid_A');
  expect(await readOutboxSweptCount('uid_A')).toBe(0);
});

it('مسح الحساب بيشيل العلامة؛ الخروج لأ (الرسالة لسه ما اتشافتش)', async () => {
  await putOutboxEntry('uid_A', 't1', tx);
  await sweepOtherOutboxes('uid_B');
  await clearOutboxForUid('uid_A', () => null);
  expect(await readOutboxSweptCount('uid_A')).toBe(1);
  await clearOutboxForUid('uid_A');
  expect(await readOutboxSweptCount('uid_A')).toBe(0);
});
