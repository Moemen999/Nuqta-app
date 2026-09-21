import { disableNetwork, enableNetwork } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * **حذف السجل بكل عملياته لازم يخلّص من غير نت.**
 *
 * الاختبار ده بيقطع الشبكة بجد (`disableNetwork`) وبيتأكد إن حذف دين
 * بعملياته بيخلّص محليًا في وقته، وإن السجل بيختفي من الشاشة على طول، وإن
 * الرفع بيحصل لوحده أول ما الشبكة ترجع.
 *
 * **وخلي بالك من حدوده — دي اتقاست مش اتفترضت:** الاختبار ده **مبيفرّقش**
 * بين الشكل الجديد والقديم. الشكل القديم
 * (`await Promise.all(txIds.map(deleteTransactionDoc))`) كان بيقرا كإنه
 * بيستنى تأكيد السيرفر، لكنه عمليًا **مكانش بيستنى**: `deleteTransactionDoc`
 * كانت بترمي وعد `track` وترجع على طول. شغّلنا الاختبار ده على الكود القديم
 * بالظبط وعدّى. يعني هو بيثبت إن السلوك الحالي أوفلاين سليم، **مش** إنه
 * بيحرس من رجوع النمط القديم — الحراسة دي في
 * `lib/__tests__/cascadeDeleteBatch.test.ts`.
 *
 * وهو كمان **مبيختبرش الذرية**: مفيش محاكاة لرفض جزئي. الذرية جوه الدفعة
 * ضمان من فايرستور نفسها، وعدم الذرية **بين** الدفعات مكتوب صريح في التعليق
 * فوق `deleteWithTransactions`.
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;

beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForReady();
});

afterEach(async () => {
  // الفصل الأول وبعدين الشبكة ترجع: `enableNetwork` والـlisteners لسه شغالين
  // بيوقّعوا تأكيد داخلي في نسخة الـSDK دي (assertion b815) — مالوش علاقة
  // بالتطبيق، التطبيق عمره ما بينادي `disableNetwork`
  await harness.unmount();
  await enableNetwork(db);
});

/**
 * بيدّي فايربيز لحظة تسكّن قنواتها قبل ما نقطع الشبكة. من غيرها، قطع الشبكة
 * ورا عملية ذرية على طول بيقع جوه الـSDK نفسها — وده عيب في أداة الاختبار
 * مش في الكود اللي بنختبره
 */
function settle(ms = 500) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** بيجري الحذف ومعاه سقف زمني — "اتعلّق" نتيجة زي أي نتيجة */
async function withCap<T>(work: Promise<T>, ms = 5000): Promise<'finished' | 'hung'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<'hung'>(resolve => { timer = setTimeout(() => resolve('hung'), ms); });
  try {
    return await Promise.race([work.then(() => 'finished' as const), cap]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('حذف الدين بكل عملياته وإحنا من غير نت', () => {
  it('بيخلّص محليًا من غير ما يستنى السيرفر', async () => {
    const w = harness.api().wallets[0];
    await harness.api().addDebt({
      direction: 'i_owe', personName: 'صاحبي', totalAmount: 5000,
      isInstallment: false, walletId: w.id, date: '2026-01-01',
    });
    await harness.waitForData(api => api.debts.length === 1);
    const debtId = harness.api().debts[0].id;
    await harness.api().addDebtPayment(debtId, 500, w.id, '2026-02-01');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
    const txIds = [
      harness.api().debts[0].initialTransactionId,
      harness.api().debts[0].payments[0].transactionId,
    ].filter(Boolean) as string[];
    expect(txIds.length).toBe(2);

    await settle();
    await disableNetwork(db);

    expect(await withCap(harness.api().deleteDebt(debtId))).toBe('finished');
    // والسجل بيختفي من قدام المستخدم على طول، مش بعد ما النت يرجع
    await harness.waitForData(api => api.debts.length === 0);
    await harness.waitForData(api => txIds.every(id => !api.transactions.some(t => t.id === id)));

    // وأول ما الشبكة ترجع، الحذف بيرفع لوحده
    await enableNetwork(db);
    await harness.waitForData(api => api.debts.length === 0 && api.serverReachable);
    expect(harness.api().transactions.filter(t => txIds.includes(t.id))).toHaveLength(0);
  });
});

/**
 * **ليه الاشتراك والجمعية مش هنا:** تسديد اشتراك/شهر جمعية بيعدّي على
 * `runTransaction`، وقطع الشبكة بعدها على طول بيوقّع تأكيد داخلي في نسخة
 * الـSDK دي (`INTERNAL ASSERTION FAILED ... b815` جوه `PersistentListenStream`)
 * — الكراش في أداة الاختبار نفسها، مش في الكود. والتطبيق عمره ما بينادي
 * `disableNetwork` أصلاً.
 *
 * فالتلات مسارات (دين/اشتراك/جمعية) متغطيين بحارس ثابت بيقرا الكود نفسه:
 * `lib/__tests__/cascadeDeleteBatch.test.ts`. والمسار اللي بيشتغل هنا فعلاً
 * على شبكة مقطوعة هو الدين، وهو الوحيد اللي فيه أكتر من عملية مربوطة.
 */
