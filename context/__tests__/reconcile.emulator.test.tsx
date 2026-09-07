import { debtGrandTotal, debtPaid, walletBalance } from '@/lib/finance';
import { clearFirestore, newUid } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * أخطر باج اتلقى في المراجعة اليدوية كان إن حذف عملية من الرئيسية بيسيب الدين
 * اللي ولّدها موجود — يعني رصيد وهمي. الاختبارات دي بتغطي كل أشكال الربط
 * وبتتأكد بعد كل حالة إن الرصيد النهائي = مجموع العمليات الفاضلة بالظبط.
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;

beforeEach(async () => {
  await clearFirestore();
  setMockUid(newUid());
  harness = await renderDataProvider();
  await harness.waitForData(api => api.wallets.length >= 3);
});

afterEach(async () => {
  await harness.unmount();
});

function wallet() {
  return harness.api().wallets[0];
}

/** الرصيد المحسوب من العمليات الموجودة فعلاً — أي فرق معناه فلوس ظهرت أو اختفت */
function balance(walletId: string) {
  return walletBalance(harness.api().transactions, walletId, 0);
}

describe('حذف عملية مرتبطة بدين', () => {
  it('الدين اللي لسه مافيهوش دفعات ولا زيادات بيتمسح كله مع عمليته', async () => {
    const w = wallet();
    await harness.api().addDebt({
      direction: 'owed_to_me', personName: 'أحمد', totalAmount: 1000,
      isInstallment: false, walletId: w.id, date: '2026-03-10',
    });
    await harness.waitForData(api => api.debts.length === 1 && api.transactions.length === 1);
    expect(balance(w.id)).toBe(-1000);

    const txId = harness.api().debts[0].initialTransactionId!;
    expect(txId).toBeTruthy();

    await harness.api().deleteTransaction(txId);
    await harness.waitForData(api => api.transactions.length === 0 && api.debts.length === 0);

    expect(balance(w.id)).toBe(0);
  });

  it('الدين اللي عليه دفعات بيفضل موجود ويبقى بالأجل والدفعات متتأثرش', async () => {
    const w = wallet();
    await harness.api().addDebt({
      direction: 'owed_to_me', personName: 'سميرة', totalAmount: 1000,
      isInstallment: false, walletId: w.id, date: '2026-03-10',
    });
    await harness.waitForData(api => api.debts.length === 1 && api.transactions.length === 1);

    const debtId = harness.api().debts[0].id;
    await harness.api().addDebtPayment(debtId, 400, w.id, '2026-03-20');
    await harness.waitForData(api => api.debts[0].payments.length === 1 && api.transactions.length === 2);
    expect(balance(w.id)).toBe(-600);

    const initialTxId = harness.api().debts[0].initialTransactionId!;
    await harness.api().deleteTransaction(initialTxId);
    await harness.waitForData(api => api.transactions.length === 1);

    const debt = harness.api().debts[0];
    expect(harness.api().debts.length).toBe(1);
    expect(debt.initialTransactionId).toBeUndefined();
    expect(debt.initialWalletId).toBeUndefined();
    // الدفعة الحقيقية اللي المستخدم سجّلها بنفسه فضلت زي ما هي
    expect(debt.payments.length).toBe(1);
    expect(debt.payments[0].amount).toBe(400);
    // والمتبقي على الشخص لسه هو هو
    expect(debtGrandTotal(debt) - debtPaid(debt)).toBe(600);
    // والرصيد بقى بالظبط مجموع العمليات الفاضلة (الدفعة بس)
    expect(balance(w.id)).toBe(400);
  });

  it('حذف عملية دفعة بيشيل الدفعة من الدين والدين بيفضل', async () => {
    const w = wallet();
    await harness.api().addDebt({
      direction: 'i_owe', personName: 'محمود', totalAmount: 800,
      isInstallment: false, walletId: w.id, date: '2026-03-10',
    });
    await harness.waitForData(api => api.debts.length === 1 && api.transactions.length === 1);
    // i_owe: الفلوس دخلت المحفظة
    expect(balance(w.id)).toBe(800);

    const debtId = harness.api().debts[0].id;
    await harness.api().addDebtPayment(debtId, 300, w.id, '2026-03-20');
    await harness.waitForData(api => api.debts[0].payments.length === 1 && api.transactions.length === 2);
    expect(balance(w.id)).toBe(500);

    const paymentTxId = harness.api().debts[0].payments[0].transactionId!;
    await harness.api().deleteTransaction(paymentTxId);
    await harness.waitForData(api => api.transactions.length === 1);

    const debt = harness.api().debts[0];
    expect(debt.payments.length).toBe(0);
    expect(debtPaid(debt)).toBe(0);
    // رجع للمبلغ الأساسي بالظبط، مفيش سداد وهمي فاضل
    expect(debtGrandTotal(debt) - debtPaid(debt)).toBe(800);
    expect(balance(w.id)).toBe(800);
  });

  it('حذف عملية زيادة بيشيل الزيادة والإجمالي بيرجع صح', async () => {
    const w = wallet();
    await harness.api().addDebt({
      direction: 'owed_to_me', personName: 'هالة', totalAmount: 500,
      isInstallment: false, walletId: w.id, date: '2026-03-10',
    });
    await harness.waitForData(api => api.debts.length === 1 && api.transactions.length === 1);

    const debtId = harness.api().debts[0].id;
    await harness.api().addDebtIncrease(debtId, 250, '2026-03-15', w.id);
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1 && api.transactions.length === 2);
    expect(debtGrandTotal(harness.api().debts[0])).toBe(750);
    expect(balance(w.id)).toBe(-750);

    const increaseTxId = harness.api().debts[0].increases[0].transactionId!;
    await harness.api().deleteTransaction(increaseTxId);
    await harness.waitForData(api => api.transactions.length === 1);

    const debt = harness.api().debts[0];
    expect((debt.increases || []).length).toBe(0);
    expect(debtGrandTotal(debt)).toBe(500);
    expect(balance(w.id)).toBe(-500);
  });
});

