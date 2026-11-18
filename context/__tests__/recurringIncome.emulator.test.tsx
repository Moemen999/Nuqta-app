import { db } from '@/firebaseConfig';
import { addDays, addMonths, todayStr, walletBalance } from '@/lib/finance';
import { incomeTxId, incomeUpcomingPeriod } from '@/lib/recurringIncome';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { deleteDoc, disableNetwork, doc, enableNetwork, setDoc, updateDoc } from 'firebase/firestore';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * الدخل الثابت على محاكي فايرستور الحقيقي. أهم وعد في البند: **المرتب
 * عمره ما يتسجل مرتين** — لا بنداءين في نفس اللحظة، ولا بعد ما المستخدم
 * يمسح العملية، ولا فوق عملية المستخدم عدّلها.
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;

beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForReady();
});

afterEach(async () => {
  await harness.unmount();
});

const uidPath = () => ['users', getMockUid()] as const;

/**
 * مراجعة الدخل (2026-11-18، M3): الذرة بتسجل بس فترات من الجدول اللي على السيرفر، فالمفاتيح هنا فترات فاتت فعلاً
 * (نسبية للنهارده، يوم 25) والدخل بيبدأ من 6 شهور. قبل كده كانت تواريخ ثابتة (K9) والذرة كانت بتقبل أي مفتاح.
 */
const TODAY = todayStr();
const K7 = addMonths(TODAY, -4).slice(0, 7);
const K8 = addMonths(TODAY, -3).slice(0, 7);
const K9 = addMonths(TODAY, -2).slice(0, 7);

async function makeIncome(over: Record<string, unknown> = {}) {
  const w = harness.api().wallets[0];
  await harness.api().addIncome({
    name: 'المرتب', amount: 8000, walletId: w.id, frequency: 'monthly', dayOfMonth: 25, mode: 'confirm',
    ...over,
  } as any);
  await harness.waitForData(api => api.incomes.length === 1);
  await harness.waitForData(api => api.pendingWrites === 0);
  const incomeId = harness.api().incomes[0].id;
  const startDate = addMonths(TODAY, -6);
  await updateDoc(doc(db, ...uidPath(), 'incomes', incomeId), { startDate });
  await harness.waitForData(api => api.incomes[0].startDate === startDate);
  return { walletId: w.id, incomeId };
}

function balanceOf(walletId: string) {
  const w = harness.api().wallets.find(x => x.id === walletId)!;
  return walletBalance(harness.api().transactions, w.id, w.openingBalance);
}

const incomeTxs = (incomeId: string) => harness.api().transactions.filter(t => (t as any).incomeId === incomeId);

describe('التسجيل', () => {
  it('فترة واحدة ← عملية دخل بالمعرّف الثابت، والفترة بتتقفل، والرصيد بيزيد', async () => {
    const { walletId, incomeId } = await makeIncome();
    const before = balanceOf(walletId);

    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [K9], recordedTotal: 8000 });

    await harness.waitForData(api => api.transactions.some(t => t.id === incomeTxId(incomeId, K9)));
    const tx = harness.api().transactions.find(t => t.id === incomeTxId(incomeId, K9))!;
    expect(tx).toMatchObject({ type: 'income', amount: 8000, walletId });
    expect(harness.api().incomes[0].closed?.[K9]?.txId).toBe(tx.id);
    expect(balanceOf(walletId) - before).toBe(8000);
  });

  it('كذا فترة في نداء واحد (اللحاق) ← كلهم', async () => {
    const { incomeId } = await makeIncome();
    const r = await harness.api().recordIncomePeriods(incomeId, [
      { key: K7, amount: 8000 }, { key: K8, amount: 8000 }, { key: K9, amount: 8000 },
    ]);
    expect(r.recorded).toEqual([K7, K8, K9]);
    await harness.waitForData(() => incomeTxs(incomeId).length === 3);
  });

  it('مبلغ الفترة دي بس مختلف ← الأساس ما اتغيّرش', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 7200 }]);
    await harness.waitForData(() => incomeTxs(incomeId).length === 1);
    expect(incomeTxs(incomeId)[0].amount).toBe(7200);
    expect(harness.api().incomes[0].amount).toBe(8000);
  });
});

