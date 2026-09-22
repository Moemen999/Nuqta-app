import { db } from '@/firebaseConfig';
import { walletBalance } from '@/lib/finance';
import { incomeTxId } from '@/lib/recurringIncome';
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

async function makeIncome(over: Record<string, unknown> = {}) {
  const w = harness.api().wallets[0];
  await harness.api().addIncome({
    name: 'المرتب', amount: 8000, walletId: w.id, frequency: 'monthly', dayOfMonth: 25, mode: 'confirm',
    ...over,
  } as any);
  await harness.waitForData(api => api.incomes.length === 1);
  await harness.waitForData(api => api.pendingWrites === 0);
  return { walletId: w.id, incomeId: harness.api().incomes[0].id };
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

    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: ['2026-09'] });

    await harness.waitForData(api => api.transactions.some(t => t.id === incomeTxId(incomeId, '2026-09')));
    const tx = harness.api().transactions.find(t => t.id === incomeTxId(incomeId, '2026-09'))!;
    expect(tx).toMatchObject({ type: 'income', amount: 8000, walletId });
    expect(harness.api().incomes[0].closed?.['2026-09']?.txId).toBe(tx.id);
    expect(balanceOf(walletId) - before).toBe(8000);
  });

  it('كذا فترة في نداء واحد (اللحاق) ← كلهم', async () => {
    const { incomeId } = await makeIncome();
    const r = await harness.api().recordIncomePeriods(incomeId, [
      { key: '2026-07', amount: 8000 }, { key: '2026-08', amount: 8000 }, { key: '2026-09', amount: 8000 },
    ]);
    expect(r.recorded).toEqual(['2026-07', '2026-08', '2026-09']);
    await harness.waitForData(() => incomeTxs(incomeId).length === 3);
  });

  it('مبلغ الفترة دي بس مختلف ← الأساس ما اتغيّرش', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 7200 }]);
    await harness.waitForData(() => incomeTxs(incomeId).length === 1);
    expect(incomeTxs(incomeId)[0].amount).toBe(7200);
    expect(harness.api().incomes[0].amount).toBe(8000);
  });
});

describe('ممنوع يتسجل مرتين', () => {
  it('نفس الفترة مرتين ورا بعض ← التانية مبتسجلش حاجة', async () => {
    const { walletId, incomeId } = await makeIncome();
    await harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 8000 }]);
    await harness.waitForData(() => incomeTxs(incomeId).length === 1);
    const after1 = balanceOf(walletId);

    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [] });
    expect(incomeTxs(incomeId)).toHaveLength(1);
    expect(balanceOf(walletId)).toBe(after1);
  });

  it('نداءين في نفس اللحظة (جهازين / فتح التطبيق مرتين) ← عملية واحدة', async () => {
    const { walletId, incomeId } = await makeIncome();
    const before = balanceOf(walletId);
    const [a, b] = await Promise.all([
      harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 8000 }]),
      harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 8000 }]),
    ]);
    expect([...a.recorded, ...b.recorded]).toEqual(['2026-09']);
    await harness.waitForData(() => incomeTxs(incomeId).length === 1);
    expect(balanceOf(walletId) - before).toBe(8000);
  });

  it('المستخدم مسح العملية ← مبترجعش تتسجل لوحدها', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 8000 }]);
    await harness.waitForData(() => incomeTxs(incomeId).length === 1);
    await deleteDoc(doc(db, ...uidPath(), 'transactions', incomeTxId(incomeId, '2026-09')));
    await harness.waitForData(() => incomeTxs(incomeId).length === 0);

    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 8000 }]);
    expect(r.recorded).toEqual([]);
    expect(incomeTxs(incomeId)).toHaveLength(0);
  });

  it('عملية موجودة بالمعرّف (والعلامة ناقصة) ← بتتقفل من غير ما تتكتب فوق تعديل المستخدم', async () => {
    const { walletId, incomeId } = await makeIncome();
    await setDoc(doc(db, ...uidPath(), 'transactions', incomeTxId(incomeId, '2026-09')), {
      type: 'income', amount: 7777, walletId, date: '2026-09-25', incomeId, periodKey: '2026-09',
    });
    await harness.waitForData(() => incomeTxs(incomeId).length === 1);

    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 8000 }]);
    expect(r.recorded).toEqual([]);
    await harness.waitForData(api => !!api.incomes[0].closed?.['2026-09']);
    expect(incomeTxs(incomeId)[0].amount).toBe(7777);
  });

  it('"مانزلش" بيقفل الفترة، ومفيش تسجيل بعدها', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().skipIncomePeriod(incomeId, '2026-09');
    await harness.waitForData(api => api.incomes[0].closed?.['2026-09']?.skipped === true);
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 8000 }]);
    expect(r.recorded).toEqual([]);
  });

  it('"مانزلش" على فترة مبيمسحش علامة فترة تانية اتسجلت', async () => {
    const { incomeId } = await makeIncome();
    await harness.api().recordIncomePeriods(incomeId, [{ key: '2026-08', amount: 8000 }]);
    await harness.waitForData(api => !!api.incomes[0].closed?.['2026-08']);
    await harness.api().skipIncomePeriod(incomeId, '2026-09');
    await harness.waitForData(api => !!api.incomes[0].closed?.['2026-09']);
    expect(harness.api().incomes[0].closed?.['2026-08']?.txId).toBeTruthy();
  });
});

describe('النتيجة القاطعة', () => {
  it('اتوقف من جهاز تاني ← مفيش تسجيل ومش فشل', async () => {
    const { incomeId } = await makeIncome();
    await updateDoc(doc(db, ...uidPath(), 'incomes', incomeId), { status: 'paused' });
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 8000 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [] });
  });

  it('المحفظة اتأرشفت ← wallet-missing ومفيش حاجة اتكتبت', async () => {
    const { walletId, incomeId } = await makeIncome();
    await updateDoc(doc(db, ...uidPath(), 'wallets', walletId), { archived: true, archivedAt: new Date().toISOString() });
    const r = await harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 8000 }]);
    expect(r).toEqual({ outcome: 'wallet-missing', recorded: [] });
    expect(incomeTxs(incomeId)).toHaveLength(0);
    expect(harness.api().incomes[0].closed?.['2026-09']).toBeUndefined();
  });

  it('من غير نت ← no-connection على طول ومفيش حاجة اتكتبت', async () => {
    const { incomeId } = await makeIncome();
    await harness.waitForData(api => api.serverReachable === true);
    await disableNetwork(db);
    try {
      await harness.waitForData(api => api.serverReachable === false);
      const t0 = Date.now();
      const r = await harness.api().recordIncomePeriods(incomeId, [{ key: '2026-09', amount: 8000 }]);
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
    const last = '2099-01-02';
    await harness.api().recordIncomePeriods(incomeId, [{ key: last, amount: 8000 }]);
    await harness.waitForData(api => !!api.incomes[0].closed?.[last]);

    await harness.api().updateIncome(incomeId, { frequency: 'weekly', weekday: 1 });
    await harness.waitForData(api => api.incomes[0].weekday === 1);
    expect(harness.api().incomes[0].startDate).toBe('2099-01-09');
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
