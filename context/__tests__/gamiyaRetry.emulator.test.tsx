import { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, runTransaction, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { gamiyaTxId } from '@/lib/autoCharge';
import { addMonths, todayStr } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

/**
 * مراجعة الجمعية (التطبيق كله، 2026-11-18) — نفس نمط `subscriptionRetry`: `runTransaction` و`getDocFromServer`
 * ملفوفين عشان نمثّل الرد اللي بيضيع بعد ما الـcommit وصل.
 *
 * A: "اتخصم/استلمت" من شاشة الجمعية — كل المحاولات فشلت بعد commit ممكن يكون وصل ← كان "مفيش أي خصم اتسجل".
 * B: الجمعية/الشهر اتمسح ← `missing`؛ الشهر اتسجل قبل كده ← `already-recorded` (كانوا `done` ساكت).
 * C: مسح الجمعية بيمسح كل عملياتها (مش اللي في `months` بس)، ومبيعدّيش وخصم شغال.
 * E: مسح عملية شهر من الأرشيف بيرجّع الشهر ده بس من نسخة السيرفر (كان بيكتب مصفوفة الشهور كلها من الرياكت).
 */
jest.mock('firebase/firestore', () => {
  const actual = jest.requireActual('firebase/firestore');
  return {
    ...actual,
    runTransaction: jest.fn((...args: unknown[]) => (actual.runTransaction as (...a: unknown[]) => unknown)(...args)),
    getDocFromServer: jest.fn((...args: unknown[]) => (actual.getDocFromServer as (...a: unknown[]) => unknown)(...args)),
  };
});

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => {
    const uid = require('@/test-utils/mockAuth').getMockUid();
    return { user: uid ? { uid } : null };
  },
}));

type TxFn = (t: unknown) => Promise<unknown>;
const actualFs = jest.requireActual('firebase/firestore');
const realRun = (fn: TxFn) => actualFs.runTransaction(db, fn);
const runMock = runTransaction as unknown as jest.Mock;
const serverGetMock = getDocFromServer as unknown as jest.Mock;
const unavailable = () => Object.assign(new Error('unavailable'), { code: 'unavailable' });

const landThenRetry = () => runMock.mockImplementationOnce(async (_db: unknown, fn: TxFn) => {
  await realRun(fn);
  return realRun(fn);
});
const landThenFail = () => runMock.mockImplementationOnce(async (_db: unknown, fn: TxFn) => {
  await realRun(fn);
  throw unavailable();
});
const failWithoutLanding = () => runMock.mockImplementationOnce(async () => { throw unavailable(); });
const serverCheckFails = () => serverGetMock.mockImplementation(async () => { throw unavailable(); });

let harness: Awaited<ReturnType<typeof renderDataProvider>>;
const today = todayStr();

beforeEach(async () => {
  runMock.mockClear();
  serverGetMock.mockReset();
  serverGetMock.mockImplementation((...args: unknown[]) => (actualFs.getDocFromServer as (...a: unknown[]) => unknown)(...args));
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForReady();
});

afterEach(async () => {
  await harness.unmount();
});

const userDoc = (...path: string[]) => doc(db, 'users', getMockUid(), ...path);

async function serverTxs() {
  const read = async () => (await getDocsFromServer(collection(db, 'users', getMockUid(), 'transactions'))).docs
    .map(d => ({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string }));
  await harness.waitForData(api => api.pendingWrites === 0);
  let prev = await read();
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 200));
    const next = await read();
    if (next.length === prev.length) return next;
    prev = next;
  }
  return prev;
}
async function serverTx(id: string) {
  return (await actualFs.getDocFromServer(userDoc('transactions', id))).data() as Record<string, any> | undefined;
}
async function serverGamiya(id: string) {
  return (await actualFs.getDocFromServer(userDoc('gamiyas', id))).data() as Record<string, any>;
}

