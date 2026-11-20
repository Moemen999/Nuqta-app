import { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, runTransaction, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { addMonths, todayStr } from '@/lib/finance';
import { incomeOpenPeriods, incomeTxId, incomeUpcomingPeriod } from '@/lib/recurringIncome';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

/**
 * الدخل الثابت بقى زي الاشتراكات والجمعية (`recordCharges`، مراجعة 2026-11-18) — نفس نمط `gamiyaRetry`:
 * `runTransaction` و`getDocFromServer` ملفوفين عشان نمثّل الرد اللي بيضيع بعد ما الـcommit وصل.
 *
 * H1+H2: `at` برّه الذرة — الإعادة بعد commit وصل بتحسب كتابتنا "اتسجلت"، والفشل بيسأل السيرفر قبل "ما اتسجلش".
 * M2: `recorded=[]` بيقول السبب (`stopped`/`skipped`/`already`/`changed`)، والدخل اللي اتمسح ← `missing`، ومفيش حساب ← `failed`.
 * M3: التلقائي بيرفض لو الدخل مابقاش تلقائي على السيرفر، وبياخد المبلغ من السيرفر، ومفاتيح برّه الجدول بتتشال؛
 *     "نزل" بالمبلغ المعتاد والمعتاد اتغيّر على السيرفر ← `amount-changed`.
 * M4: المبلغ مقرّب للقرش قبل الكتابة، واللي بيتقرّب لصفر بيترفض.
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
/** شهرين فاتوا — معاده (يوم 25) قبل النهارده أكيد */
const KEY = addMonths(today, -2).slice(0, 7);

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
  return read();
}
async function serverTx(id: string) {
  return (await actualFs.getDocFromServer(userDoc('transactions', id))).data() as Record<string, any> | undefined;
}
async function serverIncome(id: string) {
  return (await actualFs.getDocFromServer(userDoc('incomes', id))).data() as Record<string, any>;
}

/** مرتب شهري يوم 25، بدأ من 6 شهور — فـ`KEY` مفتوح */
async function makeIncome(mode: 'confirm' | 'auto' = 'confirm') {
  const w = harness.api().wallets[0];
  await harness.api().addIncome({ name: 'المرتب', amount: 8000, walletId: w.id, frequency: 'monthly', dayOfMonth: 25, mode });
  await harness.waitForData(api => api.incomes.length === 1 && api.pendingWrites === 0);
  const id = harness.api().incomes[0].id;
  const startDate = addMonths(today, -6);
  await updateDoc(userDoc('incomes', id), { startDate });
  await harness.waitForData(api => api.incomes[0].startDate === startDate);
  expect(incomeOpenPeriods(harness.api().incomes[0], today)).toContain(KEY);
  return { walletId: w.id, incomeId: id };
}

describe('H1+H2: الرد اللي ضاع — بنسأل السيرفر قبل "ما اتسجلش"', () => {
  it('الكتابة وصلت والنتيجة unavailable ← done وrecorded فيه الفترة، وعملية واحدة', async () => {
    const { incomeId } = await makeIncome();
    landThenFail();
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [KEY], recordedTotal: 8000 });
    expect((await serverTxs()).filter(t => t.incomeId === incomeId)).toHaveLength(1);
  });

  it('مفيش حاجة وصلت والسيرفر أكّد ← failed', async () => {
    const { incomeId } = await makeIncome();
    failWithoutLanding();
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'failed', recorded: [] });
    expect(await serverTxs()).toHaveLength(0);
  });

  it('مفيش رد وسؤال السيرفر فشل ← uncertain', async () => {
    const { incomeId } = await makeIncome();
    failWithoutLanding();
    serverCheckFails();
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'uncertain', recorded: [] });
  });

  it('الذرة اتعادت بعد ما الأولى وصلت ← recorded فيه الفترة (مش "اتسجلت قبل كده")، والبصمة على العلامة والعملية', async () => {
    const { incomeId } = await makeIncome();
    landThenRetry();
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [KEY], recordedTotal: 8000 });
    const closed = (await serverIncome(incomeId)).closed[KEY];
    const tx = await serverTx(incomeTxId(incomeId, KEY));
    expect(typeof closed.at).toBe('string');
    expect(tx?.createdAt).toBe(closed.at);
  });

  it('فشل والفترة اتقفلت على السيرفر من مكان تاني (مش ببصمتنا) ← done وalready، مش "تم" ولا failed', async () => {
    const { walletId, incomeId } = await makeIncome();
    const txId = incomeTxId(incomeId, KEY);
    await setDoc(userDoc('transactions', txId), {
      type: 'income', amount: 8000, walletId, date: `${KEY}-25`, incomeId, periodKey: KEY, createdAt: 'other-device',
    });
    await updateDoc(userDoc('incomes', incomeId), { closed: { [KEY]: { txId, at: 'other-device' } } });
    failWithoutLanding();
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [], already: true });
  });
});

