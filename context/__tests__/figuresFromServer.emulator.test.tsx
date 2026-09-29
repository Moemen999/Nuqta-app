import { disableNetwork, enableNetwork } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * `figuresFromServer` (2026-09-29) — الإشارة اللي بانر "النت قطع — الأرقام ممكن
 * تكون قديمة" بيختفي عليها. على فايرستور الحقيقي (المحاكي): true والأرقام
 * متزامنة، false لما النت يقطع، وترجع true بس لما المحافظ **والعمليات** يوصلوا
 * من السيرفر تاني. المهلة والبانر نفسه في lib/__tests__/staleFigures.test.tsx.
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

it('متزامن ← true؛ النت قطع ← false؛ رجع والأرقام وصلت ← true', async () => {
  const w = harness.api().wallets[0];
  await harness.api().addTransaction({ type: 'expense', amount: 10, walletId: w.id, date: '2026-01-02', note: '' });
  await harness.waitForData(api => api.transactions.length === 1 && api.figuresFromServer === true);

  // enableNetwork في finally: ندهه والنت شغال وبعده unmount على طول بيوقّع الـSDK
  await disableNetwork(db);
  try {
    await harness.waitForData(api => api.figuresFromServer === false);
    // الأرقام لسه على الشاشة (من الذاكرة) — ده بالظبط الوضع اللي البانر عشانه
    expect(harness.api().wallets.length).toBeGreaterThan(0);
    expect(harness.api().transactions.length).toBe(1);
  } finally {
    await enableNetwork(db);
  }
  await harness.waitForData(api => api.figuresFromServer === true);
  expect(harness.api().serverReachable).toBe(true);
});
