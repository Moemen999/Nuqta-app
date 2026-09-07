import { walletBalance } from '@/lib/finance';
import { clearFirestore, newUid, settle } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * الاتجاه التاني من الاتساق: لما السجل نفسه بيتمسح، كل العمليات اللي ولّدها
 * لازم تتمسح معاه. أي عملية يتيمة فاضلة معناها رصيد غلط لحد ما المستخدم يكتشفها
 * بنفسه في الأرشيف.
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;

beforeEach(async () => {
  await clearFirestore();
  setMockUid(newUid());
  harness = await renderDataProvider();
  await harness.waitForData(api => api.wallets.length >= 3);
});

afterEach(async () => {
  await harness.unmount();
});

describe('حذف السجل بيمسح كل عملياته', () => {
  it('حذف دين عليه دفعة وزيادة بيمسح تلات عمليات ومبيسيبش ولا واحدة', async () => {
    const w = harness.api().wallets[0];
    await harness.api().addDebt({
      direction: 'owed_to_me', personName: 'كريم', totalAmount: 1000,
      isInstallment: false, walletId: w.id, date: '2026-03-10',
    });
    await harness.waitForData(api => api.debts.length === 1);

    const debtId = harness.api().debts[0].id;
    await harness.api().addDebtIncrease(debtId, 500, '2026-03-12', w.id);
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
    await harness.api().addDebtPayment(debtId, 300, w.id, '2026-03-20');
    await harness.waitForData(api => api.transactions.length === 3);
    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(-1200);

    await harness.api().deleteDebt(debtId);
    await harness.waitForData(api => api.debts.length === 0 && api.transactions.length === 0);

    await settle(800);
    expect(harness.api().transactions).toHaveLength(0);
    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(0);
  });

  it('حذف اشتراك بيمسح كل دفعاته المسجلة', async () => {
    const w = harness.api().wallets[0];
    await harness.api().addSubscription({
      name: 'نتفليكس', amount: 200, walletId: w.id,
      frequency: 'monthly', nextDueDate: '2026-03-10', reminderDaysBefore: 2,
    });
    await harness.waitForData(api => api.subscriptions.length === 1);

    const subId = harness.api().subscriptions[0].id;
    await harness.api().markSubscriptionPaid(subId, '2026-03-10');
    await harness.waitForData(api => api.subscriptions[0].history.length === 1);
    await harness.api().markSubscriptionPaid(subId, '2026-04-10');
    await harness.waitForData(api => api.transactions.length === 2);

    await harness.api().deleteSubscription(subId);
    await harness.waitForData(api => api.subscriptions.length === 0 && api.transactions.length === 0);

    await settle(800);
    expect(harness.api().transactions).toHaveLength(0);
    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(0);
  });

  it('حذف جمعية بيمسح عمليات الشهور اللي اتسددت بس', async () => {
    const w = harness.api().wallets[0];
    await harness.api().addGamiya({
      name: 'جمعية العيلة', monthlyAmount: 400, totalMonths: 4, payoutMonthIndex: 2,
      payoutAmount: 1600, walletId: w.id, startDate: '2026-01-10', reminderDaysBefore: 3,
    });
    await harness.waitForData(api => api.gamiyas.length === 1 && api.gamiyas[0].months.length === 4);

    const g = harness.api().gamiyas[0];
    await harness.api().markGamiyaMonthDone(g.id, g.months[0].id);
    await harness.waitForData(api => api.transactions.length === 1);
    // شهر الاستلام: بيدخل فلوس
    await harness.api().markGamiyaMonthDone(g.id, harness.api().gamiyas[0].months[1].id);
    await harness.waitForData(api => api.transactions.length === 2);
    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(-400 + 1600);

    await harness.api().deleteGamiya(g.id);
    await harness.waitForData(api => api.gamiyas.length === 0 && api.transactions.length === 0);

    await settle(800);
    expect(harness.api().transactions).toHaveLength(0);
    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(0);
  });

  it('حذف دين مربوطش بمحفظة مبيمسحش عمليات مالهاش علاقة بيه', async () => {
    const w = harness.api().wallets[0];
    // عملية عادية مالهاش علاقة بأي دين
    await harness.api().addTransaction({ type: 'expense', amount: 90, walletId: w.id, date: '2026-03-01' });
    await harness.waitForData(api => api.transactions.length === 1);

    await harness.api().addDebt({
      direction: 'i_owe', personName: 'بالأجل', totalAmount: 700,
      isInstallment: false, date: '2026-03-10',
    });
    await harness.waitForData(api => api.debts.length === 1);
    // دين بالأجل: مفيش عملية اتولدت
    expect(harness.api().transactions).toHaveLength(1);

    await harness.api().deleteDebt(harness.api().debts[0].id);
    await harness.waitForData(api => api.debts.length === 0);

    await settle(800);
    expect(harness.api().transactions).toHaveLength(1);
    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(-90);
  });
});
