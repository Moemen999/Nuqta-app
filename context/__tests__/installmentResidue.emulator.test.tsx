import { collection, doc, getDocFromServer, setDoc, waitForPendingWrites } from 'firebase/firestore';
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

/**
 * الدين زي ما هو **على السيرفر** — `addDebt` و`setInstallmentCount` مبيستنوش
 * التأكيد (`addDocNoWait`/`track`)، فالنسخة المحلية بتعدّي حتى لو القواعد
 * رفضت الكتابة (database-reviewer).
 */
async function serverDebt(id: string) {
  await waitForPendingWrites(db);
  const snap = await getDocFromServer(doc(db, 'users', getMockUid(), 'debts', id));
  expect(snap.exists()).toBe(true);
  return snap.data()!;
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
    const { debtId } = await makeDebt(1000, 12);
    const d = harness.api().debts[0];
    expect(installmentCountFor(d)).toBe(12);
    const server = await serverDebt(debtId);
    expect(server.installmentAmount).toBe(83.33);
    expect(server.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12 });
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
    const server = await serverDebt(debtId);
    expect(server.installmentCount).toBe(4);
    expect(server.installmentAmount).toBe(333.33);
    expect(server.installmentResidue).toEqual({ amount: 0.01, forInstallment: 333.33, over: 3 });

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
    expect((await serverDebt(debtId)).installmentResidue).toEqual({ amount: 0.02, forInstallment: 107.14, over: 7 });

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
    const before = await serverDebt(debtId);
    expect(await harness.api().setInstallmentCount(debtId, 11)).toBe(false);
    const after = await serverDebt(debtId);
    expect(after.installmentAmount).toBe(before.installmentAmount);
    expect(after.installmentCount).toBe(before.installmentCount);
    expect(after.installmentResidue).toEqual(before.installmentResidue);
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
    const d = await serverDebt(ref.id);
    expect(d.installmentAmount).toBe(83.33);
    expect(d.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12 });
    expect(d.installmentCount).toBe(12);
  });

  /**
   * التثبيت بيتكتب جوه `t.update` في المسارات الذرية التلاتة التانية كمان —
   * والقواعد لازم تقبل الخريطة المتداخلة فيهم (database-reviewer). الدفعة
   * والزيادة القديمة متسجلين على الورق (من غير محفظة) عشان المسح ميلمسش رصيد.
   */
  // الزيادة القديمة (100) بتدخل خطة التثبيت (2026-09-30): 12 × 83.33 + 0.04 + 100
  // = 13 × 83.33 + 16.71. +50 ← 14 × 83.33 − 16.62. مسح الـ100 ← خطة الـ1000 بالظبط
  it.each([
    ['مسح دفعة', 'payment', { amount: 16.71, forInstallment: 83.33, over: 13 }],
    ['زيادة', 'increase', { amount: -16.62, forInstallment: 83.33, over: 14 }],
    ['مسح زيادة', 'deleteIncrease', { amount: 0.04, forInstallment: 83.33, over: 12 }],
  ] as const)('%s على دين قديم ← القسط والفرق بيتثبّتوا على السيرفر', async (_, op, residue) => {
    const ref = doc(collection(db, 'users', getMockUid(), 'debts'));
    await setDoc(ref, {
      direction: 'i_owe', personName: 'دين قديم', totalAmount: 1000,
      date: '2025-01-01', isInstallment: true, installmentCount: 12,
      createdAt: '2025-01-01T00:00:00.000Z',
      payments: [{ id: 'p0', date: '2025-02-01', amount: 83.33 }],
      increases: [{ id: 'i0', date: '2025-03-01', amount: 100 }],
    });
    await harness.waitForData(api => api.debts.some(d => d.id === ref.id));

    let outcome: string;
    if (op === 'payment') outcome = await harness.api().deleteDebtPayment(ref.id, 'p0');
    else if (op === 'deleteIncrease') outcome = await harness.api().deleteDebtIncrease(ref.id, 'i0');
    else outcome = (await harness.api().addDebtIncrease(ref.id, 50, '2026-02-01')).outcome;
    expect(outcome).toBe('done');

    const d = await serverDebt(ref.id);
    expect(d.installmentAmount).toBe(83.33);
    expect(d.installmentResidue).toEqual(residue);
  });
});

describe('زيادة بتسيب تقريب بس (قرار مؤمن 2026-09-29)', () => {
  it('1000 على 12 + 500 ← 18 قسط والقسط الأخير 83.39، والفرق على السيرفر', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    const res = await harness.api().addDebtIncrease(debtId, 500, '2026-02-01', walletId);
    expect(res.outcome).toBe('done');
    expect(res.note).toBe('بعد الزيادة، الأقساط بقت 18 بدل 12.');
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
    const server = await serverDebt(debtId);
    expect(server.installmentCount).toBe(18);
    expect(server.installmentResidue).toEqual({ amount: 0.06, forInstallment: 83.33, over: 18 });

    const amounts: number[] = [];
    for (let i = 0; i < 18; i++) {
      amounts.push((await paySuggested(debtId, walletId)).amount);
      expect(harness.api().debts[0].installmentCount).toBe(18);
    }
    expect(amounts[17]).toBe(83.39);
    expect(Math.abs(debtRemaining(harness.api().debts[0]))).toBeLessThan(0.005);
  });

  it('مسح الزيادة ← الفرق والعدد بيرجعوا زي الإنشاء بالظبط', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    await harness.api().addDebtIncrease(debtId, 500, '2026-02-01', walletId);
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
    const entryId = harness.api().debts[0].increases[0].id;
    expect(await harness.api().deleteDebtIncrease(debtId, entryId)).toBe('done');
    await harness.waitForData(api => (api.debts[0].increases || []).length === 0);
    const server = await serverDebt(debtId);
    expect(server.installmentCount).toBe(12);
    expect(server.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12 });
  });

  it('...ومسحها عن طريق مسح العملية المربوطة بيها (مش ذري) بيعمل نفس الحاجة', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    await harness.api().addDebtIncrease(debtId, 500, '2026-02-01', walletId);
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
    const txId = harness.api().debts[0].increases[0].transactionId!;
    await harness.api().deleteTransaction(txId);
    await harness.waitForData(api => (api.debts[0].increases || []).length === 0);
    const server = await serverDebt(debtId);
    expect(server.installmentCount).toBe(12);
    expect(server.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12 });
  });
});
