import { collection, doc, getDocFromServer, setDoc, updateDoc, waitForPendingWrites } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import {
  debtRemaining, installmentCountFor, installmentResidueIgnored, installmentResidueKnown, installmentResidueOf,
  suggestedInstallmentPayment, increaseLeftoverChoice, lastInstalmentOf, leftoverSeen, pinInstallmentAmount,
} from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { increaseAsBefore } from '@/test-utils/increaseAsBefore';

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
    expect(server.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12, increasesTotal: 0 });
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
    expect(server.installmentResidue).toEqual({ amount: 0.01, forInstallment: 333.33, over: 3, increasesTotal: 0 });

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
    expect((await serverDebt(debtId)).installmentResidue).toEqual({ amount: 0.02, forInstallment: 107.14, over: 7, increasesTotal: 0 });

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
    expect(d.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12, increasesTotal: 0 });
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
    ['مسح دفعة', 'payment', { amount: 16.71, forInstallment: 83.33, over: 13, increasesTotal: 100 }],
    ['زيادة', 'increase', { amount: -16.62, forInstallment: 83.33, over: 14, increasesTotal: 150 }],
    ['مسح زيادة', 'deleteIncrease', { amount: 0.04, forInstallment: 83.33, over: 12, increasesTotal: 0 }],
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
    else outcome = ((await increaseAsBefore(harness.api(), ref.id, 50, '2026-02-01')) as { outcome: string }).outcome;
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
    expect(server.installmentResidue).toEqual({ amount: 0.06, forInstallment: 83.33, over: 18, increasesTotal: 500 });

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
    expect(server.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12, increasesTotal: 0 });
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
    expect(server.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12, increasesTotal: 0 });
  });
});

/**
 * مبالغ مينفعش تتسجل (2026-09-30): مفيش ولا حاجة توصل السيرفر، والنتيجة 'failed'.
 * **اتكتبت في جلسة سحابية وما اتشغلتش.**
 */
describe('مبالغ مش صالحة مبتوصلش فايرستور', () => {
  it('زيادة 1e307 (Infinity بعد التقريب) ← failed، والدين والعمليات زي ما هم', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    const before = await serverDebt(debtId);
    const txBefore = harness.api().transactions.length;
    const res = await harness.api().addDebtIncrease(debtId, 1e307, '2026-02-01', walletId);
    expect(res.outcome).toBe('failed');
    const after = await serverDebt(debtId);
    expect(after.increases).toEqual(before.increases);
    expect(after.installmentCount).toBe(before.installmentCount);
    expect(harness.api().transactions.length).toBe(txBefore);
  });

  it.each([Number('1e999'), NaN, 0.004, -5])('دفعة %p ← failed ومفيش دفعة ولا عملية', async (amount) => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    const txBefore = harness.api().transactions.length;
    const res = await harness.api().addDebtPayment(debtId, amount, walletId, '2026-02-01');
    expect(res.outcome).toBe('failed');
    expect((await serverDebt(debtId)).payments).toEqual([]);
    expect(harness.api().transactions.length).toBe(txBefore);
  });

  it('دين أقساط بعدد 1e20 (مبيتخزّنش) ← بيرمي قبل العملية المالية، ومفيش عملية يتيمة', async () => {
    const w = harness.api().wallets[0];
    const txBefore = harness.api().transactions.length;
    await expect(harness.api().addDebt({
      direction: 'owed_to_me', personName: 'عدد بايظ', totalAmount: 1000,
      isInstallment: true, installmentCount: 1e20, walletId: w.id, date: '2026-01-01',
    })).rejects.toThrow();
    await waitForPendingWrites(db);
    expect(harness.api().debts).toHaveLength(0);
    expect(harness.api().transactions.length).toBe(txBefore);
  });

  it('دين بمبلغ Infinity ← بيرمي، ومفيش دين ولا عملية', async () => {
    const w = harness.api().wallets[0];
    const txBefore = harness.api().transactions.length;
    await expect(harness.api().addDebt({
      direction: 'owed_to_me', personName: 'مبلغ بايظ', totalAmount: Number('1e999'),
      isInstallment: false, walletId: w.id, date: '2026-01-01',
    })).rejects.toThrow();
    await waitForPendingWrites(db);
    expect(harness.api().debts).toHaveLength(0);
    expect(harness.api().transactions.length).toBe(txBefore);
  });
});