/** جمعية 3 شهور: الأول النهارده، والاستلام في التالت */
async function makeGamiya() {
  const w = harness.api().wallets[0];
  const r = await harness.api().addGamiya({
    name: 'العيلة', monthlyAmount: 1000, totalMonths: 3, payoutMonthIndex: 3, payoutAmount: 3000,
    walletId: w.id, startDate: today, reminderDaysBefore: 3,
  });
  expect(r).toEqual({ outcome: 'done' });
  await harness.waitForData(api => api.gamiyas.length === 1 && api.pendingWrites === 0);
  const g = harness.api().gamiyas[0];
  return { g, walletId: w.id, m1: g.months[0], m2: g.months[1], m3: g.months[2] };
}

describe('A: "اتخصم" من شاشة الجمعية — بنسأل السيرفر قبل "مفيش أي خصم اتسجل"', () => {
  it('الكتابة وصلت والنتيجة unavailable ← done وعملية واحدة', async () => {
    const { g, m1 } = await makeGamiya();
    landThenFail();
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, 1000)).toBe('done');
    expect((await serverTxs()).filter(t => t.gamiyaId === g.id)).toHaveLength(1);
  });

  it('مفيش حاجة وصلت والسيرفر أكّد ← failed', async () => {
    const { g, m1 } = await makeGamiya();
    failWithoutLanding();
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, 1000)).toBe('failed');
    expect(await serverTxs()).toHaveLength(0);
  });

  it('مفيش رد وسؤال السيرفر فشل ← uncertain', async () => {
    const { g, m1 } = await makeGamiya();
    failWithoutLanding();
    serverCheckFails();
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, 1000)).toBe('uncertain');
  });

  it('الذرة اتعادت بعد ما الأولى وصلت ← done، والشهر عليه بصمة العملية', async () => {
    const { g, m1 } = await makeGamiya();
    landThenRetry();
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, 1000)).toBe('done');
    const tx = await serverTx(gamiyaTxId(g.id, m1.id));
    const month = (await serverGamiya(g.id)).months.find((m: { id: string }) => m.id === m1.id);
    expect(month.status).toBe('done');
    expect(typeof month.at).toBe('string');
    expect(tx?.createdAt).toBe(month.at);
  });

  it('فشل والشهر اتقفل على السيرفر من مكان تاني (مش ببصمتنا) ← already-recorded مش done', async () => {
    const { g, walletId, m1 } = await makeGamiya();
    const txId = gamiyaTxId(g.id, m1.id);
    await setDoc(userDoc('transactions', txId), {
      type: 'expense', amount: 1000, walletId, date: today, gamiyaId: g.id, periodKey: m1.id, createdAt: 'other-device',
    });
    const months = (await serverGamiya(g.id)).months.map((m: { id: string }) => (m.id === m1.id
      ? { ...m, status: 'done', transactionId: txId, at: 'other-device' } : m));
    failWithoutLanding();
    // الـlistener ممكن يكون لسه ما وصلوش — النداء على نسخة الرياكت القديمة، والسيرفر هو اللي بيحكم
    await updateDoc(userDoc('gamiyas', g.id), { months });
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, 1000)).toBe('already-recorded');
  });
});

