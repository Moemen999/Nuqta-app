import { collection, doc, getDocFromServer, getDocsFromServer, runTransaction, updateDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { clearFirestore, settle, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { increaseAsBefore } from '@/test-utils/increaseAsBefore';

/**
 * `runTransaction` و`getDocFromServer` ملفوفين عشان نمثّل اللي بيحصل في الحقيقة:
 * فايرستور بتعيد الـcallback لما الرد يضيع (`unavailable`/`deadline-exceeded`) — والـcommit
 * اللي قبله ممكن يكون وصل. اللفة التانية بتشوف الدين **بعد** الكتابة الأولى.
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
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

type TxFn = (t: unknown) => Promise<unknown>;
const actualFs = jest.requireActual('firebase/firestore');
const realRun = (fn: TxFn) => actualFs.runTransaction(db, fn);
const runMock = runTransaction as unknown as jest.Mock;
const serverGetMock = getDocFromServer as unknown as jest.Mock;
const unavailable = () => Object.assign(new Error('unavailable'), { code: 'unavailable' });

/** الـcommit الأول وصل والرد ضاع ← فايرستور بتشغّل الـcallback تاني في ذرة جديدة */
const landThenRetry = () => runMock.mockImplementationOnce(async (_db: unknown, fn: TxFn) => {
  await realRun(fn);
  return realRun(fn);
});
/** الـcommit وصل والنتيجة النهائية `unavailable` */
const landThenFail = () => runMock.mockImplementationOnce(async (_db: unknown, fn: TxFn) => {
  await realRun(fn);
  throw unavailable();
});
/** مفيش حاجة وصلت، والنتيجة `unavailable` */
const failWithoutLanding = () => runMock.mockImplementationOnce(async () => { throw unavailable(); });

let harness: Awaited<ReturnType<typeof renderDataProvider>>;

beforeEach(async () => {
  runMock.mockClear();
  serverGetMock.mockClear();
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForReady();
});

afterEach(async () => {
  await harness.unmount();
});

const debt = () => harness.api().debts[0];

async function serverDebt(id: string) {
  return (await actualFs.getDocFromServer(doc(db, 'users', getMockUid(), 'debts', id))).data() as {
    payments: { id: string; transactionId?: string; advancedFrom?: string; advancedTo?: string }[];
    increases: { id: string; transactionId?: string }[];
    dueDate?: string;
  };
}

async function serverTxCount() {
  return (await getDocsFromServer(collection(db, 'users', getMockUid(), 'transactions'))).size;
}

async function makeDebt(extra: Record<string, unknown> = {}) {
  const w = harness.api().wallets[0];
  const r = await harness.api().addDebt({
    direction: 'i_owe', personName: 'صاحبي', totalAmount: 3000, isInstallment: true, installmentCount: 3,
    walletId: w.id, date: '2026-01-01', ...extra,
  });
  expect(r?.outcome ?? 'done').toBe('done');
  await harness.waitForData(api => api.debts.length === 1 && api.transactions.length === 1);
  return { id: debt().id, w };
}

describe('بند 1: الذرة اتعادت بعد ما الكتابة الأولى وصلت', () => {
  it('الدفعة متتسجلش مرتين', async () => {
    const { id, w } = await makeDebt();
    landThenRetry();
    const res = await harness.api().addDebtPayment(id, 1000, w.id, '2026-02-01');
    expect(res.outcome).toBe('done');
    const stored = await serverDebt(id);
    expect(stored.payments).toHaveLength(1);
    // الأصل + الدفعة بس
    expect(await serverTxCount()).toBe(2);
  });

  it('الزيادة بمحفظة متتسجلش مرتين', async () => {
    const { id, w } = await makeDebt();
    landThenRetry();
    const res = (await increaseAsBefore(harness.api(), id, 500, '2026-02-01', w.id)) as { outcome: string };
    expect(res.outcome).toBe('done');
    expect((await serverDebt(id)).increases).toHaveLength(1);
    expect(await serverTxCount()).toBe(2);
  });

  it('الزيادة من غير محفظة (على الورق) متتسجلش مرتين', async () => {
    const { id } = await makeDebt();
    landThenRetry();
    const res = (await increaseAsBefore(harness.api(), id, 500, '2026-02-01')) as { outcome: string };
    expect(res.outcome).toBe('done');
    expect((await serverDebt(id)).increases).toHaveLength(1);
  });

  it('الكتابة وصلت والنتيجة unavailable ← بنسأل السيرفر ونقول "اتسجلت"', async () => {
    const { id, w } = await makeDebt();
    landThenFail();
    const res = await harness.api().addDebtPayment(id, 1000, w.id, '2026-02-01');
    expect(res.outcome).toBe('done');
    expect((await serverDebt(id)).payments).toHaveLength(1);
  });

  it('الزيادة وصلت والنتيجة unavailable ← "اتسجلت"', async () => {
    const { id, w } = await makeDebt();
    landThenFail();
    const res = (await increaseAsBefore(harness.api(), id, 500, '2026-02-01', w.id)) as { outcome: string };
    expect(res.outcome).toBe('done');
  });

  it('مفيش حاجة وصلت والسيرفر أكّد ← failed (مفيش حاجة اتسجلت)', async () => {
    const { id, w } = await makeDebt();
    failWithoutLanding();
    const res = await harness.api().addDebtPayment(id, 1000, w.id, '2026-02-01');
    expect(res.outcome).toBe('failed');
    expect((await serverDebt(id)).payments).toHaveLength(0);
  });

  it('مفيش رد وكمان سؤال السيرفر فشل ← uncertain (مش "مفيش حاجة اتسجلت")', async () => {
    const { id, w } = await makeDebt();
    failWithoutLanding();
    serverGetMock.mockImplementationOnce(async () => { throw unavailable(); });
    const res = await harness.api().addDebtPayment(id, 1000, w.id, '2026-02-01');
    expect(res.outcome).toBe('uncertain');
  });

  it('الزيادة: مفيش رد وسؤال السيرفر فشل ← uncertain', async () => {
    const { id, w } = await makeDebt();
    failWithoutLanding();
    serverGetMock.mockImplementationOnce(async () => { throw unavailable(); });
    const res = (await increaseAsBefore(harness.api(), id, 500, '2026-02-01', w.id)) as { outcome: string };
    expect(res.outcome).toBe('uncertain');
  });
});

describe('بند 5: الدين اتمسح ← gone مش failed', () => {
  it('دفعة وزيادة ومسح دفعة على دين اتمسح', async () => {
    const { id, w } = await makeDebt();
    expect((await harness.api().addDebtPayment(id, 1000, w.id, '2026-02-01')).outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0]?.payments || []).length === 1);
    const paymentId = debt().payments[0].id;
    expect(await harness.api().deleteDebt(id)).toEqual({ outcome: 'done' });
    await harness.waitForData(api => api.debts.length === 0);
    expect((await harness.api().addDebtPayment(id, 1000, w.id, '2026-02-01')).outcome).toBe('gone');
    expect(((await harness.api().addDebtIncrease(id, 500, '2026-02-01', w.id)) as { outcome: string }).outcome).toBe('gone');
    expect(await harness.api().deleteDebtPayment(id, paymentId)).toBe('gone');
  });
});

