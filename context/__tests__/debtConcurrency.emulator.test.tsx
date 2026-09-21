import { debtPaid, debtRemaining, walletBalance } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * **السباق اللي الاختبارات دي موجودة عشانه.**
 *
 * `addDebtPayment` و`addDebtIncrease` كانوا بيقروا `debt.payments` من حالة
 * الرياكت وبيكتبوا المصفوفة كلها تاني. يعني دفعتين في نفس اللحظة — جهازين، أو
 * دوستين قبل ما الأولى ترجع — الاتنين بيشوفوا نفس المصفوفة القديمة، والتانية
 * بتكتب فوق الأولى. **دفعة فلوس بتختفي من الكشف والرصيد.**
 *
 * دلوقتي الاتنين بيقروا من السيرفر جوه `runTransaction`، فالتانية بتلاقي
 * الأولى. الاختبارات دي بتشغّل النداءين **متوازيين فعلاً** (`Promise.all`)
 * على محاكي فايرستور الحقيقي — لو حد رجّع الكتابة لنمط المصفوفة القديم،
 * هما اللي هيقعوا.
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

async function makeDebt(opts: { total?: number; installment?: boolean; count?: number } = {}) {
  const w = harness.api().wallets[0];
  await harness.api().addDebt({
    direction: 'i_owe',
    personName: 'صاحبي',
    totalAmount: opts.total ?? 6000,
    isInstallment: opts.installment === true,
    ...(opts.installment ? { installmentCount: opts.count ?? 6 } : {}),
    walletId: w.id,
    date: '2026-01-01',
  });
  await harness.waitForData(api => api.debts.length === 1);
  return { walletId: w.id, debtId: harness.api().debts[0].id };
}

describe('دفعتين في نفس اللحظة', () => {
  it('الاتنين بينزلوا، ومحدش بيمسح التاني', async () => {
    const { walletId, debtId } = await makeDebt();

    const [a, b] = await Promise.all([
      harness.api().addDebtPayment(debtId, 1000, walletId, '2026-02-01'),
      harness.api().addDebtPayment(debtId, 500, walletId, '2026-02-02'),
    ]);
    expect(a.outcome).toBe('done');
    expect(b.outcome).toBe('done');

    await harness.waitForData(api => (api.debts[0].payments || []).length === 2);
    const debt = harness.api().debts[0];
    expect(debtPaid(debt)).toBe(1500);
    expect(debtRemaining(debt)).toBe(4500);

    // ومعاهم عمليتين مالية، واحدة لكل دفعة — مش واحدة يتيمة
    const linked = (debt.payments || []).map(p => p.transactionId);
    expect(linked.filter(Boolean)).toHaveLength(2);
    expect(new Set(linked).size).toBe(2);
  });

  it('الرصيد بيخصم الدفعتين مش واحدة', async () => {
    const { walletId, debtId } = await makeDebt();
    const w = harness.api().wallets[0];
    const before = walletBalance(harness.api().transactions, w.id, w.openingBalance);

    await Promise.all([
      harness.api().addDebtPayment(debtId, 1000, walletId, '2026-02-01'),
      harness.api().addDebtPayment(debtId, 500, walletId, '2026-02-02'),
    ]);
    await harness.waitForData(api => (api.debts[0].payments || []).length === 2);
    await harness.waitForData(api => api.transactions.filter(t => t.note?.includes('سداد دين')).length === 2);

    const after = walletBalance(harness.api().transactions, w.id, w.openingBalance);
    expect(before - after).toBe(1500);
  });

  it('وتلات دفعات مع بعض برضه بينزلوا كلهم', async () => {
    const { walletId, debtId } = await makeDebt();
    const results = await Promise.all([
      harness.api().addDebtPayment(debtId, 100, walletId, '2026-02-01'),
      harness.api().addDebtPayment(debtId, 200, walletId, '2026-02-02'),
      harness.api().addDebtPayment(debtId, 300, walletId, '2026-02-03'),
    ]);
    expect(results.every(r => r.outcome === 'done')).toBe(true);

    await harness.waitForData(api => (api.debts[0].payments || []).length === 3);
    expect(debtPaid(harness.api().debts[0])).toBe(600);
  });
});

describe('زيادة ودفعة في نفس اللحظة', () => {
  it('الزيادتين بينزلوا الاتنين', async () => {
    const { walletId, debtId } = await makeDebt();

    const outcomes = await Promise.all([
      harness.api().addDebtIncrease(debtId, 250, '2026-02-01', walletId),
      harness.api().addDebtIncrease(debtId, 750, '2026-02-02', walletId),
    ]);
    expect(outcomes).toEqual(['done', 'done']);

    await harness.waitForData(api => (api.debts[0].increases || []).length === 2);
    // 6000 + 250 + 750
    expect(debtRemaining(harness.api().debts[0])).toBe(7000);
  });

  it('زيادة ودفعة مع بعض مبيمسحوش بعض', async () => {
    const { walletId, debtId } = await makeDebt();

    await Promise.all([
      harness.api().addDebtIncrease(debtId, 1000, '2026-02-01', walletId),
      harness.api().addDebtPayment(debtId, 400, walletId, '2026-02-02'),
    ]);

    await harness.waitForData(api =>
      (api.debts[0].increases || []).length === 1 && (api.debts[0].payments || []).length === 1);
    // 6000 + 1000 − 400
    expect(debtRemaining(harness.api().debts[0])).toBe(6600);
  });
});

