import { walletBalance } from '@/lib/finance';
import { clearFirestore, settle, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * رصيد المحفظة المؤرشفة لازم يفضل صفر مهما اتعدّل أو اتمسح من تاريخها. هي
 * مخفية من الإجمالي، فأي جنيه بيتحرك فيها بيختفي من قدام المستخدم بالكامل.
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

/** بيحضّر محفظة رصيدها صفر (إيراد ومصروف متساويين) وبيأرشفها */
async function archivedWalletWithHistory(amount = 500) {
  const [arch, target] = harness.api().wallets;
  await harness.api().addTransaction({ type: 'income', amount, walletId: arch.id, date: '2026-08-01' });
  const expenseId = await harness.api().addTransaction({
    type: 'expense', amount, walletId: arch.id, date: '2026-08-02',
  });
  await harness.waitForData(api => api.transactions.length === 2);

  await harness.api().archiveWallet(arch.id, {});
  await harness.waitForData(api => !!api.wallets.find(w => w.id === arch.id)?.archived);

  expect(balanceOf(arch.id)).toBe(0);
  return { arch, target, expenseId };
}

function balanceOf(walletId: string) {
  const api = harness.api();
  const w = api.wallets.find(x => x.id === walletId)!;
  return Math.round(walletBalance(api.transactions, walletId, w.openingBalance) * 100) / 100;
}

describe('تعديل عملية على محفظة مؤرشفة', () => {
  it('تعديل لأقل: المؤرشفة بترجع صفر والفرق بيروح للشغالة', async () => {
    const { arch, target, expenseId } = await archivedWalletWithHistory(500);
    const targetBefore = balanceOf(target.id);

    await harness.api().updateTransaction(
      expenseId,
      { amount: 400 },
      [{ archivedWalletId: arch.id, archivedWalletName: arch.name, targetWalletId: target.id, delta: 100 }]
    );
    await harness.waitForData(api => api.transactions.length === 3);

    expect(balanceOf(arch.id)).toBe(0);
    expect(balanceOf(target.id)).toBe(targetBefore + 100);
  });

  it('تعديل لأكتر: الفرق بيتغطى من الشغالة', async () => {
    const { arch, target, expenseId } = await archivedWalletWithHistory(500);
    const targetBefore = balanceOf(target.id);

    await harness.api().updateTransaction(
      expenseId,
      { amount: 600 },
      [{ archivedWalletId: arch.id, archivedWalletName: arch.name, targetWalletId: target.id, delta: -100 }]
    );
    await harness.waitForData(api => api.transactions.length === 3);

    expect(balanceOf(arch.id)).toBe(0);
    expect(balanceOf(target.id)).toBe(targetBefore - 100);
  });

  it('تحويل التسوية بيتكتب بعلامته واسم المحفظة في الملاحظة', async () => {
    const { arch, target, expenseId } = await archivedWalletWithHistory(500);
    await harness.api().updateTransaction(
      expenseId,
      { amount: 400 },
      [{ archivedWalletId: arch.id, archivedWalletName: arch.name, targetWalletId: target.id, delta: 100 }]
    );
    await harness.waitForData(api => api.transactions.length === 3);

    const st = harness.api().transactions.find(t => t.isSettlement)!;
    expect(st).toBeDefined();
    expect(st.type).toBe('withdraw');
    expect(st.amount).toBe(100);
    expect(st.walletId).toBe(arch.id);
    expect(st.toWalletId).toBe(target.id);
    expect(st.archivedWalletId).toBe(arch.id);
    expect(st.note).toBe(`تسوية رصيد ${arch.name} (مؤرشفة)`);
  });

  it('التسوية سحب، فمش داخلة في إجمالي المصروف ولا الإيراد', async () => {
    const { arch, target, expenseId } = await archivedWalletWithHistory(500);
    await harness.api().updateTransaction(
      expenseId,
      { amount: 400 },
      [{ archivedWalletId: arch.id, archivedWalletName: arch.name, targetWalletId: target.id, delta: 100 }]
    );
    await harness.waitForData(api => api.transactions.length === 3);

    const txs = harness.api().transactions;
    expect(txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)).toBe(400);
    expect(txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)).toBe(500);
  });
});

