import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createHash } from 'crypto';
import { collection, disableNetwork, doc, enableNetwork, getDocFromServer, getDocsFromServer, setDoc } from 'firebase/firestore';
import { act, waitFor } from '@testing-library/react-native';
import { db } from '@/firebaseConfig';
import { clearFirestore, settle, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { WRITE_ERROR_TITLE } from '@/lib/writeError';
import { todayStr } from '@/lib/finance';
import * as Sentry from '@sentry/react-native';
import {
  OUTBOX_PREFIX, OUTBOX_UNREADABLE_TITLE, openEntry, outboxSecureKeyName, outboxStorageKey, parseStored, rejectedReplayBody,
  unreadableReplayBody, walletGoneReplayBody, repeatedFailReplayBody, OUTBOX_EDIT_UNPROTECTED_TITLE, OUTBOX_EDIT_UNPROTECTED_BODY,
} from '@/lib/outbox';
import {
  __newOutboxSessionForTests, markUserSignOut, putOutboxEntry, readOutboxKey, replayOutboxDoc, serverTxStatus, updateOutboxMeta,
} from '@/lib/outboxStore';

jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn(), captureException: jest.fn(), addBreadcrumb: jest.fn() }));

/**
 * الطابور المحلي المتشفّر (reports/2026-11-16-outbox-design.md) على المحاكي الحقيقي و`DataProvider` الحقيقي.
 * "التطبيق اتقفل واتفتح" = مدخلة اتحفظت في جلسة قديمة (`__newOutboxSessionForTests`) والمستند مش على السيرفر، وبعدين
 * رسمة جديدة للبروفايدر. **قتل التطبيق الحقيقي** (طابور فايربيز اللي في الذاكرة بيضيع) يدوي على الجهاز.
 */

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => {
    const uid = require('@/test-utils/mockAuth').getMockUid();
    return { user: uid ? { uid } : null };
  },
}));

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
    getRandomBytesAsync: async (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
    digestStringAsync: async (_alg: string, s: string) => nodeCrypto.createHash('sha256').update(s).digest('hex'),
  };
});

const mockNotice = jest.fn();
jest.mock('@/components/NoticeProvider', () => ({ useNotice: () => mockNotice }));
jest.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => jest.fn() }));

const secure = (SecureStore as unknown as { __store: Record<string, string> }).__store;
const keyNameFor = (uid: string) => outboxSecureKeyName(createHash('sha256').update(uid).digest('hex'));
const outboxKeysOf = async (uid: string) => (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(`${OUTBOX_PREFIX}${uid}:`));
const txDoc = (uid: string, id: string) => doc(db, 'users', uid, 'transactions', id);
const serverTxs = async (uid: string) => (await getDocsFromServer(collection(db, 'users', uid, 'transactions'))).docs;

let h: Awaited<ReturnType<typeof renderDataProvider>> | undefined;
let uid: string;

beforeEach(async () => {
  mockNotice.mockClear();
  await AsyncStorage.clear();
  Object.keys(secure).forEach(k => delete secure[k]);
  await clearFirestore();
  uid = await signInTestUser();
  setMockUid(uid);
});
afterEach(async () => { await h?.unmount(); h = undefined; });

/** الحساب متجهّز على السيرفر (محافظ) ومن غير أي بروفايدر — عشان نحط مدخلات "جلسة قديمة" قبل الفتحة */
async function preparedAccount() {
  h = await renderDataProvider();
  await h.waitForReady();
  const walletId = h.api().wallets[0].id;
  await h.unmount();
  h = undefined;
  return walletId;
}

function newTxId() {
  return doc(collection(db, 'users', uid, 'transactions')).id;
}

/**
 * فشل تخزين مؤقت لمفاتيح معيّنة. **مش** `jest.spyOn(...).mockRestore()`: دوال الـmock بتاعة AsyncStorage هي نفسها `jest.fn`،
 * و`mockRestore` عليها بيمسح تنفيذها خالص — فكل الاختبارات اللي بعدها كانت بتقع (removeItem بيرجّع undefined).
 */
