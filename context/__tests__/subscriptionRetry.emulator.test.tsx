import { arrayRemove, collection, deleteField, doc, getDocFromServer, getDocsFromServer, runTransaction, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { gamiyaTxId, subscriptionTxId } from '@/lib/autoCharge';
import { addDays, addMonths, todayStr } from '@/lib/finance';
import { clearFirestore, signInTestUser, writeRawDoc } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

/**
 * مراجعة الاشتراكات (التطبيق كله، 2026-11-17) — نفس نمط `debtRetry`: `runTransaction` و`getDocFromServer`
 * ملفوفين عشان نمثّل الرد اللي بيضيع بعد ما الـcommit وصل.
 *
 * A: كل المحاولات فشلت بعد commit ممكن يكون وصل ← كان بيقول "مفيش أي خصم اتسجل" والخصم موجود.
 * B: الإعادة بعد commit وصل ← الفترة مقفولة فكان `recorded=[]` (التلقائي ساكت، الكارت "من جهاز تاني").
 * D: تعديل المعاد على "تلقائي" بيفتح مفتاح جديد ← خصم مرتين.
 * E/F/G: الاشتراك اتمسح / الفترة اتسجلت / اتوقف ← نتيجة صريحة مش "تم" ولا "اتسجلت قبل كده".
 * H: مسح الاشتراك بيمسح كل عملياته (مش history بس)، ومبيعدّيش وخصم شغال.
 */
jest.mock('firebase/firestore', () => {
  const actual = jest.requireActual('firebase/firestore');
  return {
    ...actual,
    runTransaction: jest.fn((...args: unknown[]) => (actual.runTransaction as (...a: unknown[]) => unknown)(...args)),
    getDocFromServer: jest.fn((...args: unknown[]) => (actual.getDocFromServer as (...a: unknown[]) => unknown)(...args)),
    arrayRemove: jest.fn((...args: unknown[]) => (actual.arrayRemove as (...a: unknown[]) => unknown)(...args)),
  };
});

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

type TxFn = (t: unknown) => Promise<unknown>;
const actualFs = jest.requireActual('firebase/firestore');
const realRun = (fn: TxFn) => actualFs.runTransaction(db, fn);
const runMock = runTransaction as unknown as jest.Mock;
const serverGetMock = getDocFromServer as unknown as jest.Mock;
const arrayRemoveMock = arrayRemove as unknown as jest.Mock;
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
/** سؤال السيرفر بعد الفشل كمان فشل */
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
const sub = () => harness.api().subscriptions[0];

/**
 * العمليات على السيرفر. `getDocsFromServer` على المجموعة رجّع فاضي مرة والمستند موجود (المحاكي + listener شغال على
 * نفس المجموعة) — فبنقرا لحد ما قرايتين ورا بعض يتفقوا، وبعدين بنقارن بالـlistener كمان.
 */
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
async function serverSub(id: string) {
  return (await actualFs.getDocFromServer(userDoc('subscriptions', id))).data() as Record<string, any>;
}

async function makeSub(over: { nextDueDate?: string; chargeMode?: 'auto' | 'confirm'; autoSince?: string; amount?: number; frequency?: 'monthly' | 'yearly' } = {}) {
  const w = harness.api().wallets[0];
  await harness.api().addSubscription({
    name: 'نتفليكس', amount: over.amount ?? 200, walletId: w.id, frequency: over.frequency ?? 'monthly',
    nextDueDate: over.nextDueDate ?? today, reminderDaysBefore: 3, chargeMode: over.chargeMode,
  });
  await harness.waitForData(api => api.subscriptions.length === 1);
  const id = sub().id;
  if (over.autoSince) await updateDoc(userDoc('subscriptions', id), { chargeAutoSince: over.autoSince });
  await harness.waitForData(api => api.pendingWrites === 0
    && (!over.autoSince || api.subscriptions[0].chargeAutoSince === over.autoSince));
  return { walletId: w.id, id };
}

describe('A: كل المحاولات فشلت — بنسأل السيرفر قبل "مفيش أي خصم اتسجل"', () => {
  it('"سدّد": الكتابة وصلت والنتيجة unavailable ← done وعملية واحدة', async () => {
    const { id } = await makeSub();
    landThenFail();
    expect(await harness.api().markSubscriptionPaid(id, today, 200)).toBe('done');
    expect((await serverTxs()).filter(t => t.subscriptionId === id)).toHaveLength(1);
  });

  it('"سدّد": مفيش حاجة وصلت والسيرفر أكّد ← failed', async () => {
    const { id } = await makeSub();
    failWithoutLanding();
    expect(await harness.api().markSubscriptionPaid(id, today, 200)).toBe('failed');
    expect(await serverTxs()).toHaveLength(0);
  });

  it('"سدّد": مفيش رد وسؤال السيرفر فشل ← uncertain', async () => {
    const { id } = await makeSub();
    failWithoutLanding();
    serverCheckFails();
    expect(await harness.api().markSubscriptionPaid(id, today, 200)).toBe('uncertain');
  });

  it('الكارت: وصلت والنتيجة unavailable ← done ومعاه الفترة', async () => {
    const { id } = await makeSub();
    landThenFail();
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    expect(r.outcome).toBe('done');
    expect(r.recorded).toEqual([today]);
  });

  it('التلقائي: وصلت والنتيجة unavailable ← done ومعاه الفترة', async () => {
    const { id } = await makeSub({ chargeMode: 'auto', autoSince: today });
    landThenFail();
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true });
    expect(r).toMatchObject({ outcome: 'done', recorded: [today] });
  });

  it('الكارت: مفيش رد وسؤال السيرفر فشل ← uncertain', async () => {
    const { id } = await makeSub();
    failWithoutLanding();
    serverCheckFails();
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    expect(r.outcome).toBe('uncertain');
  });

  it('الكارت: مفيش حاجة وصلت والسيرفر أكّد ← failed', async () => {
    const { id } = await makeSub();
    failWithoutLanding();
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    expect(r.outcome).toBe('failed');
  });
});