describe('بند 2: الدين الجديد وعمليته في كتابة واحدة', () => {
  it('الدين اترفض من القواعد ← العملية الافتتاحية كمان ما اتكتبتش (مفيش عملية يتيمة)', async () => {
    const w = harness.api().wallets[0];
    // اسم أطول من 500 ← القواعد بترفض الدين؛ ملاحظة العملية (5000) بتعدّي لوحدها
    await harness.api().addDebt({
      direction: 'owed_to_me', personName: 'ا'.repeat(600), totalAmount: 1000, isInstallment: false,
      walletId: w.id, date: '2026-01-01',
    });
    await settle(2500);
    expect(await serverTxCount()).toBe(0);
  });

  it('الدين بيتربط بعمليته', async () => {
    const { id } = await makeDebt();
    const stored = (await actualFs.getDocFromServer(doc(db, 'users', getMockUid(), 'debts', id))).data();
    const txs = await getDocsFromServer(collection(db, 'users', getMockUid(), 'transactions'));
    expect(stored.initialTransactionId).toBe(txs.docs[0].id);
  });

  it('المحفظة مؤرشفة ← رفض صريح ومفيش حاجة اتكتبت', async () => {
    const w = harness.api().wallets[0];
    await updateDoc(doc(db, 'users', getMockUid(), 'wallets', w.id), { archived: true, archivedAt: new Date().toISOString() });
    await harness.waitForData(api => api.wallets.find(x => x.id === w.id)?.archived === true);
    const r = await harness.api().addDebt({
      direction: 'owed_to_me', personName: 'صاحبي', totalAmount: 1000, isInstallment: false, walletId: w.id, date: '2026-01-01',
    });
    expect(r.outcome).toBe('wallet-missing');
    await settle(800);
    expect(harness.api().debts).toHaveLength(0);
    expect(await serverTxCount()).toBe(0);
  });
});