function failStorage(name: 'setItem' | 'removeItem' | 'multiRemove', when: (...args: any[]) => boolean): () => void {
  const fn = (AsyncStorage as unknown as Record<string, jest.Mock>)[name];
  const orig = fn.getMockImplementation()!;
  fn.mockImplementation(async (...args: any[]) => { if (when(...args)) throw new Error('disk'); return orig(...args); });
  return () => { fn.mockImplementation(orig); };
}

async function openStored(forUid: string, id: string) {
  const stored = parseStored(await AsyncStorage.getItem(outboxStorageKey(forUid, id)));
  if (!stored) return null;
  return openEntry(stored, forUid, id, await readOutboxKey(forUid));
}

it('1. حفظ من المودال ← مدخلة متشفّرة (من غير المبلغ مقروء)، وبتتشال بعد تأكيد السيرفر', async () => {
  h = await renderDataProvider();
  await h.waitForReady();
  const w = h.api().wallets[0].id;
  const id = await h.api().addTransaction({ type: 'expense', amount: 98765, walletId: w, date: todayStr(), note: 'ملاحظة سرية' }, { durable: true });
  const raw = await AsyncStorage.getItem(outboxStorageKey(uid, id));
  expect(raw).not.toBeNull();
  expect(raw).not.toContain('98765');
  expect(raw).not.toContain('ملاحظة');
  expect(Object.keys(secure)).toEqual([keyNameFor(uid)]);
  await waitFor(async () => expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).toBeNull(), { timeout: 15000 });
  await h.waitForData(api => api.outboxCount === 0 && !api.pendingTxIds.has(id));
  expect((await getDocFromServer(txDoc(uid, id))).data()?.amount).toBe(98765);
});

it('2. مدخلة من جلسة قديمة والعملية مش على السيرفر ← بتترفع بنفس الـid، نسخة واحدة، ومن غير رسالة', async () => {
  const w = await preparedAccount();
  const id = newTxId();
  const data = { type: 'expense', amount: 250, walletId: w, date: todayStr(), note: 'من غير نت', createdAt: new Date().toISOString() };
  expect(await putOutboxEntry(uid, id, data)).toBe('saved');
  __newOutboxSessionForTests();
  h = await renderDataProvider();
  await h.waitForReady();
  await waitFor(async () => expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).toBeNull(), { timeout: 20000 });
  // رفض بيشيل المدخلة كان هيبان هنا قبل قراية السيرفر (money-reviewer)
  expect(mockNotice).not.toHaveBeenCalled();
  // قراية مستند واحد من السيرفر — استعلام المجموعة كان ممكن يتجاوب من snapshot الـlistener قبل ما الكتابة توصله
  expect((await getDocFromServer(txDoc(uid, id))).data()).toEqual(data);
  await settle(1000);
  expect(await serverTxs(uid)).toHaveLength(1);
  expect(mockNotice).not.toHaveBeenCalled();
});

it('2ب. مدخلة من الجلسة الحالية مبتتعادش (لسه في طابور فايربيز)', async () => {
  const w = await preparedAccount();
  const id = newTxId();
  await putOutboxEntry(uid, id, { type: 'expense', amount: 10, walletId: w, date: todayStr() });
  h = await renderDataProvider();
  await h.waitForReady();
  await settle(2500);
  expect((await getDocFromServer(txDoc(uid, id))).exists()).toBe(false);
  expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).not.toBeNull();
  expect(h.api().outboxCount).toBe(1);
});

it('3. العملية وصلت قبل كده واتعدّلت 100 ← 120 من جهاز تاني ← الإعادة مبتكتبش فوقها والمدخلة بتتشال', async () => {
  const w = await preparedAccount();
  const id = newTxId();
  const base = { type: 'expense', amount: 100, walletId: w, date: todayStr() };
  await putOutboxEntry(uid, id, base);
  await setDoc(txDoc(uid, id), { ...base, amount: 120 });
  __newOutboxSessionForTests();
  h = await renderDataProvider();
  await h.waitForReady();
  await waitFor(async () => expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).toBeNull(), { timeout: 20000 });
  await settle(1000);
  expect((await getDocFromServer(txDoc(uid, id))).data()?.amount).toBe(120);
  expect(await serverTxs(uid)).toHaveLength(1);
});

