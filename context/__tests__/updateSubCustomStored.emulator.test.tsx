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
 * tdd-guide (2026-10-28): تعديل لـ"مخصص" من غير customDays كان بيترفض حتى لو المتخزّن
 * فيه أيام صحيحة. الشرط إن المخصص ليه أيام صحيحة — بيتفحص على المتخزّن.
 */
it('مخصص من غير customDays والمتخزّن 30 ← done', async () => {
  const id = await addOneSub(h, { frequency: 'custom', customDays: 30 });
  expect(await h.api().updateSubscription(id, { frequency: 'custom' })).toEqual({ outcome: 'done' });
});
it('مخصص من غير customDays والمتخزّن مفيهوش ← invalid ومفيش كتابة', async () => {
  const id = await addOneSub(h);
  expect(await h.api().updateSubscription(id, { frequency: 'custom' })).toMatchObject({ outcome: 'invalid', field: 'customDays' });
  expect((await storedDoc('subscriptions', id)).frequency).toBe('monthly');
});