describe('B: نتايج صريحة', () => {
  it('الجمعية اتمسحت ← missing (كان done ساكت)', async () => {
    const { g, m1 } = await makeGamiya();
    await deleteDoc(userDoc('gamiyas', g.id));
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, 1000)).toBe('missing');
    expect(await serverTxs()).toHaveLength(0);
  });

  it('الشهر مش موجود والجمعية لسه موجودة ← month-missing (مش "الجمعية اتمسحت")', async () => {
    const { g, m1 } = await makeGamiya();
    const months = (await serverGamiya(g.id)).months.filter((m: { id: string }) => m.id !== m1.id);
    await updateDoc(userDoc('gamiyas', g.id), { months });
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, 1000)).toBe('month-missing');
    expect(await serverTxs()).toHaveLength(0);
  });

  it('الشهر اتسجل قبل كده ← already-recorded ومفيش عملية تانية', async () => {
    const { g, m1 } = await makeGamiya();
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, 1000)).toBe('done');
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, 1000)).toBe('already-recorded');
    expect((await serverTxs()).filter(t => t.gamiyaId === g.id)).toHaveLength(1);
  });

  it('مبلغ الشهر المتخزّن NaN ← bad-amount ومفيش كتابة (مش "المبلغ اتغيّر" للأبد)', async () => {
    const { g, m1 } = await makeGamiya();
    const months = (await serverGamiya(g.id)).months.map((m: { id: string }) => (m.id === m1.id ? { ...m, amount: NaN } : m));
    await updateDoc(userDoc('gamiyas', g.id), { months });
    await harness.waitForData(api => Number.isNaN(api.gamiyas[0].months[0].amount));
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, NaN)).toBe('bad-amount');
    expect(await serverTx(gamiyaTxId(g.id, m1.id))).toBeUndefined();
  });

  it('شهر بعد كده (بدري) لسه بيتسجل من الشاشة', async () => {
    const { g, m2 } = await makeGamiya();
    expect(m2.dueDate).toBe(addMonths(today, 1));
    expect(await harness.api().markGamiyaMonthDone(g.id, m2.id, 1000)).toBe('done');
    expect((await serverTx(gamiyaTxId(g.id, m2.id)))?.amount).toBe(1000);
  });
});

describe('الكارت: شهر اتسجل بعملية قديمة (معرّف مش ثابت)', () => {
  it('recorded=[] من غير changed — "اتسجلت قبل كده" مش "الجمعية اتغيّرت"', async () => {
    const { g, m1 } = await makeGamiya();
    const months = (await serverGamiya(g.id)).months.map((m: { id: string }) => (m.id === m1.id
      ? { ...m, status: 'done', transactionId: 'legacy_tx' } : m));
    await updateDoc(userDoc('gamiyas', g.id), { months });
    await harness.waitForData(api => api.gamiyas[0].months[0].status === 'done');
    expect(await harness.api().recordCharges('gamiya', g.id, [{ key: m1.id, amount: 1000 }])).toEqual({ outcome: 'done', recorded: [] });
  });
});

