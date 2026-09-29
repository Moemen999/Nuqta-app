import { deleteField, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { installmentValue } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * دين قديم من غير `installmentAmount` (2026-09-29، خطوة 6): أول ما يتلمس
 * (دفعة، زيادة، مسح واحدة منهم) القيمة المحسوبة بالعدد القديم بتتكتب في نفس
 * الذرة، فمبتتحركش لما العدد يتغيّر.
 *
 * **اتكتب في جلسة سحابية ومااتشغلش** — مفيش محاكي هناك. لازم يتشغّل بـ
 * `npm run test:db` على الجهاز قبل الدمج.
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

/** 6000 على 6، وبعدين `installmentAmount` بيتشال — شكل دين من قبل الميزة */
async function legacyDebt() {
  const w = harness.api().wallets[0];
  await harness.api().addDebt({
    direction: 'i_owe', personName: 'صاحبي', totalAmount: 6000, isInstallment: true, installmentCount: 6,
    walletId: w.id, date: '2026-01-01',
  });
  await harness.waitForData(api => api.debts.length === 1);
  const debtId = debt().id;
  await updateDoc(doc(db, 'users', getMockUid(), 'debts', debtId), { installmentAmount: deleteField() });
  await harness.waitForData(api => api.debts[0].installmentAmount === undefined);
  return { debtId, walletId: w.id };
}

it('دفعة أقل من القسط على دين قديم ← العدد 7، والقسط يتثبّت 1000 (مش 857)', async () => {
  const { debtId, walletId } = await legacyDebt();
  expect((await harness.api().addDebtPayment(debtId, 700, walletId, '2026-01-15')).outcome).toBe('done');
  await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
  expect(debt().installmentCount).toBe(7);
  expect(debt().installmentAmount).toBe(1000);
  expect(installmentValue(debt())).toBe(1000);
});

it('زيادة على دين قديم ← القسط يتثبّت بالعدد القديم', async () => {
  const { debtId, walletId } = await legacyDebt();
  expect((await harness.api().addDebtIncrease(debtId, 2000, '2026-02-01', walletId)).outcome).toBe('done');
  await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
  expect(debt().installmentAmount).toBe(1000);
  expect(debt().installmentCount).toBe(8);
});

it('مسح دفعة من دين قديم ← القسط يتثبّت برضه', async () => {
  const { debtId, walletId } = await legacyDebt();
  expect((await harness.api().addDebtPayment(debtId, 1000, walletId, '2026-01-15')).outcome).toBe('done');
  await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
  // القيمة اتثبّتت مع الدفعة؛ نشيلها تاني عشان نختبر المسح لوحده
  await updateDoc(doc(db, 'users', getMockUid(), 'debts', debtId), { installmentAmount: deleteField() });
  await harness.waitForData(api => api.debts[0].installmentAmount === undefined);
  const paymentId = debt().payments[0].id;
  expect(await harness.api().deleteDebtPayment(debtId, paymentId)).toBe('done');
  await harness.waitForData(api => (api.debts[0].payments || []).length === 0);
  expect(debt().installmentAmount).toBe(1000);
});

it('دين عنده قيمة متخزّنة ← مبتتغيّرش', async () => {
  const w = harness.api().wallets[0];
  await harness.api().addDebt({
    direction: 'i_owe', personName: 'صاحبي', totalAmount: 6500, isInstallment: true, installmentCount: 6,
    walletId: w.id, date: '2026-01-01',
  });
  await harness.waitForData(api => api.debts.length === 1);
  expect((await harness.api().addDebtPayment(debt().id, 500, w.id, '2026-01-15')).outcome).toBe('done');
  await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
  expect(debt().installmentAmount).toBe(1083.33);
});
