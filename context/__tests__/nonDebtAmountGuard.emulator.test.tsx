import { db } from '@/firebaseConfig';
import { todayStr } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * بند 15 على المحاكي: `addSubscription`/`updateSubscription`/`addGamiya`/`updateGamiya`
 * نفسهم بيرفضوا القيمة الغلط **بنتيجة** (`invalid`) قبل أي كتابة — مش الفورم بس.
 * القواعد (`amount is number && amount > 0`) بتعدّي Infinity، فالحارس ده هو الوحيد.
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;
const today = todayStr();

beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForReady();
});
afterEach(async () => { await harness.unmount(); });

const col = (name: string) => collection(db, 'users', getMockUid(), name);
const sub = (o: Record<string, unknown> = {}) => ({
  name: 'نتفليكس', amount: 100, walletId: harness.api().wallets[0].id, frequency: 'monthly' as const,
  nextDueDate: today, reminderDaysBefore: 3, ...o,
});
const gam = (o: Record<string, unknown> = {}) => ({
  name: 'جمعية', monthlyAmount: 1000, payoutAmount: 10000, totalMonths: 10, payoutMonthIndex: 3,
  walletId: harness.api().wallets[0].id, startDate: today, reminderDaysBefore: 3, ...o,
});

describe('اشتراك جديد', () => {
  it.each([
    ['مبلغ Infinity', { amount: Infinity }, 'amount'],
    ['مبلغ 1e307', { amount: 1e307 }, 'amount'],
    ['مبلغ سالب', { amount: -5 }, 'amount'],
    ['أيام تكرار Infinity', { frequency: 'custom', customDays: Infinity }, 'customDays'],
    ['أيام تكرار سالبة', { frequency: 'custom', customDays: -5 }, 'customDays'],
    ['أيام تكرار 0.5', { frequency: 'custom', customDays: 0.5 }, 'customDays'],
    ['تذكير Infinity', { reminderDaysBefore: Infinity }, 'reminderDays'],
  ])('%s ← invalid ومفيش مستند', async (_l, o, field) => {
    const result = await harness.api().addSubscription(sub(o) as never);
    expect(result).toMatchObject({ outcome: 'invalid', field });
    // كتابة عادية بعدها: لو المرفوض كان اتكتب، هيبقوا اتنين
    expect(await harness.api().addSubscription(sub())).toEqual({ outcome: 'done' });
    await harness.waitForData(api => api.subscriptions.length >= 1);
    expect((await getDocs(col('subscriptions'))).docs.map(d => d.data().amount)).toEqual([100]);
  });

  it('مبلغ بكسور ← بيتخزّن مقرّب', async () => {
    await harness.api().addSubscription(sub({ amount: 10.005 }));
    await harness.waitForData(api => api.subscriptions.length === 1);
    expect((await getDocs(col('subscriptions'))).docs[0].data().amount).toBe(10.01);
  });
});

it('تعديل اشتراك لـInfinity ← invalid والمبلغ القديم فاضل', async () => {
  await harness.api().addSubscription(sub({ amount: 200 }));
  await harness.waitForData(api => api.subscriptions.length === 1);
  const id = harness.api().subscriptions[0].id;
  expect(await harness.api().updateSubscription(id, { amount: Infinity })).toMatchObject({ outcome: 'invalid', field: 'amount' });
  expect(await harness.api().updateSubscription(id, { frequency: 'custom', customDays: -1 })).toMatchObject({ outcome: 'invalid', field: 'customDays' });
  await harness.api().updateSubscription(id, { name: 'شاهد' });
  await harness.waitForData(api => api.subscriptions[0]?.name === 'شاهد');
  expect((await getDoc(doc(col('subscriptions'), id))).data()).toMatchObject({ name: 'شاهد', amount: 200, frequency: 'monthly' });
});

describe('جمعية', () => {
  it.each([
    ['قسط Infinity', { monthlyAmount: Infinity }, 'monthlyAmount'],
    ['قسط 1e307', { monthlyAmount: 1e307 }, 'monthlyAmount'],
    ['استلام Infinity', { payoutAmount: Infinity }, 'payoutAmount'],
    ['شهور 2.5', { totalMonths: 2.5 }, 'totalMonths'],
    ['شهور Infinity', { totalMonths: Infinity }, 'totalMonths'],
    ['شهور 61', { totalMonths: 61 }, 'totalMonths'],
    ['شهر استلام 1.5', { payoutMonthIndex: 1.5 }, 'payoutMonth'],
    ['تذكير سالب', { reminderDaysBefore: -1 }, 'reminderDays'],
  ])('%s ← invalid ومفيش مستند', async (_l, o, field) => {
    expect(await harness.api().addGamiya(gam(o))).toMatchObject({ outcome: 'invalid', field });
    expect(await harness.api().addGamiya(gam())).toEqual({ outcome: 'done' });
    await harness.waitForData(api => api.gamiyas.length >= 1);
    expect((await getDocs(col('gamiyas'))).size).toBe(1);
  });

  it('عادية ← المبالغ مقرّبة في المستند وفي كل شهر', async () => {
    await harness.api().addGamiya(gam({ monthlyAmount: 1000.005 }));
    await harness.waitForData(api => api.gamiyas.length === 1);
    const g = (await getDocs(col('gamiyas'))).docs[0].data();
    expect(g.monthlyAmount).toBe(1000.01);
    expect(g.months).toHaveLength(10);
    const months = g.months as { isPayoutMonth: boolean; amount: number }[];
    expect(months.filter(m => m.isPayoutMonth).map(m => m.amount)).toEqual([10000]);
    expect(months.filter(m => !m.isPayoutMonth).every(m => m.amount === 1000.01)).toBe(true);
  });

  it('تعديل التذكير لـInfinity ← invalid والقديم فاضل', async () => {
    await harness.api().addGamiya(gam());
    await harness.waitForData(api => api.gamiyas.length === 1);
    const id = harness.api().gamiyas[0].id;
    expect(await harness.api().updateGamiya(id, { reminderDaysBefore: Infinity })).toMatchObject({ outcome: 'invalid' });
    await harness.api().updateGamiya(id, { name: 'جمعية 2' });
    await harness.waitForData(api => api.gamiyas[0]?.name === 'جمعية 2');
    expect((await getDoc(doc(col('gamiyas'), id))).data()).toMatchObject({ reminderDaysBefore: 3 });
  });
});