describe('ممنوع يتسجل مرتين', () => {
  it('نفس الفترة مرتين ورا بعض ← التانية مبتسجلش حاجة', async () => {
    const { walletId, incomeId } = await makeIncome();
    await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]);
    await harness.waitForData(() => incomeTxs(incomeId).length === 1);
    const after1 = balanceOf(walletId);

    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [], already: true });
    expect(incomeTxs(incomeId)).toHaveLength(1);
    expect(balanceOf(walletId)).toBe(after1);
  });

  it('نداءين في نفس اللحظة (جهازين / فتح التطبيق مرتين) ← عملية واحدة', async () => {
    const { walletId, incomeId } = await makeIncome();
    const before = balanceOf(walletId);
    const [a, b] = await Promise.all([
      harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]),
      harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]),
    ]);
    expect([...a.recorded, ...b.recorded]).toEqual([K9]);
    await harness.waitForData(() => incomeTxs(incomeId).length === 1);
    expect(balanceOf(walletId) - before).toBe(8000);
  });

  it('المستخدم مسح العملية ← مبترجعش تتسجل لوحدها', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]);
    await harness.waitForData(() => incomeTxs(incomeId).length === 1);
    await deleteDoc(doc(db, ...uidPath(), 'transactions', incomeTxId(incomeId, K9)));
    await harness.waitForData(() => incomeTxs(incomeId).length === 0);

    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]);
    expect(r.recorded).toEqual([]);
    expect(incomeTxs(incomeId)).toHaveLength(0);
  });

  it('عملية موجودة بالمعرّف (والعلامة ناقصة) ← بتتقفل من غير ما تتكتب فوق تعديل المستخدم', async () => {
    const { walletId, incomeId } = await makeIncome();
    await setDoc(doc(db, ...uidPath(), 'transactions', incomeTxId(incomeId, K9)), {
      type: 'income', amount: 7777, walletId, date: `${K9}-25`, incomeId, periodKey: K9,
    });
    await harness.waitForData(() => incomeTxs(incomeId).length === 1);

    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]);
    expect(r.recorded).toEqual([]);
    await harness.waitForData(api => !!api.incomes[0].closed?.[K9]);
    expect(incomeTxs(incomeId)[0].amount).toBe(7777);
  });

  it('"مانزلش" بيقفل الفترة، ومفيش تسجيل بعدها', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().skipIncomePeriod(incomeId, K9);
    await harness.waitForData(api => api.incomes[0].closed?.[K9]?.skipped === true);
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]);
    expect(r.recorded).toEqual([]);
  });

  it('"مانزلش" على فترة مبيمسحش علامة فترة تانية اتسجلت', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().recordIncomePeriods(incomeId, [{ key: K8, amount: 8000 }]);
    await harness.waitForData(api => !!api.incomes[0].closed?.[K8]);
    await harness.api().skipIncomePeriod(incomeId, K9);
    await harness.waitForData(api => !!api.incomes[0].closed?.[K9]);
    expect(harness.api().incomes[0].closed?.[K8]?.txId).toBeTruthy();
  });
});

describe('النتيجة القاطعة', () => {
  it('اتوقف من جهاز تاني ← مفيش تسجيل ومش فشل', async () => {
    const { incomeId } = await makeIncome();
    await updateDoc(doc(db, ...uidPath(), 'incomes', incomeId), { status: 'paused' });
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [], stopped: true });
  });

  it('المحفظة اتأرشفت ← wallet-missing ومفيش حاجة اتكتبت', async () => {
    const { walletId, incomeId } = await makeIncome();
    await updateDoc(doc(db, ...uidPath(), 'wallets', walletId), { archived: true, archivedAt: new Date().toISOString() });
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]);
    expect(r).toEqual({ outcome: 'wallet-missing', recorded: [] });
    expect(incomeTxs(incomeId)).toHaveLength(0);
    expect(harness.api().incomes[0].closed?.[K9]).toBeUndefined();
  });

  it('من غير نت ← no-connection على طول ومفيش حاجة اتكتبت', async () => {
    const { incomeId } = await makeIncome();
    await harness.waitForData(api => api.serverReachable === true);
    await disableNetwork(db);
    try {
      await harness.waitForData(api => api.serverReachable === false);
      const t0 = Date.now();
      const r = await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]);
      expect(r.outcome).toBe('no-connection');
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(incomeTxs(incomeId)).toHaveLength(0);
    } finally {
      await enableNetwork(db);
      await harness.waitForData(api => api.serverReachable === true);
    }
  });

  it('الرجوع من الإيقاف بيبدأ العدّ من النهاردة', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().setIncomeStatus(incomeId, 'paused');
    await harness.waitForData(api => api.incomes[0].status === 'paused');
    await harness.api().setIncomeStatus(incomeId, 'active');
    await harness.waitForData(api => api.incomes[0].status === 'active');
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(harness.api().incomes[0].startDate).toBe(todayStr);
  });
});