describe('حذف عملية مرتبطة بجمعية', () => {
  it('شهر الجمعية بيرجع "لسه ما اتسددش" والـ transactionId بيتشال منه', async () => {
    const w = wallet();
    await harness.api().addGamiya({
      name: 'جمعية الشغل', monthlyAmount: 500, totalMonths: 6, payoutMonthIndex: 3,
      payoutAmount: 3000, walletId: w.id, startDate: '2026-01-10', reminderDaysBefore: 3,
    });
    await harness.waitForData(api => api.gamiyas.length === 1 && api.gamiyas[0].months.length === 6);

    const g = harness.api().gamiyas[0];
    const firstMonth = g.months[0];
    await harness.api().markGamiyaMonthDone(g.id, firstMonth.id);
    await harness.waitForData(api =>
      api.gamiyas[0].months[0].status === 'done' && api.transactions.length === 1
    );
    expect(balance(w.id)).toBe(-500);

    const txId = harness.api().gamiyas[0].months[0].transactionId!;
    await harness.api().deleteTransaction(txId);
    await harness.waitForData(api => api.transactions.length === 0);

    const month = harness.api().gamiyas[0].months[0];
    expect(month.status).toBe('pending');
    expect(month.transactionId).toBeUndefined();
    // باقي الشهور ما اتلمستش
    expect(harness.api().gamiyas[0].months.length).toBe(6);
    expect(balance(w.id)).toBe(0);
  });
});

describe('حذف عملية مرتبطة باشتراك', () => {
  it('لو آخر دفعة اتحذفت، موعد الاستحقاق بيرجع خطوة ورا', async () => {
    const w = wallet();
    await harness.api().addSubscription({
      name: 'نتفليكس', amount: 200, walletId: w.id,
      frequency: 'monthly', nextDueDate: '2026-03-10', reminderDaysBefore: 2,
    });
    await harness.waitForData(api => api.subscriptions.length === 1);

    const subId = harness.api().subscriptions[0].id;
    await harness.api().markSubscriptionPaid(subId, '2026-03-10');
    await harness.waitForData(api =>
      api.subscriptions[0].history.length === 1 && api.transactions.length === 1
    );
    expect(harness.api().subscriptions[0].nextDueDate).toBe('2026-04-10');
    expect(balance(w.id)).toBe(-200);

    const txId = harness.api().subscriptions[0].history[0].transactionId!;
    await harness.api().deleteTransaction(txId);
    await harness.waitForData(api => api.transactions.length === 0);

    const sub = harness.api().subscriptions[0];
    expect(sub.history.length).toBe(0);
    expect(sub.nextDueDate).toBe('2026-03-10');
    expect(balance(w.id)).toBe(0);
  });

  it('لو دفعة قديمة اتحذفت، موعد الاستحقاق ميتغيرش', async () => {
    const w = wallet();
    await harness.api().addSubscription({
      name: 'سبوتيفاي', amount: 100, walletId: w.id,
      frequency: 'monthly', nextDueDate: '2026-03-10', reminderDaysBefore: 2,
    });
    await harness.waitForData(api => api.subscriptions.length === 1);

    const subId = harness.api().subscriptions[0].id;
    await harness.api().markSubscriptionPaid(subId, '2026-03-10');
    await harness.waitForData(api => api.subscriptions[0].history.length === 1);
    await harness.api().markSubscriptionPaid(subId, '2026-04-10');
    await harness.waitForData(api =>
      api.subscriptions[0].history.length === 2 && api.transactions.length === 2
    );
    expect(harness.api().subscriptions[0].nextDueDate).toBe('2026-05-10');
    expect(balance(w.id)).toBe(-200);

    // بنحذف الدفعة الأولانية (مش الأخيرة)
    const oldTxId = harness.api().subscriptions[0].history[0].transactionId!;
    await harness.api().deleteTransaction(oldTxId);
    await harness.waitForData(api => api.transactions.length === 1);

    const sub = harness.api().subscriptions[0];
    expect(sub.history.length).toBe(1);
    // الموعد الحالي لسه صح لأن الدفعة الأخيرة لسه موجودة
    expect(sub.nextDueDate).toBe('2026-05-10');
    expect(balance(w.id)).toBe(-100);
  });
});
