import { spendingExpenses, transferTransactionIds, cashTotals } from '@/lib/spending';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * خطوة 8 بتعتمد على افتراض واحد: كل عملية مالية بتتولّد من السلفة أو الجمعية
 * معرّفها متخزّن جوه الدين/الجمعية. الاختبار ده بيكتب بالمسارات الحقيقية
 * (`addDebt`، `addDebtPayment`، `addDebtIncrease`، `markGamiyaMonthDone`) ويتأكد
 * إن `transferTransactionIds` بيلاقي كل عملية منهم — وإن مصروف عادي مبيتلمسش.
 *
 * **اتكتب في جلسة سحابية ومااتشغلش** — `npm run test:db` على الجهاز قبل الدمج.
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

it('السلفة (أصل، زيادة، سداد) وقسط الجمعية كلهم متعرّفين، والمصروف العادي لأ', async () => {
  const api = () => harness.api();
  const w = api().wallets[0];
  const cat = api().categories[0];

  await api().addDebt({
    direction: 'owed_to_me', personName: 'صاحبي', totalAmount: 2000, isInstallment: false,
    walletId: w.id, date: '2026-09-01',
  });
  await harness.waitForData(a => a.debts.length === 1 && !!a.debts[0].initialTransactionId);
  const debtId = api().debts[0].id;
  expect((await api().addDebtIncrease(debtId, 500, '2026-09-02', w.id)).outcome).toBe('done');
  expect((await api().addDebtPayment(debtId, 300, w.id, '2026-09-03')).outcome).toBe('done');
  await harness.waitForData(a => (a.debts[0].payments || []).length === 1 && (a.debts[0].increases || []).length === 1);

  await api().addGamiya({
    name: 'جمعية', monthlyAmount: 1000, totalMonths: 3, payoutMonthIndex: 3,
    payoutAmount: 3000, walletId: w.id, startDate: '2026-09-01', reminderDaysBefore: 1,
  });
  await harness.waitForData(a => a.gamiyas.length === 1);
  const g = api().gamiyas[0];
  expect(await api().markGamiyaMonthDone(g.id, g.months[0].id)).toBe('done');
  await harness.waitForData(a => a.gamiyas[0].months[0].status === 'done');

  await api().addTransaction({ type: 'expense', amount: 150, walletId: w.id, categoryId: cat.id, date: '2026-09-04' });
  await harness.waitForData(a => a.transactions.length === 5);

  const transfers = transferTransactionIds(api().debts, api().gamiyas);
  expect(transfers.size).toBe(4);
  const spend = spendingExpenses(api().transactions, transfers);
  expect(spend.map(t => t.amount)).toEqual([150]);
  const totals = cashTotals(api().transactions, transfers);
  expect(totals).toEqual({ income: 0, expense: 150, transfers: 4 });
});
