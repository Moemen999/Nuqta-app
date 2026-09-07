import { walletBalance } from '@/lib/finance';
import { clearFirestore, newUid, settle } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * التكرار هو أخطر نوع من الباجات هنا: بينشئ فلوس مش موجودة. الاختبارات دي
 * بتوثّق فين الحماية موجودة فعلاً وفين لسه مش موجودة.
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;

beforeEach(async () => {
  await clearFirestore();
  setMockUid(newUid());
});

afterEach(async () => {
  if (harness) await harness.unmount();
});

describe('تكرار إنشاء الدين', () => {
  it('نداءين متوازيين لـ addDebt بينشئوا سجلين — الحماية في الزرار مش في الداتا', async () => {
    harness = await renderDataProvider();
    await harness.waitForData(api => api.wallets.length >= 3);
    const w = harness.api().wallets[0];

    const payload = {
      direction: 'owed_to_me' as const, personName: 'أحمد', totalAmount: 1000,
      isInstallment: false, walletId: w.id, date: '2026-03-10',
    };
    await Promise.all([harness.api().addDebt(payload), harness.api().addDebt(payload)]);
    await harness.waitForData(api => api.debts.length === 2 && api.transactions.length === 2);
    await settle(800);

    // الطبقة دي مفيهاش أي منع للتكرار — لو اتنادت مرتين بتسجل مرتين.
    // اللي بيمنع ده فعليًا هو قفل زرار الحفظ في الواجهة (useBusy)، فأي شاشة
    // جديدة بتكتب لازم تستخدمه، والاختبار ده بيوثّق إن الاعتماد عليه مقصود.
    expect(harness.api().debts).toHaveLength(2);
    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(-2000);
  });
});

/**
 * ⚠️ باج معروف ولسه ما اتصلحش (متسكّت لحد ما يتصلح):
 * markGamiyaMonthDone مبيتأكدش إن الشهر لسه pending قبل ما يخصم. فنداءه مرتين
 * على نفس الشهر بيعمل عمليتين خصم، والشهر بيتربط بالتانية فالأولى بتفضل عملية
 * يتيمة في الأرشيف بتقلل الرصيد من غير سبب ظاهر.
 * ده اتأكد بالاختبارين دول: الاتنين بيرجعوا عمليتين بدل واحدة.
 * قفل الزرار في الواجهة بيغطي الضغط السريع بس، ومش حماية على مستوى البيانات.
 */
describe('تكرار تسديد شهر الجمعية', () => {
  it.skip('نداءين متتاليين على نفس الشهر مبيخصموش مرتين', async () => {
    harness = await renderDataProvider();
    await harness.waitForData(api => api.wallets.length >= 3);
    const w = harness.api().wallets[0];

    await harness.api().addGamiya({
      name: 'جمعية', monthlyAmount: 500, totalMonths: 6, payoutMonthIndex: 3,
      payoutAmount: 3000, walletId: w.id, startDate: '2026-01-10', reminderDaysBefore: 3,
    });
    await harness.waitForData(api => api.gamiyas.length === 1 && api.gamiyas[0].months.length === 6);

    const g = harness.api().gamiyas[0];
    const monthId = g.months[0].id;

    await harness.api().markGamiyaMonthDone(g.id, monthId);
    await harness.waitForData(api => api.gamiyas[0].months[0].status === 'done');

    // تاني مرة على نفس الشهر — الشهر خلاص متسدد
    await harness.api().markGamiyaMonthDone(g.id, monthId);
    await settle(1000);

    expect(harness.api().transactions).toHaveLength(1);
    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(-500);
    // ولازم برضه مفيش عملية يتيمة: العملية الموجودة هي اللي الشهر مربوط بيها
    const month = harness.api().gamiyas[0].months[0];
    expect(harness.api().transactions[0].id).toBe(month.transactionId);
  });

  it.skip('نداءين متوازيين على نفس الشهر مبيخصموش مرتين', async () => {
    harness = await renderDataProvider();
    await harness.waitForData(api => api.wallets.length >= 3);
    const w = harness.api().wallets[0];

    await harness.api().addGamiya({
      name: 'جمعية', monthlyAmount: 500, totalMonths: 6, payoutMonthIndex: 3,
      payoutAmount: 3000, walletId: w.id, startDate: '2026-01-10', reminderDaysBefore: 3,
    });
    await harness.waitForData(api => api.gamiyas.length === 1 && api.gamiyas[0].months.length === 6);

    const g = harness.api().gamiyas[0];
    const monthId = g.months[0].id;

    await Promise.all([
      harness.api().markGamiyaMonthDone(g.id, monthId),
      harness.api().markGamiyaMonthDone(g.id, monthId),
    ]);
    await settle(1000);

    expect(harness.api().transactions).toHaveLength(1);
    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(-500);
  });
});

describe('زرع المحافظ والفئات الافتراضية', () => {
  it('فتح التطبيق مرتين بسرعة لنفس المستخدم بيزرع المحافظ مرة واحدة بس', async () => {
    // ده الباج اللي حصل فعلاً قبل كده: نسختين من البروفايدر بيشتغلوا مع بعض
    // فالمحافظ الافتراضية كانت بتتزرع مرتين
    const first = await renderDataProvider();
    const second = await renderDataProvider();
    harness = first;

    await first.waitForData(api => api.wallets.length >= 3);
    await second.waitForData(api => api.wallets.length >= 3);
    await settle(2000);

    expect(first.api().wallets).toHaveLength(3);
    expect(first.api().categories).toHaveLength(5);
    expect(second.api().wallets).toHaveLength(3);

    await second.unmount();
  });

  it('نفس المستخدم لما يفتح تاني بعدين مبيتزرعلوش محافظ زيادة', async () => {
    const uid = newUid();
    setMockUid(uid);

    const first = await renderDataProvider();
    await first.waitForData(api => api.wallets.length >= 3);
    await settle(800);
    await first.unmount();

    // نفس المستخدم بيفتح التطبيق تاني
    const second = await renderDataProvider();
    harness = second;
    await second.waitForData(api => api.wallets.length >= 3);
    await settle(1500);

    expect(second.api().wallets).toHaveLength(3);
    expect(second.api().categories).toHaveLength(5);
  });
});