describe('الحذف بيرجّع العدد', () => {
  it('مسح الدفعة بيرجّع عدد الأقساط لأصله', async () => {
    const { walletId, debtId } = await makeDebt({ installment: true });
    // 700 بدل 1000 ⇒ العدد بيطلع 7
    await harness.api().addDebtPayment(debtId, 700, walletId, '2026-02-01');
    await harness.waitForData(api => api.debts[0].installmentCount === 7);

    const paymentId = harness.api().debts[0].payments[0].id;
    expect(await harness.api().deleteDebtPayment(debtId, paymentId)).toBe('done');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 0);

    expect(harness.api().debts[0].installmentCount).toBe(6);
    expect(debtPaid(harness.api().debts[0])).toBe(0);
  });

  it('والعملية المالية بتتمسح مع الدفعة في نفس الذرة', async () => {
    const { walletId, debtId } = await makeDebt({ installment: true });
    await harness.api().addDebtPayment(debtId, 700, walletId, '2026-02-01');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    const txId = harness.api().debts[0].payments[0].transactionId!;
    await harness.waitForData(api => api.transactions.some(t => t.id === txId));

    await harness.api().deleteDebtPayment(debtId, harness.api().debts[0].payments[0].id);
    await harness.waitForData(api => (api.debts[0].payments || []).length === 0);
    await harness.waitForData(api => !api.transactions.some(t => t.id === txId));
  });

  it('حذف دفعة اتمسحت خلاص بيرجّع "تمام" من غير ما يكسر حاجة', async () => {
    const { walletId, debtId } = await makeDebt({ installment: true });
    await harness.api().addDebtPayment(debtId, 700, walletId, '2026-02-01');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    const paymentId = harness.api().debts[0].payments[0].id;

    expect(await harness.api().deleteDebtPayment(debtId, paymentId)).toBe('done');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 0);
    expect(await harness.api().deleteDebtPayment(debtId, paymentId)).toBe('done');
    expect(harness.api().debts[0].installmentCount).toBe(6);
  });

  it('ومسح الزيادة بيرجّع المتبقي', async () => {
    const { walletId, debtId } = await makeDebt();
    await harness.api().addDebtIncrease(debtId, 1000, '2026-02-01', walletId);
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);

    const entryId = harness.api().debts[0].increases[0].id;
    expect(await harness.api().deleteDebtIncrease(debtId, entryId)).toBe('done');
    await harness.waitForData(api => (api.debts[0].increases || []).length === 0);
    expect(debtRemaining(harness.api().debts[0])).toBe(6000);
  });
});

describe('الدفع الزيادة ما اتغيرش', () => {
  /**
   * التحويل لعملية ذرية **مش** المفروض يغيّر إن المستخدم يقدر يدفع أكتر من
   * المتبقي — التحذير مكانه الشاشة (`overpayCheck`)، والداتا بتسجّل اللي حصل.
   */
  it('دفعة أكبر من المتبقي لسه بتتسجل زي ما هي', async () => {
    const { walletId, debtId } = await makeDebt({ total: 1000 });
    const { outcome } = await harness.api().addDebtPayment(debtId, 1500, walletId, '2026-02-01');
    expect(outcome).toBe('done');

    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    expect(debtPaid(harness.api().debts[0])).toBe(1500);
    expect(debtRemaining(harness.api().debts[0])).toBe(-500);
  });

  it('ودفعتين زيادة مع بعض بينزلوا الاتنين برضه', async () => {
    const { walletId, debtId } = await makeDebt({ total: 1000 });
    await Promise.all([
      harness.api().addDebtPayment(debtId, 1500, walletId, '2026-02-01'),
      harness.api().addDebtPayment(debtId, 1500, walletId, '2026-02-02'),
    ]);
    await harness.waitForData(api => (api.debts[0].payments || []).length === 2);
    expect(debtPaid(harness.api().debts[0])).toBe(3000);
  });
});

describe('الدين مش موجود', () => {
  it('الدفع لدين اتمسح بيرجّع "ما اتسجلش" ومبيكتبش عملية يتيمة', async () => {
    const { walletId, debtId } = await makeDebt();
    const txCountBefore = harness.api().transactions.length;

    await harness.api().deleteDebt(debtId);
    await harness.waitForData(api => api.debts.length === 0);

    const { outcome } = await harness.api().addDebtPayment(debtId, 500, walletId, '2026-02-01');
    expect(outcome).toBe('failed');
    expect(harness.api().transactions.length).toBe(txCountBefore - 1);
  });
});