it('3ب. ذرة الإعادة نفسها: المستند موجود ← مبتكتبش (الـlistener في 3 ممكن يشيل المدخلة قبلها)، مش موجود ← بتكتبه', async () => {
  const w0 = await preparedAccount();
  const id = newTxId();
  const base = { type: 'expense', amount: 100, walletId: w0, date: todayStr() };
  await setDoc(txDoc(uid, id), { ...base, amount: 120 });
  expect(await replayOutboxDoc(uid, id, base)).toBe('exists');
  expect((await getDocFromServer(txDoc(uid, id))).data()?.amount).toBe(120);
  const id2 = newTxId();
  expect(await replayOutboxDoc(uid, id2, base)).toBe('written');
  expect((await getDocFromServer(txDoc(uid, id2))).data()).toEqual(base);
}, 60000);

it('4. حساب تاني: مدخلاته بتتكنس، ومدخلة متشفّرة لحساب تاني تحت الحساب ده (حتى بنفس المفتاح) عمرها ما تتكتب', async () => {
  const w = await preparedAccount();
  const other = 'someoneElse';
  const idForeign = newTxId();
  const idCrossed = newTxId();
  const data = { type: 'expense', amount: 77, walletId: w, date: todayStr() };
  await putOutboxEntry(other, idForeign, data);
  await putOutboxEntry(other, idCrossed, data);
  // نفس المدخلة (متشفّرة بـAAD الحساب التاني) اتنقلت تحت مفتاح الحساب ده، ومعاها مفتاحه — الـAAD بيرفضها
  await AsyncStorage.setItem(outboxStorageKey(uid, idCrossed), (await AsyncStorage.getItem(outboxStorageKey(other, idCrossed)))!);
  secure[keyNameFor(uid)] = secure[keyNameFor(other)];
  __newOutboxSessionForTests();
  h = await renderDataProvider();
  await h.waitForReady();
  await waitFor(async () => expect(await outboxKeysOf(other)).toEqual([]), { timeout: 10000 });
  await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(OUTBOX_UNREADABLE_TITLE, expect.any(String), expect.any(Function)), { timeout: 15000 });
  await settle(1500);
  expect(await serverTxs(uid)).toHaveLength(0);
  expect((await getDocFromServer(txDoc(uid, idForeign))).exists()).toBe(false);
});

it('5. السيرفر رفض الإعادة (القواعد): أول جلسة بتعلّم بس (التوكن ممكن يكون لسه ما اتربطش)، والجلسة اللي بعدها رسالة واحدة والمدخلة بتتشال بعد "تمام"', async () => {
  const w = await preparedAccount();
  const id = newTxId();
  const date = todayStr();
  await putOutboxEntry(uid, id, { type: 'expense', amount: -5, walletId: w, date });
  const first = __newOutboxSessionForTests();
  h = await renderDataProvider();
  await h.waitForReady();
  await waitFor(async () => expect(parseStored(await AsyncStorage.getItem(outboxStorageKey(uid, id)))?.rj).toBe(first), { timeout: 20000 });
  await settle(1000);
  expect(mockNotice).not.toHaveBeenCalled();
  await h.unmount(); h = undefined;
  __newOutboxSessionForTests();
  h = await renderDataProvider();
  await h.waitForReady();
  await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(WRITE_ERROR_TITLE, rejectedReplayBody(-5, date, date), expect.any(Function)), { timeout: 20000 });
  // لسه موجودة لحد "تمام"
  expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).not.toBeNull();
  // الاتصال وقع ورجع قبل "تمام" ← مفيش إعادة تانية ولا رسالة تانية
  await disableNetwork(db);
  try { await h.waitForData(api => !api.serverReachable, 10000); } finally { await enableNetwork(db); }
  await h.waitForData(api => api.serverReachable, 15000);
  await settle(1500);
  expect(mockNotice).toHaveBeenCalledTimes(1);
  await act(async () => { mockNotice.mock.calls[0][2](); });
  await waitFor(async () => expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).toBeNull(), { timeout: 5000 });
  expect(await serverTxs(uid)).toHaveLength(0);
}, 90000);