/**
 * تعديل عملية مربوطة (بند 14) على دين بفرق تقريب (2026-10-30، بند 8): الأصل
 * والزيادة جوه الخطة، فالفرق لازم يتطوي في نفس الذرة. قبل كده كان بيفضل على
 * الخطة القديمة: 1000/12 ← 2000 كان بيكتب 25 قسط مش 24 (money-reviewer).
 */
describe('تعديل عملية مربوطة بيطوي الفرق', () => {
  /** اللي المودال شافه وقت ما اتفتح — من العملية نفسها */
  function seen(txId: string) {
    const t = harness.api().transactions.find(x => x.id === txId)!;
    return { amount: t.amount, walletId: t.walletId, type: t.type };
  }

  it('أصل 1000 على 12 ← 2000: 24 قسط وفرق 0.08 على السيرفر، والرسالة بتقول 24', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    await harness.waitForData(api => api.transactions.length === 1);
    const initTxId = harness.api().debts[0].initialTransactionId!;
    const r = await harness.api().updateDebtLinkedTransaction(initTxId, { amount: 2000, walletId, date: '2026-01-01' }, seen(initTxId));
    expect(r.outcome).toBe('done');
    expect(r.note).toBe('بعد التعديل، الأقساط بقت 24 بدل 12.');
    const s = await serverDebt(debtId);
    expect(s.totalAmount).toBe(2000);
    expect(s.installmentCount).toBe(24);
    expect(s.installmentResidue).toEqual({ amount: 0.08, forInstallment: 83.33, over: 24, increasesTotal: 0 });
  });

  // silent-failure-hunter (جولة 1 على خطوة 2): فرق متجاهَل (فوق الإجمالي) كان هيبقى
  // "سليم" بعد ما الأصل يكبر ← بيتشال من السيرفر (deleteField) مش بيتعدّ بيه
  it('فرق متجاهَل + تعديل الأصل ← بيتشال من السيرفر، والعدد بالقاعدة القديمة', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    await harness.waitForData(api => api.transactions.length === 1);
    await setDoc(doc(db, 'users', getMockUid(), 'debts', debtId),
      { installmentResidue: { amount: 500, forInstallment: 83.33, over: 12 } }, { merge: true });
    await harness.waitForData(api => api.debts[0].installmentResidue?.amount === 500);
    const initTxId = harness.api().debts[0].initialTransactionId!;
    const r = await harness.api().updateDebtLinkedTransaction(initTxId, { amount: 2000, walletId, date: '2026-01-01' }, seen(initTxId));
    expect(r.outcome).toBe('done');
    const s = await serverDebt(debtId);
    expect(s.totalAmount).toBe(2000);
    expect('installmentResidue' in s).toBe(false);
    expect(s.installmentCount).toBe(24);
  });

  it('زيادة 500 ← 600 وبعدين مسحها: الفرق والعدد بيرجعوا زي ما الدين اتعمل', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    const inc = await harness.api().addDebtIncrease(debtId, 500, '2026-02-01', walletId);
    expect(inc.outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1 && api.transactions.length === 2);
    const entry = harness.api().debts[0].increases[0];
    const r = await harness.api().updateDebtLinkedTransaction(entry.transactionId!, { amount: 600, walletId, date: '2026-02-01' }, seen(entry.transactionId!));
    expect(r.outcome).toBe('done');
    await harness.waitForData(api => api.debts[0].increases[0].amount === 600);

    expect(await harness.api().deleteDebtIncrease(debtId, entry.id)).toBe('done');
    await harness.waitForData(api => (api.debts[0].increases || []).length === 0);
    const s = await serverDebt(debtId);
    expect(s.installmentCount).toBe(12);
    expect(s.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12, increasesTotal: 0 });
    expect(suggestedInstallmentPayment(harness.api().debts[0])).toBe(83.33);
  });
});

