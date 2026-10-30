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

/** tdd-guide: التعديل الجزئي في updateSubscription — كل فرع بيتفحص، والصح بيتخزّن */
it('تذكير -1 لوحده ← invalid والقديم فاضل', async () => {
  const id = await addOneSub(h);
  expect(await h.api().updateSubscription(id, { reminderDaysBefore: -1 })).toMatchObject({ outcome: 'invalid', field: 'reminderDays' });
  expect((await storedDoc('subscriptions', id)).reminderDaysBefore).toBe(3);
});
it('مبلغ 10.005 ← بيتخزّن 10.01', async () => {
  const id = await addOneSub(h);
  expect(await h.api().updateSubscription(id, { amount: 10.005 })).toEqual({ outcome: 'done' });
  await h.waitForData(api => api.subscriptions[0]?.amount !== 100);
  expect((await storedDoc('subscriptions', id)).amount).toBe(10.01);
});
it('customDays Infinity ← القديم فاضل؛ و14 ← بيتخزّن', async () => {
  const id = await addOneSub(h, { frequency: 'custom', customDays: 30 });
  expect(await h.api().updateSubscription(id, { customDays: Infinity })).toMatchObject({ outcome: 'invalid', field: 'customDays' });
  expect((await storedDoc('subscriptions', id)).customDays).toBe(30);
  expect(await h.api().updateSubscription(id, { customDays: 14 })).toEqual({ outcome: 'done' });
  await h.waitForData(api => api.subscriptions[0]?.customDays === 14);
  expect((await storedDoc('subscriptions', id)).customDays).toBe(14);
});