it('6. المفتاح ضاع ← رسالة «ما قدرناش نرجّعها» بالعدد والتاريخ، مفيش كتابة، والمدخلة بتتشال بعد "تمام" بس', async () => {
  const w = await preparedAccount();
  const id = newTxId();
  await putOutboxEntry(uid, id, { type: 'expense', amount: 30, walletId: w, date: todayStr() });
  const savedAt = parseStored(await AsyncStorage.getItem(outboxStorageKey(uid, id)))!.savedAt;
  delete secure[keyNameFor(uid)];
  __newOutboxSessionForTests();
  h = await renderDataProvider();
  await h.waitForReady();
  await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(OUTBOX_UNREADABLE_TITLE, unreadableReplayBody(1, savedAt, todayStr()), expect.any(Function)), { timeout: 15000 });
  await settle(1000);
  // لسه موجودة لحد "تمام"، ومفيش مفتاح جديد اتعمل عليها
  expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).not.toBeNull();
  expect(secure[keyNameFor(uid)]).toBeUndefined();
  await act(async () => { mockNotice.mock.calls[0][2](); });
  await waitFor(async () => expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).toBeNull(), { timeout: 5000 });
  expect(await serverTxs(uid)).toHaveLength(0);
  await h.waitForData(api => api.outboxCount === 0);
});

it('7. من غير نت: تعديل عملية في الطابور بيتدمج فيها، والمسح بيشيلها — وبعد رجوع النت مفيش غير المعدّلة', async () => {
  h = await renderDataProvider();
  await h.waitForReady();
  const w = h.api().wallets[0].id;
  await disableNetwork(db);
  let kept = '';
  let gone = '';
  try {
    await h.waitForData(api => !api.serverReachable, 10000);
    kept = await h.api().addTransaction({ type: 'expense', amount: 100, walletId: w, date: todayStr() }, { durable: true });
    gone = await h.api().addTransaction({ type: 'expense', amount: 55, walletId: w, date: todayStr() }, { durable: true });
    await h.waitForData(api => api.outboxCount === 2);
    await h.api().updateTransaction(kept, { amount: 120, note: 'اتعدّلت' });
    const opened = await openStored(uid, kept);
    expect(opened).toEqual({ ok: true, data: expect.objectContaining({ amount: 120, note: 'اتعدّلت', walletId: w }) });
    // الجلسة والتاريخ زي ما هما
    expect(parseStored(await AsyncStorage.getItem(outboxStorageKey(uid, kept)))!.savedAt).toBe(todayStr());
    await h.api().deleteTransaction(gone);
    expect(await AsyncStorage.getItem(outboxStorageKey(uid, gone))).toBeNull();
    await h.waitForData(api => api.outboxCount === 1);
  } finally {
    await enableNetwork(db);
  }
  // رجوع الاتصال بعد disableNetwork بطيء أحيانًا تحت ضغط المحاكي — نستنى الاتصال الأول، وبعدين التأكيد
  await h.waitForData(api => api.serverReachable, 30000, 'outbox7:reconnect');
  await waitFor(async () => expect(await outboxKeysOf(uid)).toEqual([]), { timeout: 30000 });
  const docs = await serverTxs(uid);
  expect(docs.map(d => d.id)).toEqual([kept]);
  expect(docs[0].data().amount).toBe(120);
}, 90000);

it('8. مسح الحساب بيمسح الطابور ومفتاحه', async () => {
  h = await renderDataProvider();
  await h.waitForReady();
  const w = h.api().wallets[0].id;
  // مدخلة "مستنية" من الجلسة دي (مش هتتعاد ومش هتتأكد) — المسح لازم يشيلها هي ومفتاحها
  await putOutboxEntry(uid, newTxId(), { type: 'expense', amount: 5, walletId: w, date: todayStr() });
  expect(secure[keyNameFor(uid)]).toBeDefined();
  expect(await h.api().deleteAllMyData()).toEqual({ outcome: 'done' });
  expect(await outboxKeysOf(uid)).toEqual([]);
  expect(secure[keyNameFor(uid)]).toBeUndefined();
  expect(h.api().outboxCount).toBe(0);
});

