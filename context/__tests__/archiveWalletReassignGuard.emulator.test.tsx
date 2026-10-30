import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { addOneSub, storedDoc } from '@/test-utils/entryFixtures';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

let h: Awaited<ReturnType<typeof renderDataProvider>>;
beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  h = await renderDataProvider();
  await h.waitForReady();
});
afterEach(async () => { await h.unmount(); });

/**
 * tdd-guide: الحارس قبل الدفعة — آخر محفظة شغالة ومعاها خريطة نقل ← ولا نقل بيتكتب.
 * ومحفظتين شغالين ← النقل بيتطبّق.
 */
it('آخر شغالة + خريطة نقل ← blocked والاشتراك فاضل على محفظته', async () => {
  const [a, b, c] = h.api().wallets;
  const id = await addOneSub(h, { walletId: a.id });
  for (const w of [b, c]) {
    expect(await h.api().archiveWallet(w.id, {})).toEqual({ outcome: 'done' });
    await h.waitForData(api => !!api.wallets.find(x => x.id === w.id)?.archived);
  }
  expect(await h.api().archiveWallet(a.id, { subscriptions: { [id]: b.id } })).toEqual({ outcome: 'blocked', block: { kind: 'last-active' } });
  expect((await storedDoc('subscriptions', id)).walletId).toBe(a.id);
  expect((await storedDoc('wallets', a.id)).archived).toBeFalsy();
});
it('فيه شغالة تانية + خريطة نقل ← done والنقل اتطبّق', async () => {
  const [a, b] = h.api().wallets;
  const id = await addOneSub(h, { walletId: a.id });
  expect(await h.api().archiveWallet(a.id, { subscriptions: { [id]: b.id } })).toEqual({ outcome: 'done' });
  await h.waitForData(api => api.subscriptions[0]?.walletId === b.id);
  expect((await storedDoc('subscriptions', id)).walletId).toBe(b.id);
});