describe('B: الذرة اتعادت بعد ما الأولى وصلت', () => {
  it('"سدّد" ← done (مش "اتسجل النهاردة خلاص")، وعملية واحدة', async () => {
    const { id } = await makeSub();
    landThenRetry();
    expect(await harness.api().markSubscriptionPaid(id, today, 200)).toBe('done');
    expect((await serverTxs()).filter(t => t.subscriptionId === id)).toHaveLength(1);
    expect((await serverSub(id)).history).toHaveLength(1);
  });

  it('الكارت ← recorded فيه الفترة (مش "من جهاز تاني")', async () => {
    const { id } = await makeSub();
    landThenRetry();
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    expect(r).toMatchObject({ outcome: 'done', recorded: [today] });
    expect(await serverTxs()).toHaveLength(1);
  });

  it('التلقائي ← recorded فيه الفترة (الرسالة "سجلنا لوحدنا" مبتضيعش)', async () => {
    const { id } = await makeSub({ chargeMode: 'auto', autoSince: today });
    landThenRetry();
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true });
    expect(r).toMatchObject({ outcome: 'done', recorded: [today] });
  });

  it('الجمعية ← recorded فيه الشهر', async () => {
    const w = harness.api().wallets[0];
    await harness.api().addGamiya({
      name: 'العيلة', monthlyAmount: 1000, totalMonths: 3, payoutMonthIndex: 3, payoutAmount: 3000,
      walletId: w.id, startDate: today, reminderDaysBefore: 3,
    });
    await harness.waitForData(api => api.gamiyas.length === 1 && api.pendingWrites === 0);
    const g = harness.api().gamiyas[0];
    const m = g.months.find(x => x.dueDate === today)!;
    landThenRetry();
    const r = await harness.api().recordCharges('gamiya', g.id, [{ key: m.id, amount: 1000 }]);
    expect(r).toMatchObject({ outcome: 'done', recorded: [m.id] });
    expect((await serverTxs()).filter(t => t.id === gamiyaTxId(g.id, m.id))).toHaveLength(1);
  });

  it('"ما اتخصمش" ← done', async () => {
    const { id } = await makeSub();
    landThenRetry();
    expect(await harness.api().skipSubscriptionCharge(id, today)).toBe('done');
  });
});

