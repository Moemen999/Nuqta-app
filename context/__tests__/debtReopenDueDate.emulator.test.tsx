import { reopenedDueDate, todayStr } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * زيادة فتحت دين أقساط متسدد ← `dueDate` بيتقدّم لمعاد مش فات (خطوة 7).
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

const debt = () => harness.api().debts[0];

it('3000 على 3 اتسدد، والمعاد فات ← زيادة 500 بتقدّم المعاد لمعاد مش فات', async () => {
  const w = harness.api().wallets[0];
  await harness.api().addDebt({
    direction: 'i_owe', personName: 'صاحبي', totalAmount: 3000, isInstallment: true, installmentCount: 3,
    walletId: w.id, date: '2026-01-01', dueDate: '2026-01-15', reminderDaysBefore: 1,
  });
  await harness.waitForData(api => api.debts.length === 1);
  // 3 دفعات: المعاد بيتقدّم شهر مع الأولى والتانية، والتالتة (اللي بتخلّص) بتسيبه ← 03-15
  const id = debt().id;
  for (let i = 0; i < 3; i++) {
    expect((await harness.api().addDebtPayment(id, 1000, w.id, '2026-02-01')).outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0].payments || []).length === i + 1);
  }
  const settledDebt = debt();
  expect(settledDebt.dueDate).toBe('2026-03-15');
  // المتوقع بالظبط من نفس الدالة على الدين وهو متسدد (silent-failure-hunter: مش ">= النهارده" بس)
  const expected = reopenedDueDate(settledDebt, 500, todayStr(), todayStr());
  expect(expected).not.toBeNull();
  expect((await harness.api().addDebtIncrease(id, 500, todayStr(), w.id)).outcome).toBe('done');
  await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
  expect(debt().dueDate).toBe(expected);
  expect(debt().dueDate!.slice(8)).toBe('15');
});

it('زيادة على دين لسه مفتوح ← المعاد زي ما هو', async () => {
  const w = harness.api().wallets[0];
  await harness.api().addDebt({
    direction: 'i_owe', personName: 'صاحبي', totalAmount: 3000, isInstallment: true, installmentCount: 3,
    walletId: w.id, date: '2026-01-01', dueDate: '2026-01-15', reminderDaysBefore: 1,
  });
  await harness.waitForData(api => api.debts.length === 1);
  expect((await harness.api().addDebtIncrease(debt().id, 500, todayStr(), w.id)).outcome).toBe('done');
  await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
  expect(debt().dueDate).toBe('2026-01-15');
});