it('9. الخروج بيمسح الطابور ومفتاحه (قرار مؤمن 1)', async () => {
  h = await renderDataProvider();
  await h.waitForReady();
  const w = h.api().wallets[0].id;
  await disableNetwork(db);
  try {
    await h.waitForData(api => !api.serverReachable, 10000);
    await h.api().addTransaction({ type: 'expense', amount: 40, walletId: w, date: todayStr() }, { durable: true });
    await h.waitForData(api => api.outboxCount === 1);
    const was = getMockUid();
    markUserSignOut(was);
    setMockUid(null as never);
    await act(async () => { h!.rerender(); });
    await waitFor(async () => expect(await outboxKeysOf(was)).toEqual([]), { timeout: 5000 });
    expect(secure[keyNameFor(was)]).toBeUndefined();
  } finally {
    await enableNetwork(db);
  }
});

it('العملية المربوطة مبتدخلش الطابور حتى لو حد طلب durable', async () => {
  h = await renderDataProvider();
  await h.waitForReady();
  const w = h.api().wallets[0].id;
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const id = await h.api().addTransaction({ type: 'income', amount: 9, walletId: w, date: todayStr(), incomeId: 'x' }, { durable: true });
    expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).toBeNull();
    expect(warn).toHaveBeenCalledWith('[outbox] durable refused for a linked transaction');
  } finally {
    warn.mockRestore();
  }
});

it('9ب. خروج غصب (من غير logOut) ← المدخلات بتفضل', async () => {
  const w = await preparedAccount();
  h = await renderDataProvider();
  await h.waitForReady();
  await putOutboxEntry(uid, newTxId(), { type: 'expense', amount: 3, walletId: w, date: todayStr() });
  setMockUid(null as never);
  await act(async () => { h!.rerender(); });
  await settle(1500);
  expect(await outboxKeysOf(uid)).toHaveLength(1);
  expect(secure[keyNameFor(uid)]).toBeDefined();
});

it('9ج. مسح الخروج فشل ← اللي اتحفظ قبل الخروج مبيتعادش بعد الدخول تاني', async () => {
  const w = await preparedAccount();
  h = await renderDataProvider();
  await h.waitForReady();
  const id = newTxId();
  await putOutboxEntry(uid, id, { type: 'expense', amount: 8, walletId: w, date: todayStr() });
  await settle(20);
  const restore = failStorage('multiRemove', (keys: string[]) => keys.includes(outboxStorageKey(uid, id)));
  try {
    markUserSignOut(uid);
    setMockUid(null as never);
    await act(async () => { h!.rerender(); });
    await waitFor(async () => expect(await AsyncStorage.getItem(`nuqta-outbox-x:v1:${uid}:cleared`)).not.toBeNull(), { timeout: 5000 });
    await settle(500);
  } finally { restore(); }
  expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).not.toBeNull();
  await h.unmount(); h = undefined;
  setMockUid(uid);
  __newOutboxSessionForTests();
  h = await renderDataProvider();
  await h.waitForReady();
  await waitFor(async () => expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).toBeNull(), { timeout: 15000 });
  await settle(1000);
  expect((await getDocFromServer(txDoc(uid, id))).exists()).toBe(false);
}, 60000);

it('10. المحفظة اتأرشفت قبل الإعادة ← مفيش كتابة، رسالة بالمبلغ والتاريخ، والمدخلة بتتشال بعد "تمام"', async () => {
  await preparedAccount();
  const archived = doc(collection(db, 'users', uid, 'wallets'));
  await setDoc(archived, { name: 'قديمة', openingBalance: 0, lowAlert: 0, archived: true, archivedAt: new Date().toISOString() });
  const id = newTxId();
  const date = todayStr();
  await putOutboxEntry(uid, id, { type: 'expense', amount: 60, walletId: archived.id, date });
  __newOutboxSessionForTests();
  h = await renderDataProvider();
  await h.waitForReady();
  await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(WRITE_ERROR_TITLE, walletGoneReplayBody(60, date, date), expect.any(Function)), { timeout: 20000 });
  expect((await getDocFromServer(txDoc(uid, id))).exists()).toBe(false);
  expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).not.toBeNull();
  await act(async () => { mockNotice.mock.calls[0][2](); });
  await waitFor(async () => expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).toBeNull(), { timeout: 5000 });
}, 60000);