describe('E/F/G: نتايج صريحة', () => {
  it('الاشتراك اتمسح ← missing في "سدّد" والكارت و"ما اتخصمش"', async () => {
    const { id } = await makeSub();
    expect(await harness.api().deleteSubscription(id)).toEqual({ outcome: 'done' });
    await harness.waitForData(api => api.subscriptions.length === 0 && api.pendingWrites === 0);
    expect(await harness.api().markSubscriptionPaid(id, today, 200)).toBe('missing');
    expect((await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }])).outcome).toBe('missing');
    expect(await harness.api().skipSubscriptionCharge(id, today)).toBe('missing');
  });

  it('"ما اتخصمش" على فترة اتسجلت ← already-recorded (مش "مش هنسجل خصم")', async () => {
    const { id } = await makeSub();
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    expect(await harness.api().skipSubscriptionCharge(id, today)).toBe('already-recorded');
  });

  it('"ما اتخصمش" على اشتراك اتوقف ← stopped', async () => {
    const { id } = await makeSub();
    await harness.api().setSubscriptionActive(id, false);
    await harness.waitForData(api => api.subscriptions[0].active === false && api.pendingWrites === 0);
    expect(await harness.api().skipSubscriptionCharge(id, today)).toBe('stopped');
  });

  it('الكارت على فترة اتفوّتت من جهاز تاني ← skipped (مش "اتسجلت قبل كده")', async () => {
    const { id } = await makeSub();
    expect(await harness.api().skipSubscriptionCharge(id, today)).toBe('done');
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    expect(r).toMatchObject({ outcome: 'done', recorded: [], skipped: true });
  });

  it('الكارت على فترة اتسجلت فعلاً ← recorded=[] من غير skipped ولا changed', async () => {
    const { id } = await makeSub();
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [] });
  });
});

describe('C: اليوم الأصلي', () => {
  it('الإضافة بتخزّن anchorDay', async () => {
    const { id } = await makeSub({ nextDueDate: addDays(today, 3) });
    expect((await serverSub(id)).anchorDay).toBe(Number(addDays(today, 3).slice(8, 10)));
  });

  it('اشتراك قديم من غير anchorDay معاده 31 يناير ← 28 فبراير ← 31 مارس، وanchorDay اتثبّت', async () => {
    const { id } = await makeSub({ nextDueDate: '2026-01-31' });
    await updateDoc(userDoc('subscriptions', id), { anchorDay: deleteField() });
    await harness.waitForData(api => api.subscriptions[0].anchorDay === undefined && api.pendingWrites === 0);
    expect(await harness.api().markSubscriptionPaid(id, today, 200)).toBe('done');
    let s = await serverSub(id);
    expect(s.nextDueDate).toBe('2026-02-28');
    expect(s.anchorDay).toBe(31);
    await harness.waitForData(api => api.subscriptions[0].nextDueDate === '2026-02-28');
    expect(await harness.api().skipSubscriptionCharge(id, '2026-02-28')).toBe('done');
    s = await serverSub(id);
    expect(s.nextDueDate).toBe('2026-03-31');
  });

  it('تعديل المعاد بيحدّث anchorDay', async () => {
    const { id } = await makeSub({ nextDueDate: addDays(today, 3) });
    const next = addMonths(today, 1).slice(0, 8) + '30';
    const r = await harness.api().updateSubscription(id, { nextDueDate: next });
    expect(r.outcome).toBe('done');
    await harness.waitForData(api => api.pendingWrites === 0);
    expect((await serverSub(id)).anchorDay).toBe(30);
  });
});