describe('بند 3: مسح الدفعة بيرجّع المعاد اللي هي قدّمته', () => {
  async function paidOnce() {
    const made = await makeDebt({ dueDate: '2026-01-15', reminderDaysBefore: 1 });
    expect((await harness.api().addDebtPayment(made.id, 1000, made.w.id, '2026-02-01')).outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    expect(debt().dueDate).toBe('2026-02-15');
    const p = (await serverDebt(made.id)).payments[0];
    expect([p.advancedFrom, p.advancedTo]).toEqual(['2026-01-15', '2026-02-15']);
    return made;
  }

  it('من شاشة الدين', async () => {
    const { id } = await paidOnce();
    expect(await harness.api().deleteDebtPayment(id, debt().payments[0].id)).toBe('done');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 0);
    expect((await serverDebt(id)).dueDate).toBe('2026-01-15');
  });

  it('بمسح العملية (الأرشيف)', async () => {
    const { id } = await paidOnce();
    await harness.api().deleteTransaction(debt().payments[0].transactionId!);
    await harness.waitForData(api => (api.debts[0].payments || []).length === 0);
    await settle(800);
    expect((await serverDebt(id)).dueDate).toBe('2026-01-15');
  });

  it('المعاد اتغيّر بإيد المستخدم بعدها ← المسح مبيلمسوش', async () => {
    const { id } = await paidOnce();
    await harness.api().updateDebt(id, { dueDate: '2030-06-01' });
    await harness.waitForData(api => api.debts[0].dueDate === '2030-06-01');
    expect(await harness.api().deleteDebtPayment(id, debt().payments[0].id)).toBe('done');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 0);
    expect((await serverDebt(id)).dueDate).toBe('2030-06-01');
  });
});

