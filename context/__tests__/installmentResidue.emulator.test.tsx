import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { debtRemaining, installmentCountFor, suggestedInstallmentPayment } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * فرق تقريب القسط (`installmentResidue`، 2026-09-30) على فايرستور الحقيقي
 * وقواعد الأمان الحقيقية: بيتكتب مع القسط، والدفع بالاقتراح بيخلّص الدين في
 * عدده بالظبط حتى بعد تعديل العدد بإيد المستخدم.
 *
 * **اتكتب في جلسة سحابية ومااتشغلش** (مفيش محاكي هناك) — `npm run test:db`
 * على اللابتوب قبل ما الفرع يتدمج.
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

async function makeDebt(total: number, count: number) {
  const w = harness.api().wallets[0];
  await harness.api().addDebt({
    direction: 'i_owe', personName: 'شركة التقسيط', totalAmount: total,
    isInstallment: true, installmentCount: count, walletId: w.id, date: '2026-01-01',
  });
  await harness.waitForData(api => api.debts.length === 1);
  return { walletId: w.id, debtId: harness.api().debts[0].id };
}

/** بيدفع اقتراح المودال مرة، ويستنى الدفعة توصل */
async function paySuggested(debtId: string, walletId: string) {
  const d = harness.api().debts.find(x => x.id === debtId)!;
  const n = (d.payments || []).length;
  const amount = suggestedInstallmentPayment(d);
  const res = await harness.api().addDebtPayment(debtId, amount, walletId, '2026-02-01');
  expect(res.outcome).toBe('done');
  await harness.waitForData(api => (api.debts.find(x => x.id === debtId)!.payments || []).length === n + 1);
  return { amount, note: res.note };
}

describe('الإنشاء بيكتب الفرق مع القسط', () => {
  it('1000 على 12 ← قسط 83.33 وفرق 0.04، والقواعد قابلاه', async () => {
    await makeDebt(1000, 12);
    const d = harness.api().debts[0];
    expect(d.installmentAmount).toBe(83.33);
    expect(d.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33 });
    expect(installmentCountFor(d)).toBe(12);
  });
});

describe('تعديل العدد وبعدين الدفع للآخر', () => {
  it('1500 على 3، اتدفع 500، والعدد بقى 4 ← 4 طول الطريق والدين بيخلص', async () => {
    const { walletId, debtId } = await makeDebt(1500, 3);
    await harness.api().addDebtPayment(debtId, 500, walletId, '2026-01-15');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);

    expect(await harness.api().setInstallmentCount(debtId, 4)).toBe(true);
    await harness.waitForData(api => api.debts[0].installmentCount === 4);
    // باقي 1000 على 3 = 333.33، الفرق 1000 − 999.99 = 0.01 — في نفس الكتابة
    expect(harness.api().debts[0].installmentAmount).toBe(333.33);
    expect(harness.api().debts[0].installmentResidue).toEqual({ amount: 0.01, forInstallment: 333.33 });

    const amounts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { amount, note } = await paySuggested(debtId, walletId);
      amounts.push(amount);
      expect(note).toBeNull();
      expect(harness.api().debts[0].installmentCount).toBe(4);
    }
    expect(amounts).toEqual([333.33, 333.33, 333.34]);
    expect(Math.abs(debtRemaining(harness.api().debts[0]))).toBeLessThan(0.005);
  });

  it('1000 على 4، اتدفع 250، والعدد بقى 8 ← 8 طول الطريق وآخر قسط 107.16', async () => {
    const { walletId, debtId } = await makeDebt(1000, 4);
    await harness.api().addDebtPayment(debtId, 250, walletId, '2026-01-15');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);

    await harness.api().setInstallmentCount(debtId, 8);
    await harness.waitForData(api => api.debts[0].installmentCount === 8);
    expect(harness.api().debts[0].installmentResidue).toEqual({ amount: 0.02, forInstallment: 107.14 });

    const amounts: number[] = [];
    for (let i = 0; i < 7; i++) {
      amounts.push((await paySuggested(debtId, walletId)).amount);
      expect(harness.api().debts[0].installmentCount).toBe(8);
    }
    expect(amounts[6]).toBe(107.16);
    expect(Math.abs(debtRemaining(harness.api().debts[0]))).toBeLessThan(0.005);
  });

  it('قسط هيطلع أقل من قرش ← مرفوض ومفيش كتابة', async () => {
    const { walletId, debtId } = await makeDebt(100, 1);
    await harness.api().addDebtPayment(debtId, 99.96, walletId, '2026-01-15');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    const before = harness.api().debts[0];
    expect(await harness.api().setInstallmentCount(debtId, 11)).toBe(false);
    expect(harness.api().debts[0].installmentAmount).toBe(before.installmentAmount);
    expect(harness.api().debts[0].installmentCount).toBe(before.installmentCount);
  });
});

describe('ديون قبل الحقل ده', () => {
  it('قسط متخزّن من غير فرق ← القواعد قابلاه، والدفع بيكمل بالقاعدة القديمة من غير ما يكتب فرق', async () => {
    const ref = doc(collection(db, 'users', getMockUid(), 'debts'));
    await setDoc(ref, {
      direction: 'i_owe', personName: 'دين قديم', totalAmount: 1000,
      date: '2025-01-01', isInstallment: true, installmentCount: 12, installmentAmount: 83.33,
      createdAt: '2025-01-01T00:00:00.000Z', payments: [], increases: [],
    });
    await harness.waitForData(api => api.debts.some(d => d.personName === 'دين قديم'));
    const w = harness.api().wallets[0];

    const amounts: number[] = [];
    for (let i = 0; i < 12; i++) amounts.push((await paySuggested(ref.id, w.id)).amount);
    const d = harness.api().debts.find(x => x.id === ref.id)!;
    // الاقتراح ماشي مع قاعدة العدد القديمة: القسط الأخير 83.37 بيقفله
    expect(amounts[11]).toBe(83.37);
    expect(d.installmentCount).toBe(12);
    expect(d.installmentResidue).toBeUndefined();
  });

  it('من غير قسط متخزّن (خطوة 6) ← أول دفعة بتثبّت القسط والفرق', async () => {
    const ref = doc(collection(db, 'users', getMockUid(), 'debts'));
    await setDoc(ref, {
      direction: 'i_owe', personName: 'دين أقدم', totalAmount: 1000,
      date: '2025-01-01', isInstallment: true, installmentCount: 12,
      createdAt: '2025-01-01T00:00:00.000Z', payments: [], increases: [],
    });
    await harness.waitForData(api => api.debts.some(d => d.personName === 'دين أقدم'));
    const w = harness.api().wallets[0];
    await paySuggested(ref.id, w.id);
    const d = harness.api().debts.find(x => x.id === ref.id)!;
    expect(d.installmentAmount).toBe(83.33);
    expect(d.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33 });
    expect(d.installmentCount).toBe(12);
  });
});