describe('D: تعديل المعاد على "تلقائي"', () => {
  it('المعاد اتنقل لورا ← chargeAutoSince = النهاردة، فالفترات القديمة بتسأل مش بتتخصم لوحدها', async () => {
    const past = addDays(today, -60);
    const { id } = await makeSub({ chargeMode: 'auto', autoSince: past, nextDueDate: addDays(today, 5) });
    const moved = addDays(today, -10);
    expect((await harness.api().updateSubscription(id, { nextDueDate: moved })).outcome).toBe('done');
    await harness.waitForData(api => api.subscriptions[0].nextDueDate === moved && api.pendingWrites === 0);
    expect(sub().chargeAutoSince).toBe(today);
    const r = await harness.api().recordCharges('subscription', id, [{ key: moved, amount: 200 }], { auto: true });
    expect(r.recorded).toEqual([]);
    expect(await serverTxs()).toHaveLength(0);
  });

  it('تعديل من غير ما المعاد يتغيّر ← chargeAutoSince زي ما هو', async () => {
    const past = addDays(today, -60);
    const { id } = await makeSub({ chargeMode: 'auto', autoSince: past, nextDueDate: addDays(today, 5) });
    await harness.api().updateSubscription(id, { name: 'نتفليكس 2', nextDueDate: addDays(today, 5) });
    await harness.waitForData(api => api.subscriptions[0].name === 'نتفليكس 2' && api.pendingWrites === 0);
    expect(sub().chargeAutoSince).toBe(past);
  });

  it('معاد جوه فترة اتقفلت ← بيترفض ومفيش كتابة', async () => {
    const { id } = await makeSub();
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    await harness.waitForData(api => api.subscriptions[0].nextDueDate === addMonths(today, 1));
    const r = await harness.api().updateSubscription(id, { nextDueDate: addDays(today, 1) });
    expect(r).toMatchObject({ outcome: 'invalid', field: 'nextDueDate' });
    expect((await serverSub(id)).nextDueDate).toBe(addMonths(today, 1));
    // بعد آخر فترة اتقفلت ← مقبول
    expect((await harness.api().updateSubscription(id, { nextDueDate: addDays(addMonths(today, 1), 2) })).outcome).toBe('done');
  });
});

describe('المبالغ في recordCharges', () => {
  it('مبلغ الكارت بيتقرّب للقرش', async () => {
    const { id } = await makeSub();
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 100.456 }]);
    expect((await serverTx(subscriptionTxId(id, today)))?.amount).toBe(100.46);
    expect((await serverSub(id)).history[0].amount).toBe(100.46);
  });

  it('التلقائي بياخد المبلغ من السيرفر مش اللي اتبعت', async () => {
    const { id } = await makeSub({ chargeMode: 'auto', autoSince: today });
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 999 }], { auto: true });
    expect(r).toMatchObject({ outcome: 'done', recorded: [today] });
    expect((await serverTx(subscriptionTxId(id, today)))?.amount).toBe(200);
  });

  it('العملية موجودة بمبلغ تاني ← سطر history بنفس مبلغها', async () => {
    const { id, walletId } = await makeSub();
    await setDoc(userDoc('transactions', subscriptionTxId(id, today)), {
      type: 'expense', amount: 120, walletId, date: today, subscriptionId: id, periodKey: today, createdAt: new Date().toISOString(),
    });
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    expect((await serverSub(id)).history[0].amount).toBe(120);
  });
});

describe('مسح عملية الاشتراك بيرجّع فترتها تسأل حتى لو history عندنا ناقص', () => {
  it('stageReconcile بيقرا subscriptionId+periodKey من العملية نفسها', async () => {
    const { id } = await makeSub();
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    await updateDoc(userDoc('subscriptions', id), { history: [] });
    await harness.waitForData(api => api.subscriptions[0].history.length === 0 && api.transactions.length === 1);
    await harness.api().deleteTransaction(subscriptionTxId(id, today));
    await harness.waitForData(api => api.transactions.length === 0 && api.pendingWrites === 0);
    expect((await serverSub(id)).closed[today].reopened).toBe(true);
  });
});

describe('H: مسح الاشتراك', () => {
  it('بيمسح العمليات اللي في closed واللي عليها subscriptionId حتى لو مش في history', async () => {
    const { id, walletId } = await makeSub();
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    await updateDoc(userDoc('subscriptions', id), { history: [] });
    await setDoc(userDoc('transactions', 'stray'), {
      type: 'expense', amount: 50, walletId, date: today, subscriptionId: id, createdAt: new Date().toISOString(),
    });
    await harness.waitForData(api => api.subscriptions[0].history.length === 0 && api.transactions.length === 2);
    expect(await harness.api().deleteSubscription(id)).toEqual({ outcome: 'done' });
    await harness.waitForData(api => api.pendingWrites === 0 && api.transactions.length === 0);
    expect(await serverTx(subscriptionTxId(id, today))).toBeUndefined();
    expect(await serverTx('stray')).toBeUndefined();
  });

  it('خصم شغال على نفس الاشتراك ← المسح بيستنى (blocked)', async () => {
    const { id } = await makeSub();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    runMock.mockImplementationOnce(async (_db: unknown, fn: TxFn) => { await gate; return realRun(fn); });
    const paying = harness.api().markSubscriptionPaid(id, today, 200);
    await harness.waitForData(() => runMock.mock.calls.length > 0);
    const r = await harness.api().deleteSubscription(id);
    expect(r.outcome).toBe('blocked');
    release();
    expect(await paying).toBe('done');
    expect(await harness.api().deleteSubscription(id)).toEqual({ outcome: 'done' });
  });
});

