import { reopenedDueDate, todayStr } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { increaseAsBefore } from '@/test-utils/increaseAsBefore';

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
  expect(((await increaseAsBefore(harness.api(), id, 500, todayStr(), w.id)) as { outcome: string }).outcome).toBe('done');
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
  expect(((await increaseAsBefore(harness.api(), debt().id, 500, todayStr(), w.id)) as { outcome: string }).outcome).toBe('done');
  await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
  expect(debt().dueDate).toBe('2026-01-15');
});

/** بند 12 (قرار مؤمن 2026-11-05): رسالة "المعاد الجاي بقى …"، والمعاد القديم بيرجع مع مسح الزيادة */
async function settledInstallmentDebt() {
  const w = harness.api().wallets[0];
  await harness.api().addDebt({
    direction: 'i_owe', personName: 'صاحبي', totalAmount: 3000, isInstallment: true, installmentCount: 3,
    walletId: w.id, date: '2026-01-01', dueDate: '2026-01-15', reminderDaysBefore: 1,
  });
  await harness.waitForData(api => api.debts.length === 1);
  const id = debt().id;
  for (let i = 0; i < 3; i++) {
    expect((await harness.api().addDebtPayment(id, 1000, w.id, '2026-02-01')).outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0].payments || []).length === i + 1);
  }
  expect(debt().dueDate).toBe('2026-03-15');
  return { id, w };
}

it('بند 12: الزيادة بترجّع "المعاد الجاي بقى …" وبتخزّن القديم، ومسحها بيرجّعه', async () => {
  const { id, w } = await settledInstallmentDebt();
  const res = (await increaseAsBefore(harness.api(), id, 500, todayStr(), w.id)) as { outcome: string; dueNote?: string | null };
  expect(res.outcome).toBe('done');
  await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
  const moved = debt().dueDate!;
  expect(moved).not.toBe('2026-03-15');
  expect(res.dueNote).toContain('المعاد الجاي بقى');
  const inc = debt().increases[0];
  expect([inc.reopenedFrom, inc.reopenedTo]).toEqual(['2026-03-15', moved]);

  expect(await harness.api().deleteDebtIncrease(id, inc.id)).toBe('done');
  await harness.waitForData(api => (api.debts[0].increases || []).length === 0);
  expect(debt().dueDate).toBe('2026-03-15');
});

it('بند 12: مسح **عملية** الزيادة (من الأرشيف) بيرجّع المعاد كمان', async () => {
  const { id, w } = await settledInstallmentDebt();
  await increaseAsBefore(harness.api(), id, 500, todayStr(), w.id);
  await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
  const txId = debt().increases[0].transactionId!;
  await harness.api().deleteTransaction(txId);
  await harness.waitForData(api => (api.debts[0].increases || []).length === 0);
  expect(debt().dueDate).toBe('2026-03-15');
});

it('بند 12: المعاد اتغيّر بعد الزيادة (مش هو اللي حطّته) ← المسح مبيلمسوش', async () => {
  const { id, w } = await settledInstallmentDebt();
  await increaseAsBefore(harness.api(), id, 500, todayStr(), w.id);
  await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
  await harness.api().updateDebt(id, { dueDate: '2030-06-01' });
  await harness.waitForData(api => api.debts[0].dueDate === '2030-06-01');
  expect(await harness.api().deleteDebtIncrease(id, debt().increases[0].id)).toBe('done');
  await harness.waitForData(api => (api.debts[0].increases || []).length === 0);
  expect(debt().dueDate).toBe('2030-06-01');
});