/**
 * بصمة الفرق (`increasesTotal`، قرار مؤمن D2، بند 8) على فايرستور حقيقي، بكتابات خام
 * (`updateDoc`/`setDoc`) بتحاكي **نسخة قديمة** من التطبيق: بتكتب `increases` أو
 * `installmentCount`/`installmentAmount` من غير ما تلمس `installmentResidue`. الفرق
 * المتخزّن بيتقري بس لو البصمة = مجموع زيادات الدين اللي على السيرفر.
 *
 * **اتكتبت من غير محاكي (مفيش في الجلسة دي)** — `npm run test:db` على اللابتوب.
 */
describe('بصمة الزيادات: كتابات خام من نسخة قديمة', () => {
  const debtRef = (id: string) => doc(db, 'users', getMockUid(), 'debts', id);
  const entry = (id: string, amount: number) => ({ id, date: '2026-02-01', amount });
  const current = () => harness.api().debts[0];

  /**
   * 1 على 24: قسط 0.04 وفرق 0.04. بعد زيادة 1 (الإجمالي 2): القاعدة القديمة 50 قسط
   * (2 ÷ 0.04 − 0.005)، ولو الفرق اتقرى غلط كان 49 — العدد هو اللي بيثبت مين اتقرى
   */
  it('`{increases}` بس من نسخة قديمة ← الفرق متجاهَل والعدد بالقاعدة القديمة', async () => {
    const { debtId } = await makeDebt(1, 24);
    expect(installmentResidueKnown(current())).toBe(true);
    expect(installmentCountFor(current())).toBe(24);

    await updateDoc(debtRef(debtId), { increases: [entry('old', 1)] });
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
    expect(installmentResidueIgnored(current())).toBe(true);
    expect(installmentResidueOf(current())).toBeNull();
    expect(installmentCountFor(current())).toBe(50);
  });

  it('نسخة قديمة أضافت زيادة وبعدين مسحتها بنفس المبلغ ← الفرق مقبول تاني', async () => {
    const { debtId } = await makeDebt(1, 24);
    await updateDoc(debtRef(debtId), { increases: [entry('old', 1)] });
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
    expect(installmentResidueIgnored(current())).toBe(true);

    await updateDoc(debtRef(debtId), { increases: [] });
    await harness.waitForData(api => (api.debts[0].increases || []).length === 0);
    expect(installmentResidueKnown(current())).toBe(true);
    expect(installmentResidueIgnored(current())).toBe(false);
    expect(installmentCountFor(current())).toBe(24);
  });

  it('`{installmentCount, installmentAmount}` بقسط مختلف من نسخة قديمة ← متجاهَل والعدد بالقاعدة القديمة', async () => {
    const { debtId } = await makeDebt(1000, 12);
    await updateDoc(debtRef(debtId), { installmentCount: 13, installmentAmount: 76.92 });
    await harness.waitForData(api => api.debts[0].installmentCount === 13);
    expect(installmentResidueIgnored(current())).toBe(true);
    // ceil(1000 ÷ 76.92 − 0.005) = 13
    expect(installmentCountFor(current())).toBe(13);
  });

  it('فرق من غير بصمة (شكل قبل D2) ← متجاهَل', async () => {
    const { debtId } = await makeDebt(1000, 12);
    // `updateDoc` على المفتاح نفسه بيبدّل الخريطة كلها (من غير بصمة) — `setDoc` بـmerge
    // كان بيدمجها مع القديمة فالبصمة كانت بتفضل
    await updateDoc(debtRef(debtId), { installmentResidue: { amount: 0.04, forInstallment: 83.33, over: 12 } });
    await harness.waitForData(api => api.debts[0].installmentResidue?.increasesTotal === undefined);
    expect(installmentResidueIgnored(current())).toBe(true);
    expect(installmentResidueOf(current())).toBeNull();
  });
});

