import { installmentProgressLabel, installmentValue } from '@/lib/finance';
import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * الأقساط بتكتب فعلاً في فايرستور: `installmentAmount` عند الإنشاء،
 * و`installmentCount` بعد كل دفعة بقيمة مختلفة.
 *
 * الاختبارات دي بتعدّي على **قواعد الأمان الحقيقية** (نفس `firestore.rules`
 * اللي بتروح للإنتاج)، فهي كمان بتثبّت إن الحقلين الجداد مسموح بيهم — ولو
 * حد ضيّق القاعدة بعدين، الاختبار ده هو اللي هيقع مش المستخدم.
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

async function makeInstallmentDebt(total = 6000, count = 6) {
  const w = harness.api().wallets[0];
  await harness.api().addDebt({
    direction: 'i_owe', personName: 'شركة التقسيط', totalAmount: total,
    isInstallment: true, installmentCount: count, walletId: w.id, date: '2026-01-01',
  });
  await harness.waitForData(api => api.debts.length === 1);
  return { walletId: w.id, debtId: harness.api().debts[0].id };
}

describe('إنشاء دين بأقساط', () => {
  it('بيتخزّن قيمة القسط مع العدد', async () => {
    await makeInstallmentDebt();
    const d = harness.api().debts[0];
    expect(d.installmentCount).toBe(6);
    expect(d.installmentAmount).toBe(1000);
    expect(installmentValue(d)).toBe(1000);
    expect(installmentProgressLabel(d)).toBe('القسط 1 من 6');
  });

  it('الدين العادي مفيهوش قيمة قسط', async () => {
    const w = harness.api().wallets[0];
    await harness.api().addDebt({
      direction: 'i_owe', personName: 'حد', totalAmount: 500,
      isInstallment: false, walletId: w.id, date: '2026-01-01',
    });
    await harness.waitForData(api => api.debts.length === 1);
    expect(harness.api().debts[0].installmentAmount).toBeUndefined();
  });
});

describe('الدفع بيظبط العدد', () => {
  it('دفعة بقيمة القسط مبتغيّرش حاجة', async () => {
    const { walletId, debtId } = await makeInstallmentDebt();
    const note = await harness.api().addDebtPayment(debtId, 1000, walletId, '2026-02-01');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);

    expect(note).toBeNull();
    expect(harness.api().debts[0].installmentCount).toBe(6);
    expect(installmentProgressLabel(harness.api().debts[0])).toBe('القسط 2 من 6');
  });

  it('دفع أقل ⇒ العدد بيزيد والرسالة بتتقال', async () => {
    const { walletId, debtId } = await makeInstallmentDebt();
    const note = await harness.api().addDebtPayment(debtId, 700, walletId, '2026-02-01');
    await harness.waitForData(api => api.debts[0].installmentCount === 7);

    expect(note).toBe('دفعت 700 بدل 1,000، الأقساط بقت 7.');
    // والقسط نفسه ما اتغيرش — دي كل الفكرة
    expect(harness.api().debts[0].installmentAmount).toBe(1000);
  });

  it('دفع أكتر ⇒ العدد بيقل', async () => {
    const { walletId, debtId } = await makeInstallmentDebt();
    const note = await harness.api().addDebtPayment(debtId, 3000, walletId, '2026-02-01');
    await harness.waitForData(api => api.debts[0].installmentCount === 4);

    expect(note).toBe('دفعت 3,000 بدل 1,000، الأقساط بقت 4.');
    expect(harness.api().debts[0].installmentAmount).toBe(1000);
  });

  it('الدفعة الأخيرة بتقفل الدين من غير كلام عن أقساط', async () => {
    const { walletId, debtId } = await makeInstallmentDebt();
    const note = await harness.api().addDebtPayment(debtId, 6000, walletId, '2026-02-01');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);

    expect(note).toBeNull();
    expect(harness.api().debts[0].installmentCount).toBe(1);
    expect(installmentProgressLabel(harness.api().debts[0])).toBeNull();
  });

  it('الزيادة عن الإجمالي بتفضل زي ما هي والعدد بيتظبط بعدها', async () => {
    const { walletId, debtId } = await makeInstallmentDebt();
    await harness.api().addDebtPayment(debtId, 9000, walletId, '2026-02-01');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);

    // المبلغ ما اتقصّش — نفس قرار `overpay.emulator.test.tsx`
    expect(harness.api().debts[0].payments[0].amount).toBe(9000);
    expect(harness.api().debts[0].installmentCount).toBe(1);
  });

  it('دفعات ورا بعض بتتحسب من المتبقي كل مرة', async () => {
    const { walletId, debtId } = await makeInstallmentDebt();
    await harness.api().addDebtPayment(debtId, 1000, walletId, '2026-02-01');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    await harness.api().addDebtPayment(debtId, 500, walletId, '2026-03-01');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 2);

    // باقي 4500 ÷ 1000 = 4.5 ← 5 باقية، + دفعتين = 7
    expect(harness.api().debts[0].installmentCount).toBe(7);
    expect(installmentProgressLabel(harness.api().debts[0])).toBe('القسط 3 من 7');
  });
});