describe('القواعد', () => {
  const base = { name: 'x', amount: 100, walletId: 'w', frequency: 'monthly', mode: 'confirm', status: 'active', dayOfMonth: 1 };
  const put = (data: Record<string, unknown>) => setDoc(doc(db, ...uidPath(), 'incomes', 'r1'), data);
  async function expectDenied(p: Promise<unknown>) {
    await expect(p).rejects.toMatchObject({ code: 'permission-denied' });
  }

  it('سليم بيعدّي (شهري وأسبوعي)', async () => {
    await expect(put(base)).resolves.toBeUndefined();
    const { dayOfMonth, ...weekly } = base;
    void dayOfMonth;
    await expect(put({ ...weekly, frequency: 'weekly', weekday: 6 })).resolves.toBeUndefined();
  });

  it.each([
    ['اسم فاضي', { name: '' }],
    ['مبلغ صفر', { amount: 0 }],
    ['مبلغ سالب', { amount: -5 }],
    ['تكرار غلط', { frequency: 'yearly' }],
    ['وضع غلط', { mode: 'sometimes' }],
    ['حالة غلط', { status: 'deleted' }],
    ['يوم 32', { dayOfMonth: 32 }],
    ['يوم 0', { dayOfMonth: 0 }],
    ['يوم كسر', { dayOfMonth: 1.5 }],
    ['يوم أسبوع 7', { weekday: 7 }],
  ])('%s بيترفض', async (_l, patch) => {
    await expectDenied(put({ ...base, ...patch }));
  });

  it('من غير محفظة بيترفض', async () => {
    const { walletId, ...noWallet } = base;
    void walletId;
    await expectDenied(put(noWallet));
  });
});


/**
 * money-reviewer: تغيير يوم الأسبوع بعد أسابيع اتسجلت كان بيخلي نفس الأسابيع
 * تبان مفتوحة بمفاتيح جديدة وتتسجل مرتين.
 */
describe('تغيير الجدول', () => {
  it('يوم الأسبوع اتغيّر ← البداية بتتنقل لبعد آخر أسبوع اتقفل، ومفيش حقل معلّق', async () => {
    const { incomeId } = await makeIncome({ frequency: 'weekly', dayOfMonth: undefined, weekday: 5 });
    // آخر أسبوع اتقفل = الجاي ("نزل" بدري) — لازم يبقى في الجدول (M3)
    const last = incomeUpcomingPeriod(harness.api().incomes[0], TODAY)!;
    expect((await harness.api().recordIncomePeriods(incomeId, [{ key: last, amount: 8000 }])).recorded).toEqual([last]);
    await harness.waitForData(api => !!api.incomes[0].closed?.[last]);

    await harness.api().updateIncome(incomeId, { frequency: 'weekly', weekday: 1 });
    await harness.waitForData(api => api.incomes[0].weekday === 1);
    expect(harness.api().incomes[0].startDate).toBe(addDays(last, 7));
  });

  it('شهري ← أسبوعي بيشيل dayOfMonth', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().updateIncome(incomeId, { frequency: 'weekly', weekday: 3 });
    await harness.waitForData(api => api.incomes[0].frequency === 'weekly');
    expect(harness.api().incomes[0].dayOfMonth).toBeUndefined();
  });

  it('يوم الشهر بس اتغيّر ← البداية زي ما هي (المفاتيح شهرية)', async () => {
    const { incomeId } = await makeIncome();
    const before = harness.api().incomes[0].startDate;
    await harness.api().updateIncome(incomeId, { dayOfMonth: 5 });
    await harness.waitForData(api => api.incomes[0].dayOfMonth === 5);
    expect(harness.api().incomes[0].startDate).toBe(before);
  });
});

/**
 * بند 1ب (2026-09-25): الدخل اللي عمره ما سجّل حاجة بيتمسح؛ اللي سجّل ولو مرة
 * بيتوقف بس — والذرة بتتأكد من السيرفر مش من النسخة اللي عندنا.
 */