describe('كتابات النسخة الجديدة بتبصم بمجموع الزيادات على السيرفر', () => {
  /** مجموع زيادات السيرفر بالقروش ÷ 100 — مستقل عن `sumIncreasesCents` */
  const serverSum = (s: Record<string, any>) =>
    Math.round(((s.increases || []) as { amount: number }[]).reduce((a, e) => a + e.amount, 0) * 100) / 100;

  it('addDebt: بصمة 0', async () => {
    const { debtId } = await makeDebt(1000, 12);
    const s = await serverDebt(debtId);
    expect(s.installmentResidue.increasesTotal).toBe(serverSum(s));
    expect(s.installmentResidue.increasesTotal).toBe(0);
  });

  it('setInstallmentCount: بصمة = زيادات الدين الحالية (500)', async () => {
    const { walletId, debtId } = await makeDebt(1000, 4);
    await harness.api().addDebtIncrease(debtId, 500, '2026-02-01', walletId);
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
    expect(await harness.api().setInstallmentCount(debtId, 6)).toBe(true);
    await harness.waitForData(api => api.debts[0].installmentCount === 6);
    const s = await serverDebt(debtId);
    expect(s.installmentResidue.increasesTotal).toBe(serverSum(s));
    expect(s.installmentResidue.increasesTotal).toBe(500);
    expect(installmentResidueKnown(harness.api().debts[0])).toBe(true);
  });

  it('addDebtIncrease ثم deleteDebtIncrease: البصمة 500 وبعدين 0، والفرق مقبول في الحالتين', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    await harness.api().addDebtIncrease(debtId, 500, '2026-02-01', walletId);
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
    const afterAdd = await serverDebt(debtId);
    expect(afterAdd.installmentResidue.increasesTotal).toBe(serverSum(afterAdd));
    expect(afterAdd.installmentResidue.increasesTotal).toBe(500);
    expect(installmentResidueKnown(harness.api().debts[0])).toBe(true);

    const entryId = harness.api().debts[0].increases[0].id;
    expect(await harness.api().deleteDebtIncrease(debtId, entryId)).toBe('done');
    await harness.waitForData(api => (api.debts[0].increases || []).length === 0);
    const afterDelete = await serverDebt(debtId);
    expect(afterDelete.installmentResidue.increasesTotal).toBe(serverSum(afterDelete));
    expect(afterDelete.installmentResidue.increasesTotal).toBe(0);
    expect(installmentResidueKnown(harness.api().debts[0])).toBe(true);
  });
});

/**
 * بند 8 D1: الباقي من الزيادة بيتسأل عنه، والسيرفر بيتأكد منه جوه الذرة
 * (`addDebtIncrease` معامل خامس). 1000 على 12 + 100 ← الباقي 16.71.
 * السيرفر بيقارن الباقي **والعدد وآخر قسط** للاختيار (جولة 1، money-reviewer).
 */
