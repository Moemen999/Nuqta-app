import { debtExcess, debtPaidLabel, debtRemaining, walletBalance } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * الدفعة الأكبر من المتبقي: **بتتسجّل**، مش بتتمنع ومش بتتقصّ.
 *
 * الاختبار ده موجود عشان يثبّت قرار، مش عشان يوصف سلوك. روبو لقى إن دفعة
 * 35,630 على دين 550 بتعدّي من غير أي سؤال، والقرار كان نحذّر المستخدم في
 * الواجهة (`overpayCheck` + تأكيد في `DebtPaymentModal`) لكن **نسيب المبلغ
 * زي ما هو** لو أكّد — لأن الدفع الزيادة شرعي (تقريب لفوق، "خلي الباقي").
 *
 * لو حد جه بعدين و"صلّح" ده بإنه يقصّ المبلغ على المتبقي، الاختبار ده هيقع.
 * وده المقصود: تقصير المبلغ من غير ما المستخدم يعرف بيغيّر فلوس بالسكوت،
 * وده بالظبط نوع الغلط اللي كنا بنشيله.
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

describe('دفعة أكبر من المتبقي', () => {
  it('بتتسجّل بالمبلغ كامل والرصيد بيتحرك بيه — من غير قص', async () => {
    const w = harness.api().wallets[0];
    await harness.api().addDebt({
      direction: 'owed_to_me', personName: 'محمد محمود', totalAmount: 550,
      isInstallment: false, walletId: w.id, date: '2026-03-10',
    });
    await harness.waitForData(api => api.debts.length === 1 && api.transactions.length === 1);
    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(-550);

    // نفس أرقام روبو بالظبط
    const debtId = harness.api().debts[0].id;
    await harness.api().addDebtPayment(debtId, 35630, w.id, '2026-03-20');
    await harness.waitForData(api => api.transactions.length === 2);

    const payment = harness.api().debts[0].payments[0];
    expect(payment.amount).toBe(35630);

    // الرصيد اتحرك بالمبلغ كله: -550 + 35,630
    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(35080);
  });

  it('الدين بيبان زيادة مش كسر مستحيل', async () => {
    const w = harness.api().wallets[0];
    await harness.api().addDebt({
      direction: 'owed_to_me', personName: 'محمد محمود', totalAmount: 550,
      isInstallment: false, walletId: w.id, date: '2026-03-10',
    });
    await harness.waitForData(api => api.debts.length === 1);

    const debtId = harness.api().debts[0].id;
    await harness.api().addDebtPayment(debtId, 35630, w.id, '2026-03-20');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);

    const d = harness.api().debts[0];
    expect(debtRemaining(d)).toBe(-35080);
    expect(debtExcess(d)).toBe(35080);
    expect(debtPaidLabel(d)).toBe('اتسدد بالكامل · زيادة 35,080 ج.م');
  });

  it('حذف الدفعة الزيادة بيرجّع الرصيد زي ما كان', async () => {
    const w = harness.api().wallets[0];
    await harness.api().addDebt({
      direction: 'owed_to_me', personName: 'محمد محمود', totalAmount: 550,
      isInstallment: false, walletId: w.id, date: '2026-03-10',
    });
    await harness.waitForData(api => api.debts.length === 1);

    const debtId = harness.api().debts[0].id;
    await harness.api().addDebtPayment(debtId, 35630, w.id, '2026-03-20');
    await harness.waitForData(api => api.transactions.length === 2);

    const paymentId = harness.api().debts[0].payments[0].id;
    await harness.api().deleteDebtPayment(debtId, paymentId);
    await harness.waitForData(api => api.transactions.length === 1);

    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(-550);
    expect(debtExcess(harness.api().debts[0])).toBe(0);
  });
});