/**
 * 9.5-3: المسح بقى ذرة من السيرفر. جهاز تاني سجّل خصم (العملية + `closed` على السيرفر) ولسه ما وصلش الـlistener ←
 * العملية بتتمسح مع الاشتراك بدل ما تفضل يتيمة بتحرّك الرصيد. والرد اللي بيضيع بعد ما المسح وصل ← `done` مش «ما اتمسحش».
 */
describe('9.5-3: مسح الاشتراك ذرة من السيرفر', () => {
  it('خصم من جهاز تاني لسه ما وصلناش ← بيتمسح مع الاشتراك', async () => {
    const { id, walletId } = await makeSub();
    const uid = getMockUid();
    await writeRawDoc(`users/${uid}/transactions/otherDevice`, {
      type: 'expense', amount: 200, walletId, date: today, subscriptionId: id, periodKey: today, createdAt: new Date().toISOString(),
    });
    const onServer = await serverSub(id);
    await writeRawDoc(`users/${uid}/subscriptions/${id}`, { ...onServer, closed: { ...(onServer.closed || {}), [today]: { txId: 'otherDevice', at: 'x' } } });
    // من غير ما نستنى الـlistener: النسخة عندنا لسه ما تعرفش العملية دي
    expect(await harness.api().deleteSubscription(id)).toEqual({ outcome: 'done' });
    expect(await serverTx('otherDevice')).toBeUndefined();
    expect((await actualFs.getDocFromServer(userDoc('subscriptions', id))).exists()).toBe(false);
  });

  it('المسح وصل والرد ضاع ← done', async () => {
    const { id } = await makeSub();
    landThenFail();
    expect(await harness.api().deleteSubscription(id)).toEqual({ outcome: 'done' });
    expect((await actualFs.getDocFromServer(userDoc('subscriptions', id))).exists()).toBe(false);
  });

  it('ما وصلش ← blocked «مفيش نت» والاشتراك لسه موجود', async () => {
    const { id } = await makeSub();
    failWithoutLanding();
    const r = await harness.api().deleteSubscription(id);
    expect(r).toMatchObject({ outcome: 'blocked', reason: 'no-connection' });
    expect((await actualFs.getDocFromServer(userDoc('subscriptions', id))).exists()).toBe(true);
  });

  it('ما وصلش وسؤال السيرفر كمان فشل ← uncertain (مش «اتمسح» ولا «ما اتمسحش»)', async () => {
    const { id } = await makeSub();
    failWithoutLanding();
    serverCheckFails();
    expect(await harness.api().deleteSubscription(id)).toMatchObject({ outcome: 'blocked', reason: 'uncertain' });
    serverGetMock.mockImplementation((...args: unknown[]) => (actualFs.getDocFromServer as (...a: unknown[]) => unknown)(...args));
    expect((await actualFs.getDocFromServer(userDoc('subscriptions', id))).exists()).toBe(true);
  });

});

describe('مبلغ مش صالح من الكارت', () => {
  it('NaN ← badAmount ومفيش كتابة (مش "اتسجلت قبل كده")', async () => {
    const { id } = await makeSub();
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: NaN }]);
    expect(r).toEqual({ outcome: 'done', recorded: [], badAmount: true });
    expect(await serverTx(subscriptionTxId(id, today))).toBeUndefined();
  });
});