describe('الباقي من الزيادة (D1) على المحاكي', () => {
  it('A (يتضاف على آخر قسط): علم lastAbsorbs على السيرفر والعدد 13', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    const res = await harness.api().addDebtIncrease(debtId, 100, '2026-02-01', walletId, { mode: 'absorb', amount: 16.71, count: 13, last: 100.04 });
    expect(res.outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
    const s = await serverDebt(debtId);
    expect(s.installmentResidue).toEqual({ amount: 16.71, forInstallment: 83.33, over: 13, increasesTotal: 100, lastAbsorbs: true });
    expect(s.installmentCount).toBe(13);
    expect(installmentCountFor(harness.api().debts[0])).toBe(13);
  });

  it('B (قسط منفصل): من غير علم والعدد 14', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    const res = await harness.api().addDebtIncrease(debtId, 100, '2026-02-01', walletId, { mode: 'separate', amount: 16.71, count: 14, last: 16.71 });
    expect(res.outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
    const s = await serverDebt(debtId);
    expect(s.installmentResidue).toEqual({ amount: 16.71, forInstallment: 83.33, over: 13, increasesTotal: 100 });
    expect('lastAbsorbs' in s.installmentResidue).toBe(false);
    expect(s.installmentCount).toBe(14);
  });

  it('الباقي المبعوت مش مطابق للسيرفر (16.70 بدل 16.71) ← leftover-changed ومفيش حاجة اتكتبت', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    const txBefore = harness.api().transactions.length;
    const res = await harness.api().addDebtIncrease(debtId, 100, '2026-02-01', walletId, { mode: 'absorb', amount: 16.7, count: 13, last: 100.04 });
    expect(res.outcome).toBe('leftover-changed');
    const s = await serverDebt(debtId);
    expect(s.increases || []).toEqual([]);
    expect(s.installmentCount).toBe(12);
    expect(s.installmentResidue).toEqual({ amount: 0.04, forInstallment: 83.33, over: 12, increasesTotal: 0 });
    expect(harness.api().transactions.length).toBe(txBefore);
  });

  it('فيه سؤال ومفيش leftover اتبعت ← leftover-changed ومفيش حاجة اتكتبت', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    const txBefore = harness.api().transactions.length;
    const res = await harness.api().addDebtIncrease(debtId, 100, '2026-02-01', walletId);
    expect(res.outcome).toBe('leftover-changed');
    const s = await serverDebt(debtId);
    expect(s.increases || []).toEqual([]);
    expect(s.installmentCount).toBe(12);
    expect(harness.api().transactions.length).toBe(txBefore);
  });

  it('مفيش سؤال (+0.01 تقريب) ← من غير leftover بيتسجل عادي، ولو اتبعت leftover ← leftover-changed', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    const bad = await harness.api().addDebtIncrease(debtId, 0.01, '2026-02-01', walletId, { mode: 'absorb', amount: 0.05, count: 12, last: 83.38 });
    expect(bad.outcome).toBe('leftover-changed');
    const ok = await harness.api().addDebtIncrease(debtId, 0.01, '2026-02-01', walletId);
    expect(ok.outcome).toBe('done');
  });

  it('الباقي نفسه بس العدد أو آخر قسط المبعوتين مختلفين عن السيرفر ← leftover-changed ومفيش حاجة اتكتبت', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    // الشاشة شافت 13 وآخرهم 100.04؛ السيرفر عنده نفس الباقي بعدد مختلف
    const res = await harness.api().addDebtIncrease(debtId, 100, '2026-02-01', walletId, { mode: 'absorb', amount: 16.71, count: 12, last: 100.04 });
    expect(res.outcome).toBe('leftover-changed');
    const res2 = await harness.api().addDebtIncrease(debtId, 100, '2026-02-01', walletId, { mode: 'absorb', amount: 16.71, count: 13, last: 100.03 });
    expect(res2.outcome).toBe('leftover-changed');
    const s = await serverDebt(debtId);
    expect(s.increases || []).toEqual([]);
    expect(s.installmentCount).toBe(12);
  });

  it('دفعة 100 (مش 83.33) قبل الزيادة: الباقي المعروض هو الذيل الحقيقي 0.04، والمكتوب بيطابقه', async () => {
    const { walletId, debtId } = await makeDebt(1000, 12);
    expect((await harness.api().addDebtPayment(debtId, 100, walletId, '2026-01-15')).outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    const d = harness.api().debts[0];
    const choice = increaseLeftoverChoice({ ...d, ...pinInstallmentAmount(d) }, 100)!;
    expect(choice.leftover).toBe(0.04);
    expect(choice.separate).toEqual({ count: 14, last: 0.04 });
    const res = await harness.api().addDebtIncrease(debtId, 100, '2026-02-01', walletId, leftoverSeen(choice, 'separate'));
    expect(res.outcome).toBe('done');
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
    const after = harness.api().debts[0];
    expect(installmentCountFor(after)).toBe(14);
    expect(lastInstalmentOf(after)).toBe(0.04);
  });
});