describe('مسح الدخل الثابت', () => {
  it('عمره ما سجّل ← بيتمسح، والرصيد ما اتلمسش', async () => {
    const { walletId, incomeId } = await makeIncome();
    const before = balanceOf(walletId);
    expect(await harness.api().deleteIncome(incomeId)).toBe('done');
    await harness.waitForData(api => api.incomes.length === 0);
    expect(balanceOf(walletId)).toBe(before);
  });

  it('"ما نزلش" بس ← بيتمسح برضه', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().skipIncomePeriod(incomeId, K9);
    await harness.waitForData(api => api.incomes[0].closed?.[K9]?.skipped === true);
    await harness.waitForData(api => api.pendingWrites === 0);
    expect(await harness.api().deleteIncome(incomeId)).toBe('done');
    await harness.waitForData(api => api.incomes.length === 0);
  });

  it('سجّل مرة ← has-records، والدخل والعملية فاضلين', async () => {
    const { walletId, incomeId } = await makeIncome();
    await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]);
    await harness.waitForData(() => incomeTxs(incomeId).length === 1);
    const after = balanceOf(walletId);
    expect(await harness.api().deleteIncome(incomeId)).toBe('has-records');
    expect(harness.api().incomes).toHaveLength(1);
    expect(incomeTxs(incomeId)).toHaveLength(1);
    expect(balanceOf(walletId)).toBe(after);
  });

  it('سجّل والمستخدم مسح العملية ← لسه has-records (كانت فلوس دخلت)', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().recordIncomePeriods(incomeId, [{ key: K9, amount: 8000 }]);
    await harness.waitForData(() => incomeTxs(incomeId).length === 1);
    await deleteDoc(doc(db, ...uidPath(), 'transactions', incomeTxId(incomeId, K9)));
    await harness.waitForData(() => incomeTxs(incomeId).length === 0);
    expect(await harness.api().deleteIncome(incomeId)).toBe('has-records');
    expect(harness.api().incomes).toHaveLength(1);
  });

  it('جهاز تاني سجّل والنسخة اللي عندنا لسه ما عرفتش ← الذرة بتلاقيها من السيرفر', async () => {
    const { walletId, incomeId } = await makeIncome();
    // اللي الجهاز التاني كتبه: العلامة بس (من غير العملية)، عشان النسخة المحلية
    // تفضل فاضية من أي عملية والفحص المحلي ميلحقش يمنع
    await updateDoc(doc(db, ...uidPath(), 'incomes', incomeId), {
      closed: { [K9]: { txId: incomeTxId(incomeId, K9), at: new Date().toISOString() } },
    });
    void walletId;
    expect(await harness.api().deleteIncome(incomeId)).toBe('has-records');
    await harness.waitForData(api => api.incomes.length === 1);
  });

  it('العلامة "ما نزلش" بس العملية موجودة بالمعرّف الثابت (سباق skipIncomePeriod) ← has-records من جوه الذرة', async () => {
    const { walletId, incomeId } = await makeIncome();
    await harness.api().skipIncomePeriod(incomeId, K9);
    await harness.waitForData(api => api.incomes[0].closed?.[K9]?.skipped === true);
    await harness.waitForData(api => api.pendingWrites === 0);
    // العملية مكتوبة من غير incomeId عشان الفحص المحلي ميشوفهاش — الذرة لازم
    // تلاقيها بالمعرّف الثابت
    await setDoc(doc(db, ...uidPath(), 'transactions', incomeTxId(incomeId, K9)), {
      type: 'income', amount: 8000, walletId, date: `${K9}-25`,
    });
    expect(await harness.api().deleteIncome(incomeId)).toBe('has-records');
    expect(harness.api().incomes).toHaveLength(1);
  });

  it('من غير نت ← no-connection على طول والدخل فاضل', async () => {
    const { incomeId } = await makeIncome();
    await harness.waitForData(api => api.serverReachable === true);
    await disableNetwork(db);
    try {
      await harness.waitForData(api => api.serverReachable === false);
      expect(await harness.api().deleteIncome(incomeId)).toBe('no-connection');
      expect(harness.api().incomes).toHaveLength(1);
    } finally {
      await enableNetwork(db);
      await harness.waitForData(api => api.serverReachable === true);
    }
  });
});