describe('بند 6: تعديل عملية مربوطة اتعاد بعد ما وصل', () => {
  it('اللفة التانية بتلاقي التعديل متطبّق ← done مش gone', async () => {
    const { id, w } = await makeDebt();
    expect((await harness.api().addDebtPayment(id, 1000, w.id, '2026-02-01')).outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    const txId = debt().payments[0].transactionId!;
    await harness.waitForData(api => api.transactions.some(t => t.id === txId));
    const tx = harness.api().transactions.find(t => t.id === txId)!;
    landThenRetry();
    const res = await harness.api().updateDebtLinkedTransaction(
      txId, { amount: 800, walletId: tx.walletId, date: tx.date }, { amount: tx.amount, walletId: tx.walletId, type: tx.type },
    );
    expect(res.outcome).toBe('done');
    expect((await serverDebt(id)).payments).toHaveLength(1);
  });
});

/** الجولة 2 (بند 3): التعديل اترفض من غير رد ← بنسأل السيرفر (العملية + سطر الدين) قبل "ما اتحفظش" */
describe('تعديل عملية مربوطة: الذرة رفضت ← سؤال السيرفر', () => {
  async function paymentTx() {
    const { id, w } = await makeDebt();
    expect((await harness.api().addDebtPayment(id, 1000, w.id, '2026-02-01')).outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    const txId = debt().payments[0].transactionId!;
    await harness.waitForData(api => api.transactions.some(t => t.id === txId));
    const tx = harness.api().transactions.find(t => t.id === txId)!;
    return { id, txId, tx };
  }
  const edit = (txId: string, tx: { amount: number; walletId: string; date: string; type: 'expense' | 'income' | 'withdraw' }) =>
    harness.api().updateDebtLinkedTransaction(
      txId, { amount: 800, walletId: tx.walletId, date: tx.date }, { amount: tx.amount, walletId: tx.walletId, type: tx.type },
    );

  it('الكتابة وصلت والنتيجة unavailable ← done', async () => {
    const { id, txId, tx } = await paymentTx();
    landThenFail();
    expect((await edit(txId, tx)).outcome).toBe('done');
    expect((await serverDebt(id)).payments[0]).toMatchObject({ amount: 800 });
  });

  it('مفيش حاجة وصلت والسيرفر أكّد ← failed', async () => {
    const { id, txId, tx } = await paymentTx();
    failWithoutLanding();
    expect((await edit(txId, tx)).outcome).toBe('failed');
    expect((await serverDebt(id)).payments[0]).toMatchObject({ amount: 1000 });
  });

  it('مفيش رد وسؤال السيرفر فشل ← uncertain', async () => {
    const { txId, tx } = await paymentTx();
    failWithoutLanding();
    serverGetMock.mockImplementation(async () => { throw unavailable(); });
    try {
      expect((await edit(txId, tx)).outcome).toBe('uncertain');
    } finally {
      serverGetMock.mockImplementation((...args: unknown[]) => (actualFs.getDocFromServer as (...a: unknown[]) => unknown)(...args));
    }
  });
});

/** الجولة 2 (بند 4): الكتابة وصلت ← مفيش سطر "عملية ذرية فشلت" (ولا Sentry) لحاجة نجحت */
describe('noteAtomicFailure بعد سؤال السيرفر', () => {
  it('الدفعة والزيادة وصلوا والنتيجة unavailable ← مفيش تسجيل فشل', async () => {
    const { id, w } = await makeDebt();
    const warn = jest.spyOn(console, 'warn');
    try {
      landThenFail();
      expect((await harness.api().addDebtPayment(id, 1000, w.id, '2026-02-01')).outcome).toBe('done');
      landThenFail();
      expect(((await increaseAsBefore(harness.api(), id, 500, '2026-02-01', w.id)) as { outcome: string }).outcome).toBe('done');
      expect(warn.mock.calls.filter(c => c[0] === 'عملية ذرية فشلت')).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('مفيش حاجة وصلت ← الفشل بيتسجّل', async () => {
    const { id, w } = await makeDebt();
    const warn = jest.spyOn(console, 'warn');
    try {
      failWithoutLanding();
      expect((await harness.api().addDebtPayment(id, 1000, w.id, '2026-02-01')).outcome).toBe('failed');
      expect(warn.mock.calls.filter(c => c[0] === 'عملية ذرية فشلت')).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * الجولة 2 (بند 1): مسح عملية دفعة/زيادة من الأرشيف كان batch بـ`arrayRemove` للسطر **زي ما الرياكت شايفه** — لو اتعدّل من جهاز
 * تاني ولسه ما وصلناش، العملية بتتمسح والسطر يفضل (المدفوع والباقي غلط). دلوقتي ذرة بتقرا الدين من السيرفر.
 * `staleDelete` = الدالة من render قبل التعديل التاني (بالظبط اللي التأكيد المفتوح بيناديه).
 */
describe('مسح عملية الدين من الأرشيف ← من نسخة السيرفر', () => {
  async function paidOnce() {
    const made = await makeDebt({ dueDate: '2026-01-15', reminderDaysBefore: 1 });
    expect((await harness.api().addDebtPayment(made.id, 1000, made.w.id, '2026-02-01')).outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    const txId = debt().payments[0].transactionId!;
    await harness.waitForData(api => api.transactions.some(t => t.id === txId));
    return { ...made, txId };
  }

  it('السطر اتعدّل من جهاز تاني ولسه ما وصلناش ← بيتشال برضه، والمعاد يرجع', async () => {
    const { id, txId } = await paidOnce();
    const staleDelete = harness.api().deleteTransaction;
    const ref = doc(db, 'users', getMockUid(), 'debts', id);
    const stored = (await actualFs.getDocFromServer(ref)).data();
    await updateDoc(ref, { payments: stored.payments.map((p: Record<string, unknown>) => ({ ...p, date: '2026-02-03' })) });
    const res = await staleDelete(txId);
    expect(res.outcome).toBe('done');
    const after = await serverDebt(id);
    expect(after.payments).toHaveLength(0);
    expect(after.dueDate).toBe('2026-01-15');
    expect((await actualFs.getDocFromServer(doc(db, 'users', getMockUid(), 'transactions', txId))).exists()).toBe(false);
  });

  it('التأكيد وعد إن المعاد يرجع والسيرفر اتغيّر ← dueNotRestored', async () => {
    const { id, txId } = await paidOnce();
    const staleDelete = harness.api().deleteTransaction;
    await updateDoc(doc(db, 'users', getMockUid(), 'debts', id), { dueDate: '2030-06-01' });
    const res = await staleDelete(txId);
    expect(res).toMatchObject({ outcome: 'done', dueNotRestored: 'payment' });
    expect((await serverDebt(id)).dueDate).toBe('2030-06-01');
  });

  it('المعاد رجع زي ما اتوعد ← مفيش dueNotRestored', async () => {
    const { txId } = await paidOnce();
    const res = await harness.api().deleteTransaction(txId);
    expect(res).toEqual({ outcome: 'done' });
  });

  it('الكتابة وصلت والنتيجة unavailable ← done', async () => {
    const { id, txId } = await paidOnce();
    landThenFail();
    expect((await harness.api().deleteTransaction(txId)).outcome).toBe('done');
    expect((await serverDebt(id)).payments).toHaveLength(0);
  });

  it('مفيش حاجة وصلت والسيرفر أكّد ← failed، والدفعة وعمليتها زي ما هما', async () => {
    const { id, txId } = await paidOnce();
    failWithoutLanding();
    expect((await harness.api().deleteTransaction(txId)).outcome).toBe('failed');
    expect((await serverDebt(id)).payments).toHaveLength(1);
    expect((await actualFs.getDocFromServer(doc(db, 'users', getMockUid(), 'transactions', txId))).exists()).toBe(true);
  });

  it('مفيش رد وسؤال السيرفر فشل ← uncertain', async () => {
    const { txId } = await paidOnce();
    failWithoutLanding();
    serverGetMock.mockImplementation(async () => { throw unavailable(); });
    try {
      expect((await harness.api().deleteTransaction(txId)).outcome).toBe('uncertain');
    } finally {
      serverGetMock.mockImplementation((...args: unknown[]) => (actualFs.getDocFromServer as (...a: unknown[]) => unknown)(...args));
    }
  });
});

/** الجولة 2 (بند 2): مسح الدفعة من شاشة الدين بيقول المعاد رجع ولا لأ — زي الزيادة */
describe('deleteDebtPayment ← out.dueRestored', () => {
  async function paidOnce() {
    const made = await makeDebt({ dueDate: '2026-01-15', reminderDaysBefore: 1 });
    expect((await harness.api().addDebtPayment(made.id, 1000, made.w.id, '2026-02-01')).outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    return made;
  }

  it('رجع', async () => {
    const { id } = await paidOnce();
    const out: { dueRestored?: string | null; entryGone?: boolean } = {};
    expect(await harness.api().deleteDebtPayment(id, debt().payments[0].id, out)).toBe('done');
    expect(out).toEqual({ dueRestored: '2026-01-15', entryGone: false });
  });

  it('المعاد اتغيّر ← null', async () => {
    const { id } = await paidOnce();
    const pid = debt().payments[0].id;
    await updateDoc(doc(db, 'users', getMockUid(), 'debts', id), { dueDate: '2030-06-01' });
    const out: { dueRestored?: string | null; entryGone?: boolean } = {};
    expect(await harness.api().deleteDebtPayment(id, pid, out)).toBe('done');
    expect(out.dueRestored).toBeNull();
  });
});
