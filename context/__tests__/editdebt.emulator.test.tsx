import { clearFirestore, settle, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * تعديل بيانات الدين بيمر على قواعد فايرستور الحقيقية.
 *
 * الخطر المحدد هنا: القواعد بتطلب personName و totalAmount و direction في
 * كل كتابة. لما نبعت updateDoc بحقل واحد بس، فايرستور بيحكم على السجل
 * **بعد** الدمج — فلازم نتأكد بالتجربة إن ده فعلاً بيعدّي، لأن لو غلط
 * هيفشل بصمت في الإنتاج بـ permission-denied.
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

async function makeDebt(extra: Record<string, unknown> = {}) {
  const w = harness.api().wallets[0];
  await harness.api().addDebt({
    direction: 'owed_to_me', personName: 'كريم', totalAmount: 1000,
    isInstallment: false, walletId: w.id, date: '2026-03-10', ...extra,
  });
  await harness.waitForData(api => api.debts.length === 1);
  return harness.api().debts[0].id;
}

describe('updateDebt', () => {
  it('تعديل الاسم بيعدّي على القواعد الحقيقية وبيتحفظ', async () => {
    const id = await makeDebt();
    await harness.api().updateDebt(id, { personName: 'كريم عبد الله' });
    await harness.waitForData(api => api.debts[0].personName === 'كريم عبد الله');
    await settle();
    expect(harness.api().debts[0].personName).toBe('كريم عبد الله');
  });

  it('بيشيل المسافات الزايدة من الاسم', async () => {
    const id = await makeDebt();
    await harness.api().updateDebt(id, { personName: '  كريم  ' });
    await harness.waitForData(api => api.debts[0].personName === 'كريم');
  });

  it('اسم فاضي مبيتحفظش — الدين بيفضل باسمه', async () => {
    const id = await makeDebt();
    await harness.api().updateDebt(id, { personName: '   ' });
    await settle();
    expect(harness.api().debts[0].personName).toBe('كريم');
  });

  it('الرقم الفاضي بيتشال من السجل خالص مش بيتحفظ نص فاضي', async () => {
    const id = await makeDebt({ personPhone: '01001234567' });
    await harness.waitForData(api => api.debts[0].personPhone === '01001234567');

    await harness.api().updateDebt(id, { personPhone: '' });
    await harness.waitForData(api => api.debts[0].personPhone === undefined);
    await settle();
    // مهم: مش '' — عشان الكارت ميعرضش سطر رقم فاضي
    expect('personPhone' in harness.api().debts[0]).toBe(false);
  });

  it('إلغاء الربط بجهة الاتصال بيشيل personContactId', async () => {
    const id = await makeDebt({ personContactId: 'c1', personPhone: '01001234567' });
    await harness.waitForData(api => api.debts[0].personContactId === 'c1');

    await harness.api().updateDebt(id, { personContactId: '' });
    await harness.waitForData(api => api.debts[0].personContactId === undefined);
    await settle();
    expect('personContactId' in harness.api().debts[0]).toBe(false);
  });

  it('مبيلمسش المبلغ ولا الاتجاه ولا العملية المرتبطة', async () => {
    const id = await makeDebt();
    const before = harness.api().debts[0];
    const txBefore = harness.api().transactions.length;

    await harness.api().updateDebt(id, { personName: 'اسم تاني', note: 'ملاحظة' });
    await harness.waitForData(api => api.debts[0].personName === 'اسم تاني');
    await settle();

    const after = harness.api().debts[0];
    expect(after.totalAmount).toBe(before.totalAmount);
    expect(after.direction).toBe(before.direction);
    expect(after.initialTransactionId).toBe(before.initialTransactionId);
    expect(harness.api().transactions).toHaveLength(txBefore);
  });

  it('باتش فاضي مبيعملش أي كتابة', async () => {
    const id = await makeDebt();
    await harness.api().updateDebt(id, {});
    await settle();
    expect(harness.api().debts[0].personName).toBe('كريم');
  });
});
