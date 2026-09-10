import { db } from '@/firebaseConfig';
import { walletBalance } from '@/lib/finance';
import { clearFirestore, settle, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { disableNetwork, enableNetwork } from 'firebase/firestore';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * الكتابة في فايربيز بتترجع Promise مبيتحلش غير لما السيرفر يأكد. لو الواجهة
 * استنته، أول ما النت يبوظ المستخدم بيفضل قاعد قدام "..." من غير نهاية، يفتكر
 * إن الحفظ فشل، ويحفظ تاني — فتتسجل عمليتين على نفس الفلوس. الاختبارات دي
 * بتقفل الباب ده: بتقفل النت فعلاً على المحاكي وبتتأكد إن الحفظ بيرجع على طول،
 * والعملية بتظهر، وعلامة "لسه بترفع" بتشتغل وبتختفي لوحدها لما النت يرجع.
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;

beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForData(api => api.wallets.length >= 3);
  // الزرع الافتراضي بيتكتب هو كمان من غير انتظار، فبنستنى يخلص رفع عشان كل
  // اختبار يبدأ وعدّاد "لسه بترفع" على صفر
  await harness.waitForData(api => api.pendingWrites === 0);
});

afterEach(async () => {
  // مهم يرجّع النت حتى لو الاختبار فشل، عشان الاختبار اللي بعده ميلاقيش قاعدة مقفولة
  await enableNetwork(db);
  await harness.unmount();
});


/**
 * لو الدالة لسه بتستنى تأكيد السيرفر، الوعد بتاعها مش هيتحل خالص والنت مقفول —
 * فبدل ما الاختبار يقعد يستنى لحد ما يـtimeout، بنوقفه برسالة تقول السبب
 */
function noHang<T>(p: Promise<T>, ms = 5000): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('الدالة استنت تأكيد السيرفر بدل ما ترجع على طول')), ms)
    ),
  ]);
}

describe('الحفظ من غير نت', () => {
  it('العملية بتتحفظ وبتظهر على طول، والحفظ مبيستناش السيرفر', async () => {
    const w = harness.api().wallets[0];
    await disableNetwork(db);

    const txId = await noHang(
      harness.api().addTransaction({ type: 'expense', amount: 250, walletId: w.id, date: '2026-03-10' })
    );

    expect(txId).toBeTruthy();
    await harness.waitForData(api => api.transactions.length === 1);
    expect(walletBalance(harness.api().transactions, w.id, 0)).toBe(-250);
  });

  it('العملية اللي لسه بترفع بتتعلّم، والعلامة بتختفي لوحدها لما النت يرجع', async () => {
    const w = harness.api().wallets[0];
    await disableNetwork(db);

    const txId = await noHang(
      harness.api().addTransaction({ type: 'expense', amount: 100, walletId: w.id, date: '2026-03-10' })
    );
    await harness.waitForData(api => api.pendingTxIds.has(txId));
    expect(harness.api().pendingWrites).toBeGreaterThan(0);

    await enableNetwork(db);
    await harness.waitForData(api => !api.pendingTxIds.has(txId) && api.pendingWrites === 0);
    // والعملية لسه موجودة بعد ما رفعت، مارجعتش ولا اتكررت
    await settle(500);
    expect(harness.api().transactions).toHaveLength(1);
  });
});