it('11. مسح العملية وشيل مدخلتها فشل ← علامة مسح، والإعادة مبترجّعهاش', async () => {
  const w = await preparedAccount();
  const id = newTxId();
  await putOutboxEntry(uid, id, { type: 'expense', amount: 12, walletId: w, date: todayStr() });
  h = await renderDataProvider();
  await h.waitForReady();
  await h.waitForData(api => api.outboxCount === 1);
  const restore = failStorage('removeItem', (k: string) => k === outboxStorageKey(uid, id));
  try { await h.api().deleteTransaction(id); } finally { restore(); }
  expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).not.toBeNull();
  await h.unmount(); h = undefined;
  __newOutboxSessionForTests();
  h = await renderDataProvider();
  await h.waitForReady();
  await waitFor(async () => expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).toBeNull(), { timeout: 15000 });
  await settle(1000);
  expect((await getDocFromServer(txDoc(uid, id))).exists()).toBe(false);
  expect(mockNotice).not.toHaveBeenCalled();
}, 60000);

it('12. تعديل مقدرناش ندمجه (المدخلة مش مقروءة) ← المدخلة بتتكتب من جديد بالعملية كاملة بعد التعديل', async () => {
  h = await renderDataProvider();
  await h.waitForReady();
  const w = h.api().wallets[0].id;
  await disableNetwork(db);
  try {
    await h.waitForData(api => !api.serverReachable, 10000);
    const id = await h.api().addTransaction({ type: 'expense', amount: 100, walletId: w, date: todayStr(), note: 'أصل' }, { durable: true });
    await h.waitForData(api => api.transactions.some(t => t.id === id));
    delete secure[keyNameFor(uid)];
    await h.api().updateTransaction(id, { amount: 120 });
    expect(await openStored(uid, id)).toEqual({ ok: true, data: expect.objectContaining({ amount: 120, note: 'أصل', walletId: w, type: 'expense' }) });
  } finally {
    await enableNetwork(db);
  }
}, 60000);

it('13. حفظين مع بعض على حساب من غير مفتاح ← مفتاح واحد والاتنين مقروءين', async () => {
  const u = 'raceUser';
  const a = 'txa', b = 'txb';
  const data = { type: 'expense', amount: 1, walletId: 'w', date: todayStr() };
  await Promise.all([putOutboxEntry(u, a, data), putOutboxEntry(u, b, data)]);
  expect(await openStored(u, a)).toEqual({ ok: true, data });
  expect(await openStored(u, b)).toEqual({ ok: true, data });
});

it('14. قراية المفتاح فشلت: أول جلسة بنستنى، وفي جلسة تانية رسالة «ما قدرناش نرجّع»', async () => {
  const w = await preparedAccount();
  const id = newTxId();
  await putOutboxEntry(uid, id, { type: 'expense', amount: 9, walletId: w, date: todayStr() });
  const get = SecureStore.getItemAsync as jest.Mock;
  const name = keyNameFor(uid);
  const orig = get.getMockImplementation()!;
  get.mockImplementation(async (k: string) => { if (k === name) throw new Error('keystore'); return orig(k); });
  try {
    __newOutboxSessionForTests();
    h = await renderDataProvider();
    await h.waitForReady();
    await settle(2500);
    expect(mockNotice).not.toHaveBeenCalled();
    await h.unmount(); h = undefined;
    __newOutboxSessionForTests();
    h = await renderDataProvider();
    await h.waitForReady();
    await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(OUTBOX_UNREADABLE_TITLE, expect.any(String), expect.any(Function)), { timeout: 15000 });
  } finally { get.mockImplementation(orig); }
  expect((await getDocFromServer(txDoc(uid, id))).exists()).toBe(false);
}, 60000);

