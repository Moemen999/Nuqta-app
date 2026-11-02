import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { addOneGam, addOneSub, storedDoc, userCol } from '@/test-utils/entryFixtures';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { todayStr } from '@/lib/finance';
import { doc, getDocsFromServer, updateDoc } from 'firebase/firestore';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * خط النهاية: "المبلغ اتعدّل من جهاز تاني والتأكيد مفتوح ← يتكتب الجديد مش اللي اتشاف".
 * التأكيد بيقول "اتخصم 100 ج.م؟"، وجهاز تاني بيخلّي المبلغ 120 قبل "تأكيد". الشاشة بتبعت
 * اللي اتشاف (100)، والذرة اللي بتقرا 120 من السيرفر بترفض بـ`amount-changed` ومفيش ولا كتابة.
 */
let h: Awaited<ReturnType<typeof renderDataProvider>>;
beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  h = await renderDataProvider();
  await h.waitForReady();
});
afterEach(async () => { await h.unmount(); });

/** "مفيش كتابة": نستنى شوية (الذرة بتخلص قبل ما الكاش يوصله) وبعدين نسأل السيرفر */
const serverTxs = async () => { await new Promise(r => setTimeout(r, 1000)); return (await getDocsFromServer(userCol('transactions'))).docs.map(d => d.data()); };
/** "اتكتبت": نستنى الـlistener يشوفها */
const landedTxs = async (n: number) => { await h.waitForData(api => api.transactions.length === n); return h.api().transactions; };

describe('اشتراك', () => {
  it('المبلغ اتعدّل بعد ما التأكيد اتعرض ← amount-changed، مفيش عملية ولا دفعة', async () => {
    const id = await addOneSub(h); // 100
    expect(await h.api().updateSubscription(id, { amount: 120 })).toEqual({ outcome: 'done' });
    await h.waitForData(api => api.subscriptions[0]?.amount === 120);
    expect(await h.api().markSubscriptionPaid(id, todayStr(), 100)).toBe('amount-changed');
    expect(await serverTxs()).toHaveLength(0);
    const sub = await storedDoc('subscriptions', id);
    expect(sub.history ?? []).toHaveLength(0);
    expect(sub.closed ?? {}).toEqual({});
  });

  it('نفس المبلغ اللي اتشاف ← بيتسجل عادي بالمبلغ ده', async () => {
    const id = await addOneSub(h);
    expect(await h.api().markSubscriptionPaid(id, todayStr(), 100)).toBe('done');
    const txs = await landedTxs(1);
    expect(txs[0].amount).toBe(100);
  });

  it('فرق أقل من نص قرش (تقريب) ← مش تغيير', async () => {
    const id = await addOneSub(h, { amount: 99.99 });
    expect(await h.api().markSubscriptionPaid(id, todayStr(), 99.990000001)).toBe('done');
  });

  it('من غير مبلغ اتشاف (نداء من غير شاشة) ← زي الأول، مفيش مقارنة', async () => {
    const id = await addOneSub(h);
    expect(await h.api().updateSubscription(id, { amount: 120 })).toEqual({ outcome: 'done' });
    await h.waitForData(api => api.subscriptions[0]?.amount === 120);
    expect(await h.api().markSubscriptionPaid(id, todayStr())).toBe('done');
    expect((await landedTxs(1))[0].amount).toBe(120);
  });
});

describe('جمعية', () => {
  /** "جهاز تاني" بيغيّر مبلغ شهر معيّن على السيرفر */
  async function setMonthAmount(id: string, monthId: string, amount: number) {
    const g = await storedDoc('gamiyas', id);
    await updateDoc(doc(userCol('gamiyas'), id), {
      months: g.months.map((m: { id: string }) => (m.id === monthId ? { ...m, amount } : m)),
    });
    await h.waitForData(api => api.gamiyas[0]?.months.find(m => m.id === monthId)?.amount === amount);
  }

  it('قسط الشهر اتعدّل بعد التأكيد ← amount-changed، الشهر لسه pending ومفيش عملية', async () => {
    const id = await addOneGam(h); // 1000
    const month = h.api().gamiyas[0].months.find(m => !m.isPayoutMonth)!;
    await setMonthAmount(id, month.id, 1200);
    expect(await h.api().markGamiyaMonthDone(id, month.id, 1000)).toBe('amount-changed');
    expect(await serverTxs()).toHaveLength(0);
    const stored = (await storedDoc('gamiyas', id)).months.find((m: { id: string }) => m.id === month.id);
    expect(stored.status).toBe('pending');
    expect(stored.transactionId).toBeUndefined();
  });

  it('شهر الاستلام اتعدّل ← نفس الرفض', async () => {
    const id = await addOneGam(h);
    const payout = h.api().gamiyas[0].months.find(m => m.isPayoutMonth)!;
    await setMonthAmount(id, payout.id, 9000);
    expect(await h.api().markGamiyaMonthDone(id, payout.id, payout.amount)).toBe('amount-changed');
    expect(await serverTxs()).toHaveLength(0);
  });

  it('نفس المبلغ ← بيتسجل بالمبلغ ده', async () => {
    const id = await addOneGam(h);
    const month = h.api().gamiyas[0].months.find(m => !m.isPayoutMonth)!;
    expect(await h.api().markGamiyaMonthDone(id, month.id, month.amount)).toBe('done');
    const txs = await landedTxs(1);
    expect(txs[0].amount).toBe(month.amount);
  });
});