describe('الكارت/التلقائي: أكتر من شهر في نفس الذرة وسؤال السيرفر بعد الفشل (مراجعة الجولة 2)', () => {
  /** جمعية بدأت الشهر اللي فات: شهر 1 فات معاده وشهر 2 النهارده — الاتنين مفتوحين */
  async function twoOpenMonths() {
    const w = harness.api().wallets[0];
    const r = await harness.api().addGamiya({
      name: 'القديمة', monthlyAmount: 1000, totalMonths: 3, payoutMonthIndex: 3, payoutAmount: 3000,
      walletId: w.id, startDate: addMonths(today, -1), reminderDaysBefore: 3,
    });
    expect(r).toEqual({ outcome: 'done' });
    await harness.waitForData(api => api.gamiyas.length === 1 && api.pendingWrites === 0);
    const g = harness.api().gamiyas[0];
    return { g, walletId: w.id, m1: g.months[0], m2: g.months[1] };
  }
  /** جهاز تاني سجّل الشهر ده (مش ببصمتنا) */
  async function closeElsewhere(gId: string, walletId: string, m: { id: string; dueDate: string }) {
    const txId = gamiyaTxId(gId, m.id);
    await setDoc(userDoc('transactions', txId), {
      type: 'expense', amount: 1000, walletId, date: m.dueDate, gamiyaId: gId, periodKey: m.id, createdAt: 'other-device',
    });
    const months = (await serverGamiya(gId)).months.map((x: { id: string }) => (x.id === m.id
      ? { ...x, status: 'done', transactionId: txId, at: 'other-device' } : x));
    await updateDoc(userDoc('gamiyas', gId), { months });
  }

  it('شهر واحد بس اتقفل من مكان تاني والتاني لسه مفتوح ← failed، مش "اتسجلت قبل كده"', async () => {
    const { g, walletId, m1, m2 } = await twoOpenMonths();
    expect(m1.dueDate <= today && m2.dueDate <= today).toBe(true);
    await closeElsewhere(g.id, walletId, m1);
    failWithoutLanding();
    const r = await harness.api().recordCharges('gamiya', g.id, [{ key: m1.id, amount: 1000 }, { key: m2.id, amount: 1000 }]);
    expect(r).toEqual({ outcome: 'failed', recorded: [] });
    expect(await serverTx(gamiyaTxId(g.id, m2.id))).toBeUndefined();
    expect((await serverGamiya(g.id)).months.find((m: { id: string }) => m.id === m2.id).status).toBe('pending');
  });

  it('كل الشهور اتقفلت من مكان تاني ← done وrecorded=[] ("اتسجلت قبل كده")', async () => {
    const { g, walletId, m1, m2 } = await twoOpenMonths();
    await closeElsewhere(g.id, walletId, m1);
    await closeElsewhere(g.id, walletId, m2);
    failWithoutLanding();
    const r = await harness.api().recordCharges('gamiya', g.id, [{ key: m1.id, amount: 1000 }, { key: m2.id, amount: 1000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [] });
  });
});

describe('C: مسح الجمعية', () => {
  it('بيمسح العملية بالمعرّف الثابت حتى لو الشهر عندنا لسه pending، وأي عملية عليها gamiyaId', async () => {
    const { g, walletId, m2 } = await makeGamiya();
    // جهاز تاني سجّل شهر 2 والجمعية لسه ما وصلتناش بالتحديث (الشهر عندنا pending)
    await setDoc(userDoc('transactions', gamiyaTxId(g.id, m2.id)), {
      type: 'expense', amount: 1000, walletId, date: m2.dueDate, gamiyaId: g.id, periodKey: m2.id, createdAt: 'other',
    });
    await setDoc(userDoc('transactions', 'stray'), {
      type: 'expense', amount: 50, walletId, date: today, gamiyaId: g.id, createdAt: new Date().toISOString(),
    });
    await harness.waitForData(api => api.transactions.length === 2 && api.pendingWrites === 0);
    expect(await harness.api().deleteGamiya(g.id)).toEqual({ outcome: 'done' });
    await harness.waitForData(api => api.pendingWrites === 0 && api.transactions.length === 0);
    expect(await serverTx(gamiyaTxId(g.id, m2.id))).toBeUndefined();
    expect(await serverTx('stray')).toBeUndefined();
  });

  it('خصم شغال على نفس الجمعية ← المسح بيستنى (blocked)', async () => {
    const { g, m1 } = await makeGamiya();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    runMock.mockImplementationOnce(async (_db: unknown, fn: TxFn) => { await gate; return realRun(fn); });
    const paying = harness.api().markGamiyaMonthDone(g.id, m1.id, 1000);
    await harness.waitForData(() => runMock.mock.calls.length > 0);
    expect((await harness.api().deleteGamiya(g.id)).outcome).toBe('blocked');
    release();
    expect(await paying).toBe('done');
    expect(await harness.api().deleteGamiya(g.id)).toEqual({ outcome: 'done' });
  });

  it('الكارت شغال على نفس الجمعية ← blocked برضه', async () => {
    const { g, m1 } = await makeGamiya();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    runMock.mockImplementationOnce(async (_db: unknown, fn: TxFn) => { await gate; return realRun(fn); });
    const paying = harness.api().recordCharges('gamiya', g.id, [{ key: m1.id, amount: 1000 }]);
    await harness.waitForData(() => runMock.mock.calls.length > 0);
    expect((await harness.api().deleteGamiya(g.id)).outcome).toBe('blocked');
    release();
    expect((await paying).outcome).toBe('done');
  });
});

describe('E: مسح عملية شهر من الأرشيف', () => {
  it('الشهر بيرجع يسأل، والعملية بتتمسح، والنتيجة done', async () => {
    const { g, m1 } = await makeGamiya();
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, 1000)).toBe('done');
    await harness.waitForData(api => api.transactions.length === 1 && api.pendingWrites === 0);
    expect(await harness.api().deleteTransaction(gamiyaTxId(g.id, m1.id))).toEqual({ outcome: 'done' });
    const month = (await serverGamiya(g.id)).months.find((m: { id: string }) => m.id === m1.id);
    expect(month).toMatchObject({ status: 'pending', reopened: true });
    expect(month.transactionId).toBeUndefined();
    expect(await serverTx(gamiyaTxId(g.id, m1.id))).toBeUndefined();
  });

  it('شهر تاني اتسجل على السيرفر ولسه ما وصلناش ← مبيتمسحش (مش مصفوفة الرياكت كلها)', async () => {
    const { g, walletId, m1, m2 } = await makeGamiya();
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, 1000)).toBe('done');
    await harness.waitForData(api => api.transactions.length === 1 && api.pendingWrites === 0);
    const del = harness.api().deleteTransaction;
    // جهاز تاني سجّل شهر 2 — النداء من نسخة الـrender اللي قبل التحديث
    const txId2 = gamiyaTxId(g.id, m2.id);
    await setDoc(userDoc('transactions', txId2), {
      type: 'expense', amount: 1000, walletId, date: m2.dueDate, gamiyaId: g.id, periodKey: m2.id, createdAt: 'other',
    });
    const months = (await serverGamiya(g.id)).months.map((m: { id: string }) => (m.id === m2.id
      ? { ...m, status: 'done', transactionId: txId2, at: 'other' } : m));
    await updateDoc(userDoc('gamiyas', g.id), { months });
    expect(await del(gamiyaTxId(g.id, m1.id))).toEqual({ outcome: 'done' });
    await harness.waitForData(api => api.pendingWrites === 0);
    const server = (await serverGamiya(g.id)).months;
    expect(server.find((m: { id: string }) => m.id === m2.id)).toMatchObject({ status: 'done', transactionId: txId2 });
    expect(server.find((m: { id: string }) => m.id === m1.id)).toMatchObject({ status: 'pending', reopened: true });
  });

  it('مسح فشل والسيرفر أكّد إنه ما وصلش ← failed، والعملية لسه موجودة', async () => {
    const { g, m1 } = await makeGamiya();
    expect(await harness.api().markGamiyaMonthDone(g.id, m1.id, 1000)).toBe('done');
    await harness.waitForData(api => api.transactions.length === 1 && api.pendingWrites === 0);
    failWithoutLanding();
    const r = await harness.api().deleteTransaction(gamiyaTxId(g.id, m1.id));
    expect(r.outcome).toBe('failed');
    expect(await serverTx(gamiyaTxId(g.id, m1.id))).toBeDefined();
  });
});

describe('من غير حساب مفتوح', () => {
  it('addGamiya/updateGamiya مبيرجّعوش done ساكت', async () => {
    const w = harness.api().wallets[0];
    await harness.unmount();
    setMockUid('');
    harness = await renderDataProvider();
    const add = await harness.api().addGamiya({
      name: 'العيلة', monthlyAmount: 1000, totalMonths: 3, payoutMonthIndex: 3, payoutAmount: 3000,
      walletId: w.id, startDate: today, reminderDaysBefore: 3,
    });
    expect(add.outcome).toBe('failed');
    expect((await harness.api().updateGamiya('x', { name: 'جديد' })).outcome).toBe('failed');
    expect(await harness.api().markGamiyaMonthDone('x', 'm', 1000)).toBe('failed');
  });

  it('deleteGamiya/deleteTransaction مبيرجّعوش done ومفيش حاجة اتمسحت', async () => {
    await harness.unmount();
    setMockUid('');
    harness = await renderDataProvider();
    const del = await harness.api().deleteGamiya('x');
    expect(del.outcome).toBe('blocked');
    expect((await harness.api().deleteTransaction('x')).outcome).toBe('no-account');
  });
});
