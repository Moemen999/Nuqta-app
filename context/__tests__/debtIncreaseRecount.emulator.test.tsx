import { deleteField, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import type { Debt } from '@/context/DataContext';
import { installmentProgressLabel, walletBalance } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * زيادة على دين بالقسط لازم تعيد حساب **عدد** الأقساط (2026-09-29).
 *
 * العدد معناه "الدفعات اللي حصلت + المتبقي ÷ قيمة القسط"، والمتبقي بيشمل
 * الزيادات. `addDebtIncrease` كان بيكتب الزيادة بس، فدين 6000 على 6 أقساط
 * بعد زيادة 2000 كان بيفضل يقول "القسط 1 من 6" لحد أول دفعة. مسح الزيادة
 * (`deleteDebtIncrease`) كان بيعيد الحساب من الأول — ده نفس الحساب في الاتجاه
 * التاني، جوه نفس العملية الذرية.
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

async function makeDebt(over: Partial<{ isInstallment: boolean; installmentCount: number; direction: Debt['direction'] }> = {}) {
  const w = harness.api().wallets[0];
  await harness.api().addDebt({
    direction: over.direction ?? 'i_owe', personName: 'صاحبي', totalAmount: 6000,
    isInstallment: over.isInstallment ?? true,
    installmentCount: (over.isInstallment ?? true) ? (over.installmentCount ?? 6) : undefined,
    walletId: w.id, date: '2026-01-01',
  });
  await harness.waitForData(api => api.debts.length === 1);
  return { debtId: debt().id, walletId: w.id };
}

async function increase(debtId: string, amount: number, walletId?: string) {
  const before = (debt().increases || []).length;
  expect(await harness.api().addDebtIncrease(debtId, amount, '2026-02-01', walletId)).toBe('done');
  await harness.waitForData(api => (api.debts[0].increases || []).length === before + 1);
}

async function pay(debtId: string, amount: number, walletId: string) {
  const before = (debt().payments || []).length;
  expect((await harness.api().addDebtPayment(debtId, amount, walletId, '2026-01-15')).outcome).toBe('done');
  await harness.waitForData(api => (api.debts[0].payments || []).length === before + 1);
}

it('6000 على 6 + زيادة 2000 من محفظة ← 8 أقساط، والقسط لسه 1000', async () => {
  const { debtId, walletId } = await makeDebt();
  await increase(debtId, 2000, walletId);
  expect(debt().installmentCount).toBe(8);
  expect(debt().installmentAmount).toBe(1000);
  expect(installmentProgressLabel(debt())).toBe('القسط 1 من 8');
});

it('زيادة على الورق (من غير محفظة) ← العدد بيتحسب برضه، ومفيش عملية مالية', async () => {
  const { debtId } = await makeDebt();
  const txBefore = harness.api().transactions.length;
  await increase(debtId, 500);
  // 6500 ÷ 1000 مجبورة لفوق
  expect(debt().installmentCount).toBe(7);
  expect(harness.api().transactions.length).toBe(txBefore);
});

it('بعد دفعة: الدفعات اللي حصلت + الباقي ÷ القسط', async () => {
  const { debtId, walletId } = await makeDebt();
  await pay(debtId, 1000, walletId);
  expect(debt().installmentCount).toBe(6);
  await increase(debtId, 1000, walletId);
  // دفعة واحدة + (6000 − 1000 + 1000) ÷ 1000
  expect(debt().installmentCount).toBe(7);
  expect(installmentProgressLabel(debt())).toBe('القسط 2 من 7');
});

it('دين اتسدد بالكامل + زيادة ← بيرجع مفتوح بالعدد الصح', async () => {
  const { debtId, walletId } = await makeDebt();
  await pay(debtId, 6000, walletId);
  expect(debt().installmentCount).toBe(1);
  await increase(debtId, 1500, walletId);
  // دفعة واحدة + 1500 ÷ 1000 مجبورة لفوق
  expect(debt().installmentCount).toBe(3);
});

it('زيادة بمبلغ أقل من قسط ← قسط زيادة واحد، مش صفر', async () => {
  const { debtId, walletId } = await makeDebt();
  // 300 مش 1: `installmentCountFor` بيطرح 0.005 قسط قبل التقريب لفوق، فأي باقي
  // أقل من نص في المية من القسط مبيتعدّش قسط لوحده — ده سلوك الدالة المشتركة
  // في الدفع والمسح كمان، مش حاجة الزيادة بتعملها
  await increase(debtId, 300, walletId);
  expect(debt().installmentCount).toBe(7);
});

it('زيادة وبعدين مسحها ← العدد بيرجع زي ما كان', async () => {
  const { debtId, walletId } = await makeDebt();
  await increase(debtId, 2000, walletId);
  expect(debt().installmentCount).toBe(8);
  expect(await harness.api().deleteDebtIncrease(debtId, debt().increases[0].id)).toBe('done');
  await harness.waitForData(api => (api.debts[0].increases || []).length === 0);
  expect(debt().installmentCount).toBe(6);
});

it('دين مش بالقسط ← مفيش عدد بيتكتب', async () => {
  const { debtId, walletId } = await makeDebt({ isInstallment: false });
  await increase(debtId, 2000, walletId);
  expect(debt().installmentCount).toBeUndefined();
});

it.each(['owed_to_me', 'i_owe'] as const)('%s: الرصيد بيتحرك بمبلغ الزيادة بالظبط (إعادة الحساب مبتلمسش الفلوس)', async direction => {
  const { debtId, walletId } = await makeDebt({ direction });
  const w = () => harness.api().wallets.find(x => x.id === walletId)!;
  const bal = () => walletBalance(harness.api().transactions, walletId, w().openingBalance);
  const before = bal();
  await increase(debtId, 2000, walletId);
  await harness.waitForData(() => bal() !== before);
  expect(bal() - before).toBe(direction === 'owed_to_me' ? -2000 : 2000);
  expect(debt().installmentCount).toBe(8);
});

it('دين قديم من غير installmentAmount (القسط = الإجمالي ÷ العدد) ← العدد بيتحسب بنفس القسط', async () => {
  const { debtId, walletId } = await makeDebt();
  await updateDoc(doc(db, 'users', getMockUid(), 'debts', debtId), { installmentAmount: deleteField() });
  await harness.waitForData(api => api.debts[0].installmentAmount === undefined);
  await increase(debtId, 2000, walletId);
  expect(debt().installmentCount).toBe(8);
  expect(debt().installmentAmount).toBeUndefined();
});

it('العدد المتخزّن قديم/غلط ← الزيادة بتكتب العدد الصح', async () => {
  const { debtId, walletId } = await makeDebt();
  await updateDoc(doc(db, 'users', getMockUid(), 'debts', debtId), { installmentCount: 2 });
  await harness.waitForData(api => api.debts[0].installmentCount === 2);
  await increase(debtId, 1000, walletId);
  // القسط متخزّن 1000، فالعدد من المتبقي مش من القديم: 7000 ÷ 1000
  expect(debt().installmentCount).toBe(7);
});

it('مبلغ مش رقم حقيقي (Infinity) ← بيترفض ومفيش حاجة بتتكتب', async () => {
  const { debtId, walletId } = await makeDebt();
  const txBefore = harness.api().transactions.length;
  expect(await harness.api().addDebtIncrease(debtId, Infinity, '2026-02-01', walletId)).toBe('failed');
  expect(await harness.api().addDebtIncrease(debtId, NaN, '2026-02-01', walletId)).toBe('failed');
  expect(debt().increases || []).toHaveLength(0);
  expect(debt().installmentCount).toBe(6);
  expect(harness.api().transactions.length).toBe(txBefore);
});