it('15. فشل غير الرفض بيتحسب بالجلسات: أقل من 3 ← تفضل وتتعلّم؛ 3 جلسات ← رسالة وتتشال بعد "تمام"', async () => {
  const w = await preparedAccount();
  const fresh = newTxId();
  const tired = newTxId();
  const date = todayStr();
  await putOutboxEntry(uid, fresh, { type: 'expense', amount: 21, walletId: w, date });
  await putOutboxEntry(uid, tired, { type: 'expense', amount: 22, walletId: w, date });
  await updateOutboxMeta(uid, tired, { fa: ['old1', 'old2'] });
  // اتعبت بس كانت وصلت فعلاً (محاولة قديمة عدّت السقف) ← بتتشال من غير رسالة (silent-failure جولة 2)
  const uploaded = newTxId();
  const upData = { type: 'expense', amount: 23, walletId: w, date };
  await putOutboxEntry(uid, uploaded, upData);
  await updateOutboxMeta(uid, uploaded, { fa: ['old1', 'old2'] });
  await setDoc(txDoc(uid, uploaded), upData);
  const spy = jest.spyOn(require('@/lib/outboxStore'), 'replayOutboxDoc').mockRejectedValue(Object.assign(new Error('x'), { code: 'aborted' }));
  try {
    const sid = __newOutboxSessionForTests();
    h = await renderDataProvider();
    await h.waitForReady();
    await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(WRITE_ERROR_TITLE, repeatedFailReplayBody(22, date, date), expect.any(Function)), { timeout: 20000 });
    expect(mockNotice).toHaveBeenCalledTimes(1);
    await waitFor(async () => expect(await AsyncStorage.getItem(outboxStorageKey(uid, uploaded))).toBeNull(), { timeout: 5000 });
    expect(parseStored(await AsyncStorage.getItem(outboxStorageKey(uid, fresh)))?.fa).toEqual([sid]);
    expect(await AsyncStorage.getItem(outboxStorageKey(uid, tired))).not.toBeNull();
    await act(async () => { mockNotice.mock.calls[0][2](); });
    await waitFor(async () => expect(await AsyncStorage.getItem(outboxStorageKey(uid, tired))).toBeNull(), { timeout: 5000 });
    expect(await AsyncStorage.getItem(outboxStorageKey(uid, fresh))).not.toBeNull();
  } finally { spy.mockRestore(); }
}, 60000);

it('16. حفظ النسخة على الجهاز فشل ← الكتابة بتكمّل، وحدث Sentry معدود من غير بيانات', async () => {
  h = await renderDataProvider();
  await h.waitForReady();
  const w = h.api().wallets[0].id;
  const capture = Sentry.captureMessage as jest.Mock;
  capture.mockClear();
  const restore = failStorage('setItem', (k: string) => k.startsWith(OUTBOX_PREFIX));
  let id = '';
  try { id = await h.api().addTransaction({ type: 'expense', amount: 4567, walletId: w, date: todayStr() }, { durable: true }); }
  finally { restore(); }
  await waitFor(() => expect(capture).toHaveBeenCalledWith('outbox: persist-failed', expect.objectContaining({ tags: { outbox_reason: 'persist-failed' } })), { timeout: 5000 });
  expect(JSON.stringify(capture.mock.calls)).not.toContain('4567');
  await waitFor(async () => expect((await getDocFromServer(txDoc(uid, id))).exists()).toBe(true), { timeout: 15000 });
});

it('15ب. السقف خلص (الذرة ممكن لسه توصل) ← مش بيتحسب فشل ومفيش رسالة', async () => {
  const w = await preparedAccount();
  const id = newTxId();
  await putOutboxEntry(uid, id, { type: 'expense', amount: 24, walletId: w, date: todayStr() });
  await updateOutboxMeta(uid, id, { fa: ['old1', 'old2'] });
  const spy = jest.spyOn(require('@/lib/outboxStore'), 'replayOutboxDoc').mockRejectedValue(new Error('timeout'));
  try {
    __newOutboxSessionForTests();
    h = await renderDataProvider();
    await h.waitForReady();
    await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 15000 });
    await settle(1500);
    expect(mockNotice).not.toHaveBeenCalled();
    expect(parseStored(await AsyncStorage.getItem(outboxStorageKey(uid, id)))?.fa).toEqual(['old1', 'old2']);
  } finally { spy.mockRestore(); }
}, 60000);

