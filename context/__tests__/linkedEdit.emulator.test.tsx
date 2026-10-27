import { debtRemaining, walletBalance } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * تعديل عملية مربوطة بدين (بند 14، 2026-10-27): العملية والدين بيتعدّلوا مع
 * بعض في ذرة واحدة. قبل كده `updateTransaction` كان بيعدّل العملية بس —
 * الرصيد يتحرك 120 والمتبقي على الدين محسوب بـ100.
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

// اللي المودال شافه وقت ما اتفتح: دفعة "له عندك" بـ100
const paid = (walletId: string) => ({ amount: 100, walletId, type: 'income' as const });

async function debtWithPayment() {
  const w = harness.api().wallets[0];
  await harness.api().addDebt({
    direction: 'owed_to_me', personName: 'صاحبي', totalAmount: 1000,
    isInstallment: false, walletId: w.id, date: '2026-03-10',
  });
  await harness.waitForData(api => api.debts.length === 1 && api.transactions.length === 1);
  const debtId = harness.api().debts[0].id;
  await harness.api().addDebtPayment(debtId, 100, w.id, '2026-03-20');
  await harness.waitForData(api => (api.debts[0].payments || []).length === 1 && api.transactions.length === 2);
  return { w, debtId, payTxId: harness.api().debts[0].payments[0].transactionId! };
}

it('تعديل مبلغ الدفعة ← العملية والدفعة والمتبقي والرصيد كلهم بالمبلغ الجديد', async () => {
  const { w, payTxId } = await debtWithPayment();
  const r = await harness.api().updateDebtLinkedTransaction(payTxId, { amount: 120, walletId: w.id, date: '2026-03-21', note: 'x' }, paid(w.id));
  expect(r.outcome).toBe('done');
  await harness.waitForData(api => api.debts[0].payments[0].amount === 120);

  const api = harness.api();
  expect(api.transactions.find(t => t.id === payTxId)).toMatchObject({ amount: 120, date: '2026-03-21' });
  expect(api.debts[0].payments[0]).toMatchObject({ amount: 120, date: '2026-03-21', transactionId: payTxId });
  expect(debtRemaining(api.debts[0])).toBe(880);
  // -1000 (السلفة) + 120 (اللي رجع)
  expect(walletBalance(api.transactions, w.id, 0)).toBe(-880);
});

it('تعديل أصل الدين ← totalAmount بيتعدّل معاه', async () => {
  const { w } = await debtWithPayment();
  const initTxId = harness.api().debts[0].initialTransactionId!;
  const r = await harness.api().updateDebtLinkedTransaction(initTxId, { amount: 1500, walletId: w.id, date: '2026-03-10' },
    { amount: 1000, walletId: w.id, type: 'expense' });
  expect(r.outcome).toBe('done');
  await harness.waitForData(api => api.debts[0].totalAmount === 1500);
  expect(debtRemaining(harness.api().debts[0])).toBe(1400);
  expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(-1400);
});

it('محفظة جديدة مؤرشفة ← مفيش أي حاجة اتغيّرت', async () => {
  const { w, payTxId } = await debtWithPayment();
  await harness.api().addWallet('قديمة');
  await harness.waitForData(api => api.wallets.some(x => x.name === 'قديمة'));
  const old = harness.api().wallets.find(x => x.name === 'قديمة')!;
  await harness.api().archiveWallet(old.id, {});
  await harness.waitForData(api => !!api.wallets.find(x => x.id === old.id)?.archived);

  const r = await harness.api().updateDebtLinkedTransaction(payTxId, { amount: 120, walletId: old.id, date: '2026-03-20' }, paid(w.id));
  expect(r.outcome).toBe('wallet-missing');
  const api = harness.api();
  expect(api.transactions.find(t => t.id === payTxId)).toMatchObject({ amount: 100, walletId: w.id });
  expect(api.debts[0].payments[0]).toMatchObject({ amount: 100, walletId: w.id });
});

it('عملية مش مربوطة بدين ← gone ومفيش كتابة', async () => {
  const w = harness.api().wallets[0];
  const id = await harness.api().addTransaction({ type: 'expense', amount: 50, walletId: w.id, date: '2026-03-10' });
  await harness.waitForData(api => api.transactions.length === 1);
  const r = await harness.api().updateDebtLinkedTransaction(id, { amount: 70, walletId: w.id, date: '2026-03-10' },
    { amount: 50, walletId: w.id, type: 'expense' });
  expect(r.outcome).toBe('gone');
  expect(harness.api().transactions[0].amount).toBe(50);
});

it('العملية اتعدّلت من جهاز تاني بعد ما المودال اتفتح ← gone ومفيش كتابة', async () => {
  const { w, payTxId } = await debtWithPayment();
  // المودال شاف 90 — على السيرفر 100
  const r = await harness.api().updateDebtLinkedTransaction(payTxId, { amount: 120, walletId: w.id, date: '2026-03-20' },
    { amount: 90, walletId: w.id, type: 'income' });
  expect(r.outcome).toBe('gone');
  expect(harness.api().debts[0].payments[0].amount).toBe(100);
});

it('مبلغ مش محدود ← failed ومفيش كتابة', async () => {
  const { w, payTxId } = await debtWithPayment();
  const r = await harness.api().updateDebtLinkedTransaction(payTxId, { amount: Infinity, walletId: w.id, date: '2026-03-20' }, paid(w.id));
  expect(r.outcome).toBe('failed');
  expect(harness.api().debts[0].payments[0].amount).toBe(100);
});

it('كسر أصغر من القرش ← العملية والدفعة بنفس الرقم المقرّب', async () => {
  const { w, payTxId } = await debtWithPayment();
  await harness.api().updateDebtLinkedTransaction(payTxId, { amount: 100.125, walletId: w.id, date: '2026-03-20' }, paid(w.id));
  await harness.waitForData(api => api.debts[0].payments[0].amount !== 100);
  const api = harness.api();
  expect(api.debts[0].payments[0].amount).toBe(api.transactions.find(t => t.id === payTxId)!.amount);
});

it('حساب من غير ديون ولا اشتراكات ← linkSourcesReady بتبقى true (المجموعة الفاضية بتبعت snapshot)', async () => {
  await harness.waitForData(api => api.linkSourcesReady);
  expect(harness.api().debts).toEqual([]);
});