describe('تعديل العدد بإيد المستخدم', () => {
  it('بيكتب العدد والقيمة الجديدة', async () => {
    const { debtId } = await makeInstallmentDebt();
    const ok = await harness.api().setInstallmentCount(debtId, 12);
    expect(ok).toBe(true);
    await harness.waitForData(api => api.debts[0].installmentCount === 12);
    expect(harness.api().debts[0].installmentAmount).toBe(500);
  });

  it('بعد دفعة، المتبقي هو اللي بيتقسّم', async () => {
    const { walletId, debtId } = await makeInstallmentDebt();
    await harness.api().addDebtPayment(debtId, 2000, walletId, '2026-02-01');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);

    await harness.api().setInstallmentCount(debtId, 5);
    await harness.waitForData(api => api.debts[0].installmentCount === 5);
    // باقي 4000 على (5 − 1) = 1000
    expect(harness.api().debts[0].installmentAmount).toBe(1000);
  });

  it('عدد أقل من الدفعات اللي حصلت بيترفض من غير أي كتابة', async () => {
    const { walletId, debtId } = await makeInstallmentDebt();
    // لازم ننتظر كل دفعة توصل قبل التانية: `addDebtPayment` بيبني المصفوفة
    // من الحالة المحلية، فدفعتين ورا بعض من غير انتظار بتضيّع واحدة. ده سباق
    // **موجود أصلاً** في الكود ومترفوع كملاحظة منفصلة — مش من التغيير ده.
    await harness.api().addDebtPayment(debtId, 1000, walletId, '2026-02-01');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    await harness.api().addDebtPayment(debtId, 1000, walletId, '2026-03-01');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 2);

    const before = harness.api().debts[0].installmentCount;
    expect(await harness.api().setInstallmentCount(debtId, 2)).toBe(false);
    expect(harness.api().debts[0].installmentCount).toBe(before);
  });
});

describe('مسح دفعة بيرجّع العدد', () => {
  /**
   * دفعة غيّرت العدد من 6 لـ7 وبعدين اتمسحت: العدد كان بيفضل 7 للأبد،
   * فالكارت يقول "القسط 1 من 7" لدين حسابه 6.
   */
  it('حذف الدفعة مباشرةً', async () => {
    const { walletId, debtId } = await makeInstallmentDebt();
    await harness.api().addDebtPayment(debtId, 700, walletId, '2026-02-01');
    await harness.waitForData(api => api.debts[0].installmentCount === 7);

    const paymentId = harness.api().debts[0].payments[0].id;
    await harness.api().deleteDebtPayment(debtId, paymentId);
    await harness.waitForData(api => (api.debts[0].payments || []).length === 0);

    expect(harness.api().debts[0].installmentCount).toBe(6);
  });

  it('وحذف العملية المربوطة بيها بيعمل نفس الحاجة', async () => {
    const { walletId, debtId } = await makeInstallmentDebt();
    await harness.api().addDebtPayment(debtId, 700, walletId, '2026-02-01');
    await harness.waitForData(api => api.debts[0].installmentCount === 7);

    const txId = harness.api().debts[0].payments[0].transactionId!;
    await harness.api().deleteTransaction(txId);
    await harness.waitForData(api => (api.debts[0].payments || []).length === 0);

    expect(harness.api().debts[0].installmentCount).toBe(6);
  });
});

describe('الديون القديمة من غير الحقل الجديد', () => {
  /**
   * **دين قديم حقيقي**: بنكتبه على فايرستور مباشرةً من غير
   * `installmentAmount` خالص. النسخة الأولى من الاختبار ده كانت بتنادي
   * `updateDebt` وتفتكر إنها شالت الحقل — و`updateDebt` أصلاً بيكتب حقول
   * `DebtMetadata` بس ومبيلمسش الحقل ده، فالاختبار كان بيعدّي على دين عادي.
   */
  it('بيتقبل من القواعد وبيشتغل بالحسبة القديمة', async () => {
    const uid = getMockUid();
    const ref = doc(collection(db, 'users', uid, 'debts'));
    await setDoc(ref, {
      direction: 'i_owe', personName: 'دين قديم', totalAmount: 6000,
      date: '2025-01-01', isInstallment: true, installmentCount: 6,
      createdAt: '2025-01-01T00:00:00.000Z', payments: [], increases: [],
    });
    await harness.waitForData(api => api.debts.some(d => d.personName === 'دين قديم'));

    const legacy = harness.api().debts.find(d => d.personName === 'دين قديم')!;
    expect(legacy.installmentAmount).toBeUndefined();
    expect(installmentValue(legacy)).toBe(1000);
    expect(installmentProgressLabel(legacy)).toBe('القسط 1 من 6');
  });

  it('والدفع عليه بيظبط العدد زي أي دين تاني', async () => {
    const uid = getMockUid();
    const ref = doc(collection(db, 'users', uid, 'debts'));
    await setDoc(ref, {
      direction: 'i_owe', personName: 'دين قديم', totalAmount: 6000,
      date: '2025-01-01', isInstallment: true, installmentCount: 6,
      createdAt: '2025-01-01T00:00:00.000Z', payments: [], increases: [],
    });
    await harness.waitForData(api => api.debts.some(d => d.personName === 'دين قديم'));

    const legacy = harness.api().debts.find(d => d.personName === 'دين قديم')!;
    const w = harness.api().wallets[0];
    const note = await harness.api().addDebtPayment(legacy.id, 700, w.id, '2026-02-01');
    await harness.waitForData(
      api => api.debts.find(d => d.id === legacy.id)?.installmentCount === 7
    );
    expect(note).toBe('دفعت 700 بدل 1,000، الأقساط بقت 7.');
  });
});
