import { walletBalance } from '@/lib/finance';
import { clearFirestore, newUid } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

beforeEach(async () => {
  await clearFirestore();
  setMockUid(newUid());
});

describe('توصيلة المحاكي', () => {
  it('العملية اللي بتتكتب بترجع من onSnapshot والرصيد بيتحسب منها', async () => {
    const t = await renderDataProvider();
    await t.waitForData(api => api.wallets.length > 0);

    const wallet = t.api().wallets[0];
    await t.api().addTransaction({ type: 'expense', amount: 250, walletId: wallet.id, date: '2026-03-10' });
    await t.waitForData(api => api.transactions.length === 1);

    expect(walletBalance(t.api().transactions, wallet.id, 0)).toBe(-250);
  });
});
