import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { addOneGam, storedDoc } from '@/test-utils/entryFixtures';
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

/** tdd-guide: updateGamiya — التذكير بكل أشكاله، والقايمة المسموحة بتعدّي الاسم والمحفظة والوضع */
it.each([-1, 2.5, Infinity])('تذكير %s ← invalid والقديم فاضل', async v => {
  const id = await addOneGam(h);
  expect(await h.api().updateGamiya(id, { reminderDaysBefore: v })).toMatchObject({ outcome: 'invalid', field: 'reminderDays' });
  expect((await storedDoc('gamiyas', id)).reminderDaysBefore).toBe(3);
});
it('تذكير 0 + محفظة تانية + تلقائي ← كله بيتخزّن', async () => {
  const id = await addOneGam(h);
  const other = h.api().wallets[1].id;
  expect(await h.api().updateGamiya(id, { reminderDaysBefore: 0, walletId: other, chargeMode: 'auto' })).toEqual({ outcome: 'done' });
  await h.waitForData(api => api.gamiyas[0]?.walletId === other);
  const g = await storedDoc('gamiyas', id);
  expect(g).toMatchObject({ reminderDaysBefore: 0, walletId: other, chargeMode: 'auto' });
  expect(typeof g.chargeAutoSince).toBe('string');
});