describe('M2: نتايج صريحة بدل {done, recorded: []}', () => {
  it('الدخل اتمسح ← missing (مش failed "اتأكد من النت")', async () => {
    const { incomeId } = await makeIncome();
    await deleteDoc(userDoc('incomes', incomeId));
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'missing', recorded: [] });
    expect(await serverTxs()).toHaveLength(0);
  });

  it('اتوقف من جهاز تاني ← stopped', async () => {
    const { incomeId } = await makeIncome();
    await updateDoc(userDoc('incomes', incomeId), { status: 'paused' });
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [], stopped: true });
  });

  it('اتقفلت "ما نزلش" ← skipped', async () => {
    const { incomeId } = await makeIncome();
    await updateDoc(userDoc('incomes', incomeId), { closed: { [KEY]: { skipped: true, at: 'x' } } });
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [], skipped: true });
  });

  it('اتسجلت قبل كده ← already', async () => {
    const { incomeId } = await makeIncome();
    expect((await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }])).recorded).toEqual([KEY]);
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [], already: true });
  });
});

describe('M3: السيرفر هو اللي بيحكم', () => {
  it('التلقائي والدخل بقى "بيسأل" على السيرفر ← مفيش تسجيل', async () => {
    const { incomeId } = await makeIncome('auto');
    await updateDoc(userDoc('incomes', incomeId), { mode: 'confirm' });
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }], { auto: true });
    expect(r.outcome).toBe('done');
    expect(r.recorded).toEqual([]);
    expect(await serverTx(incomeTxId(incomeId, KEY))).toBeUndefined();
  });

  it('التلقائي بياخد المبلغ من السيرفر مش من النسخة المحلية', async () => {
    const { incomeId } = await makeIncome('auto');
    await updateDoc(userDoc('incomes', incomeId), { amount: 9000 });
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }], { auto: true });
    expect(r.recorded).toEqual([KEY]);
    expect(r.recordedTotal).toBe(9000);
    expect((await serverTx(incomeTxId(incomeId, KEY)))?.amount).toBe(9000);
  });

  it('مفتاح برّه الجدول ← ما اتسجلش (changed)', async () => {
    const { incomeId } = await makeIncome();
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: '2099-01', amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [], changed: true });
    expect(await serverTx(incomeTxId(incomeId, '2099-01'))).toBeUndefined();
  });

  it('التلقائي على الفترة الجاية (لسه معادها ما جاش) ← ما اتسجلش', async () => {
    const { incomeId } = await makeIncome('auto');
    const up = incomeUpcomingPeriod(harness.api().incomes[0], today)!;
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: up, amount: 8000 }], { auto: true });
    expect(r.recorded).toEqual([]);
    expect(await serverTx(incomeTxId(incomeId, up))).toBeUndefined();
  });

  it('"نزل" بدري على الفترة الجاية (يدوي) ← بيتسجل', async () => {
    const { incomeId } = await makeIncome();
    const up = incomeUpcomingPeriod(harness.api().incomes[0], today)!;
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: up, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [up], recordedTotal: 8000 });
  });

  it('"نزل" بالمبلغ المعتاد والمعتاد اتغيّر على السيرفر ← amount-changed ومفيش كتابة', async () => {
    const { incomeId } = await makeIncome();
    await updateDoc(userDoc('incomes', incomeId), { amount: 9000 });
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }], { seenAmount: 8000 });
    expect(r).toEqual({ outcome: 'amount-changed', recorded: [] });
    expect(await serverTx(incomeTxId(incomeId, KEY))).toBeUndefined();
  });

  it('"المبلغ مختلف" (مبلغ مكتوب بإيده، من غير seenAmount) ← بيتسجل بالمكتوب', async () => {
    const { incomeId } = await makeIncome();
    await updateDoc(userDoc('incomes', incomeId), { amount: 9000 });
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 7200 }]);
    expect(r.recorded).toEqual([KEY]);
    expect((await serverTx(incomeTxId(incomeId, KEY)))?.amount).toBe(7200);
  });
});