/** الجولة التانية (money-reviewer + silent-failure-hunter على f1cc057) */
async function waitUntil(check: () => Promise<boolean>, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

describe('الجولة 2: حدّ المعاد بعد التعديل', () => {
  it('سنوي ← شهري: الحد بيتحسب على التكرار الجديد (كان بيرفض معاد الشهر الجاي)', async () => {
    const { id } = await makeSub({ frequency: 'yearly' });
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    await harness.waitForData(api => api.subscriptions[0].nextDueDate === addMonths(today, 12) && api.pendingWrites === 0);
    // جوه الفترة اللي اتقفلت حتى على الشهري ← لسه مرفوض
    const inside = await harness.api().updateSubscription(id, { frequency: 'monthly', nextDueDate: addDays(today, 1) });
    expect(inside).toMatchObject({ outcome: 'invalid', field: 'nextDueDate' });
    const next = addMonths(today, 1);
    expect((await harness.api().updateSubscription(id, { frequency: 'monthly', nextDueDate: next })).outcome).toBe('done');
    await harness.waitForData(api => api.pendingWrites === 0 && api.subscriptions[0].frequency === 'monthly');
    const s = await serverSub(id);
    expect(s.frequency).toBe('monthly');
    expect(s.nextDueDate).toBe(next);
  });
});

describe('الجولة 2: "سدّد" بمبلغ متخزّن مش مقرّب', () => {
  it('العملية والسطر بالقرش، والدوسة التانية في نفس اليوم ← already-paid-today من غير عملية تانية', async () => {
    const { id } = await makeSub();
    await updateDoc(userDoc('subscriptions', id), { amount: 100.456 });
    await harness.waitForData(api => api.subscriptions[0].amount === 100.456 && api.pendingWrites === 0);
    expect(await harness.api().markSubscriptionPaid(id, today)).toBe('done');
    expect((await serverTx(subscriptionTxId(id, today)))?.amount).toBe(100.46);
    expect((await serverSub(id)).history[0].amount).toBe(100.46);
    await harness.waitForData(api => api.subscriptions[0].history.length === 1 && api.pendingWrites === 0);
    expect(await harness.api().markSubscriptionPaid(id, today)).toBe('already-paid-today');
    expect((await serverTxs()).filter(t => t.subscriptionId === id)).toHaveLength(1);
  });
});

describe('الجولة 2: مسح عملية الاشتراك والسطر عندنا مش زي اللي على السيرفر', () => {
  it('السطر بيتشال من نسخة السيرفر (arrayRemove من الذاكرة ما لقاهوش)', async () => {
    const { id } = await makeSub();
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    await harness.waitForData(api => api.transactions.length === 1 && api.subscriptions[0].history.length === 1 && api.pendingWrites === 0);
    // تمثيل جهاز تاني عدّل السطر ولسه ما وصلناش: arrayRemove بيدوّر على نسخة مش موجودة على السيرفر
    arrayRemoveMock.mockImplementationOnce(() => actualFs.arrayRemove({ id: 'stale-copy' }));
    await harness.api().deleteTransaction(subscriptionTxId(id, today));
    expect(await waitUntil(async () => ((await serverSub(id)).history || []).length === 0)).toBe(true);
    expect((await serverSub(id)).closed[today].reopened).toBe(true);
  });
});

describe('الجولة 2: النتيجة بعد الفشل من نسخة السيرفر', () => {
  it('"ما اتخصمش" فشل والفترة مقفولة على عمليتها ← already-recorded مش failed', async () => {
    const { id } = await makeSub();
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    await harness.waitForData(api => api.pendingWrites === 0);
    failWithoutLanding();
    expect(await harness.api().skipSubscriptionCharge(id, today)).toBe('already-recorded');
  });

  it('الجمعية: الـcommit قفل الشهر على عملية موجودة والرد ضاع ← done وrecorded فاضي (مش failed)', async () => {
    const w = harness.api().wallets[0];
    await harness.api().addGamiya({
      name: 'العيلة', monthlyAmount: 1000, totalMonths: 3, payoutMonthIndex: 3, payoutAmount: 3000,
      walletId: w.id, startDate: today, reminderDaysBefore: 3,
    });
    await harness.waitForData(api => api.gamiyas.length === 1 && api.pendingWrites === 0);
    const g = harness.api().gamiyas[0];
    const m = g.months.find(x => x.dueDate === today)!;
    await setDoc(userDoc('transactions', gamiyaTxId(g.id, m.id)), {
      type: 'expense', amount: 900, walletId: w.id, date: today, gamiyaId: g.id, periodKey: m.id, createdAt: 'earlier',
    });
    await harness.waitForData(api => api.transactions.length === 1);
    landThenFail();
    const r = await harness.api().recordCharges('gamiya', g.id, [{ key: m.id, amount: 1000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [] });
    expect((await serverTx(gamiyaTxId(g.id, m.id)))?.amount).toBe(900);
  });
});