describe('حذف عملية على محفظة مؤرشفة', () => {
  it('الحذف + التسوية في دفعة واحدة، والرصيد صفر', async () => {
    const { arch, target, expenseId } = await archivedWalletWithHistory(500);
    const targetBefore = balanceOf(target.id);

    await harness.api().deleteTransaction(
      expenseId,
      [{ archivedWalletId: arch.id, archivedWalletName: arch.name, targetWalletId: target.id, delta: 500 }]
    );
    await harness.waitForData(api => !api.transactions.some(t => t.id === expenseId));
    await settle();

    expect(balanceOf(arch.id)).toBe(0);
    expect(balanceOf(target.id)).toBe(targetBefore + 500);
    expect(harness.api().transactions.filter(t => t.isSettlement)).toHaveLength(1);
  });

  it('حذف تحويل التسوية نفسه بيمشي بنفس القاعدة والرصيد بيفضل صفر', async () => {
    const { arch, target, expenseId } = await archivedWalletWithHistory(500);
    await harness.api().updateTransaction(
      expenseId,
      { amount: 400 },
      [{ archivedWalletId: arch.id, archivedWalletName: arch.name, targetWalletId: target.id, delta: 100 }]
    );
    await harness.waitForData(api => api.transactions.length === 3);
    const settlementTx = harness.api().transactions.find(t => t.isSettlement)!;

    // حذف التسوية بيرجّع المؤرشفة لـ+100، فمحتاجة تسوية جديدة بنفس القيمة
    await harness.api().deleteTransaction(
      settlementTx.id,
      [{ archivedWalletId: arch.id, archivedWalletName: arch.name, targetWalletId: target.id, delta: 100 }]
    );
    await harness.waitForData(api => !api.transactions.some(t => t.id === settlementTx.id));
    await settle();

    expect(balanceOf(arch.id)).toBe(0);
  });

  it('من غير تسوية الرصيد بيبقى مش صفر — ده السبب اللي الميزة موجودة عشانه', async () => {
    const { arch, expenseId } = await archivedWalletWithHistory(500);
    await harness.api().deleteTransaction(expenseId);
    await harness.waitForData(api => !api.transactions.some(t => t.id === expenseId));
    await settle();

    expect(balanceOf(arch.id)).toBe(500);
  });
});

describe('الحذف والتسوية والسجل المرتبط: دفعة واحدة', () => {
  it('حذف دفعة دين على محفظة مؤرشفة بيشيلها من الدين ويسوّي في نفس الوقت', async () => {
    const [arch, target] = harness.api().wallets;
    await harness.api().addDebt({
      direction: 'i_owe', personName: 'أحمد', totalAmount: 1000,
      isInstallment: false, date: '2026-08-01',
    });
    await harness.waitForData(api => api.debts.length === 1);
    const debtId = harness.api().debts[0].id;

    // إيراد يخلي رصيد المؤرشفة صفر بعد الدفعة
    await harness.api().addTransaction({ type: 'income', amount: 300, walletId: arch.id, date: '2026-08-01' });
    await harness.api().addDebtPayment(debtId, 300, arch.id, '2026-08-05');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);

    await harness.api().archiveWallet(arch.id, {});
    await harness.waitForData(api => !!api.wallets.find(w => w.id === arch.id)?.archived);
    expect(balanceOf(arch.id)).toBe(0);

    const paymentTxId = harness.api().debts[0].payments[0].transactionId!;
    await harness.api().deleteTransaction(
      paymentTxId,
      [{ archivedWalletId: arch.id, archivedWalletName: arch.name, targetWalletId: target.id, delta: 300 }]
    );
    await harness.waitForData(api => (api.debts[0]?.payments || []).length === 0);
    await settle();

    // الدفعة اتشالت من الدين، والعملية اتمسحت، والمؤرشفة رجعت صفر — كلهم مع بعض
    expect(harness.api().debts[0].payments).toHaveLength(0);
    expect(harness.api().transactions.some(t => t.id === paymentTxId)).toBe(false);
    expect(balanceOf(arch.id)).toBe(0);
    expect(balanceOf(target.id)).toBe(300);
  });
});

describe('قواعد Firestore لحقول التسوية', () => {
  it('عملية من غير حقول التسوية لسه بتتقبل', async () => {
    const wallet = harness.api().wallets[0];
    await harness.api().addTransaction({ type: 'expense', amount: 50, walletId: wallet.id, date: '2026-08-01' });
    await harness.waitForData(api => api.transactions.length === 1);
    expect(harness.api().transactions[0].isSettlement).toBeUndefined();
  });

  it('عملية بحقول تسوية صح بتتقبل وبتوصل السيرفر', async () => {
    const { arch, target, expenseId } = await archivedWalletWithHistory(500);
    await harness.api().updateTransaction(
      expenseId,
      { amount: 400 },
      [{ archivedWalletId: arch.id, archivedWalletName: arch.name, targetWalletId: target.id, delta: 100 }]
    );
    await harness.waitForData(api => api.transactions.some(t => t.isSettlement));
    // لو القواعد رفضت، فايربيز كانت هتشيلها من الكاش المحلي
    await settle();
    expect(harness.api().transactions.filter(t => t.isSettlement)).toHaveLength(1);
  });
});