describe('M4: المبلغ بالقرش', () => {
  it('100.456 ← بيتكتب 100.46', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 100.456 }]);
    expect((await serverTx(incomeTxId(incomeId, KEY)))?.amount).toBe(100.46);
  });

  it('0.004 (بيتقرّب لصفر) ← badAmount ومفيش كتابة ولا قفل', async () => {
    const { incomeId } = await makeIncome();
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 0.004 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [], badAmount: true });
    expect(await serverTx(incomeTxId(incomeId, KEY))).toBeUndefined();
    expect((await serverIncome(incomeId)).closed?.[KEY]).toBeUndefined();
  });
});

describe('L4: العملية مربوطة بالدخل بـincomeId حتى لو العلامة ضاعت', () => {
  it('transactionLinkWarning بيحذّر', async () => {
    const { walletId, incomeId } = await makeIncome();
    // سباق "ما نزلش": العلامة بقت skipped والعملية لسه موجودة
    await updateDoc(userDoc('incomes', incomeId), { closed: { [KEY]: { skipped: true, at: 'x' } } });
    await setDoc(userDoc('transactions', incomeTxId(incomeId, KEY)), {
      type: 'income', amount: 8000, walletId, date: `${KEY}-25`, incomeId, periodKey: KEY, createdAt: new Date().toISOString(),
    });
    await harness.waitForData(api => api.transactions.length === 1 && !!api.incomes[0].closed?.[KEY]?.skipped);
    expect(harness.api().transactionLinkWarning(incomeTxId(incomeId, KEY))).toContain('الدخل الثابت "المرتب"');
  });
});

/**
 * الجولة الأخيرة (2026-11-18): سباق "ما نزلش" بيقلب العلامة `{ skipped }` والعملية موجودة — السبب مايبقاش "ما نزلش"
 * والفلوس اتسجلت. العملية بتتقري جوه الذرة وفي سؤال السيرفر: موجودة ← already، ولو ببصمتنا ← recorded.
 */
describe('العلامة skipped والعملية موجودة', () => {
  const skipMark = (incomeId: string) => updateDoc(userDoc('incomes', incomeId), { [`closed.${KEY}`]: { skipped: true, at: 'other-device' } });
  async function otherDeviceTx(walletId: string, incomeId: string) {
    await setDoc(userDoc('transactions', incomeTxId(incomeId, KEY)), {
      type: 'income', amount: 8000, walletId, date: `${KEY}-25`, incomeId, periodKey: KEY, createdAt: 'other-device',
    });
  }

  it('جوه الذرة: العملية موجودة من جهاز تاني ← already مش skipped', async () => {
    const { walletId, incomeId } = await makeIncome();
    await otherDeviceTx(walletId, incomeId);
    await skipMark(incomeId);
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [], already: true });
  });

  it('سؤال السيرفر بعد الفشل: العملية موجودة من جهاز تاني ← already مش skipped', async () => {
    const { walletId, incomeId } = await makeIncome();
    await otherDeviceTx(walletId, incomeId);
    await skipMark(incomeId);
    failWithoutLanding();
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [], already: true });
  });

  it('الإعادة جوه الذرة: كتابتنا وصلت و"ما نزلش" قلب العلامة قبل الإعادة ← recorded (عمليتنا ببصمتنا)', async () => {
    const { incomeId } = await makeIncome();
    runMock.mockImplementationOnce(async (_db: unknown, fn: TxFn) => {
      await realRun(fn);
      await skipMark(incomeId);
      return realRun(fn);
    });
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [KEY], recordedTotal: 8000 });
  });

  it('سؤال السيرفر: كتابتنا وصلت و"ما نزلش" قلب العلامة قبل السؤال ← recorded مش skipped', async () => {
    const { incomeId } = await makeIncome();
    runMock.mockImplementationOnce(async (_db: unknown, fn: TxFn) => {
      await realRun(fn);
      await skipMark(incomeId);
      throw unavailable();
    });
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: KEY, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [KEY], recordedTotal: 8000 });
    expect((await serverTxs()).filter(t => t.incomeId === incomeId)).toHaveLength(1);
  });
});

describe('من غير حساب مفتوح', () => {
  it('recordIncomePeriods/deleteSubscription/deleteDebt/skipSubscriptionCharge مبيرجّعوش done ساكت', async () => {
    await harness.unmount();
    setMockUid('');
    harness = await renderDataProvider();
    expect((await harness.api().recordIncomePeriods('x', [{ key: KEY, amount: 8000 }])).outcome).toBe('failed');
    expect((await harness.api().deleteSubscription('x')).outcome).toBe('blocked');
    expect((await harness.api().deleteDebt('x')).outcome).toBe('blocked');
    expect(await harness.api().skipSubscriptionCharge('x', KEY)).toBe('no-account');
  });
});