it('18. تعديل عملية مدخلتها اتشالت ← مبيعملش مدخلة جديدة (مفيش إحياء)', async () => {
  h = await renderDataProvider();
  await h.waitForReady();
  const w = h.api().wallets[0].id;
  await disableNetwork(db);
  try {
    await h.waitForData(api => !api.serverReachable, 10000);
    const id = await h.api().addTransaction({ type: 'expense', amount: 100, walletId: w, date: todayStr() }, { durable: true });
    await h.waitForData(api => api.transactions.some(t => t.id === id));
    // المدخلة اتشالت من التخزين (اتأكدت من جهة تانية) والعدّاد لسه شايفها
    await AsyncStorage.removeItem(outboxStorageKey(uid, id));
    await h.api().updateTransaction(id, { amount: 120 });
    expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).toBeNull();
    expect(mockNotice).not.toHaveBeenCalled();
  } finally {
    await enableNetwork(db);
  }
}, 60000);

it('19. تعديل مقدرناش نحميه (الدمج والكتابة فشلوا) ← المدخلة القديمة بتتشال ورسالة إن العملية مش محمية', async () => {
  h = await renderDataProvider();
  await h.waitForReady();
  const w = h.api().wallets[0].id;
  await disableNetwork(db);
  try {
    await h.waitForData(api => !api.serverReachable, 10000);
    const id = await h.api().addTransaction({ type: 'expense', amount: 100, walletId: w, date: todayStr() }, { durable: true });
    await h.waitForData(api => api.transactions.some(t => t.id === id));
    const restore = failStorage('setItem', (k: string) => k === outboxStorageKey(uid, id));
    try { await h.api().updateTransaction(id, { amount: 120 }); } finally { restore(); }
    expect(await AsyncStorage.getItem(outboxStorageKey(uid, id))).toBeNull();
    expect(mockNotice).toHaveBeenCalledWith(OUTBOX_EDIT_UNPROTECTED_TITLE, OUTBOX_EDIT_UNPROTECTED_BODY);
  } finally {
    await enableNetwork(db);
  }
}, 60000);

it('20. مسح الخروج وعلامته فشلوا مرتين ← حدث Sentry (اسم بس)', async () => {
  h = await renderDataProvider();
  await h.waitForReady();
  await putOutboxEntry(uid, newTxId(), { type: 'expense', amount: 6543, walletId: 'w', date: todayStr() });
  const capture = Sentry.captureMessage as jest.Mock;
  capture.mockClear();
  const r1 = failStorage('multiRemove', (keys: string[]) => keys.some(k => k.startsWith(`${OUTBOX_PREFIX}${uid}:`)));
  const r2 = failStorage('setItem', (k: string) => k === `nuqta-outbox-x:v1:${uid}:cleared`);
  try {
    markUserSignOut(uid);
    setMockUid(null as never);
    await act(async () => { h!.rerender(); });
    await waitFor(() => expect(capture).toHaveBeenCalledWith('outbox: signout-clear-failed', expect.anything()), { timeout: 5000 });
  } finally { r1(); r2(); }
  expect(JSON.stringify(capture.mock.calls)).not.toContain('6543');
});

it('21. فحص قبل "سجّلها تاني": موجودة ← present، مش موجودة ← missing — وDataContext بيعدّي عليه قبل أي رسالة', async () => {
  await preparedAccount();
  const there = newTxId();
  await setDoc(txDoc(uid, there), { type: 'expense', amount: 5, walletId: 'w', date: todayStr() });
  expect(await serverTxStatus(uid, there, 10000)).toBe('present');
  expect(await serverTxStatus(uid, newTxId(), 10000)).toBe('missing');
  const src = require('fs').readFileSync(require('path').resolve(__dirname, '../DataContext.tsx'), 'utf8');
  expect(src).toMatch(/const status = await serverTxStatus\(forUid, g\.txId, OUTBOX_REPLAY_TIMEOUT_MS\);\s*if \(status === 'present'\) \{ await dropOutbox/);
  expect(src).toMatch(/if \(status === 'missing'\) confirmedGiveUp\.push\(g\);/);
});

