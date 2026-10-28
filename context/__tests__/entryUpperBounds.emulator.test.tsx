import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { addOneSub, gamData, storedDoc, subData } from '@/test-utils/entryFixtures';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/** D-A على الدوال الحقيقية: "كل كام يوم" 1..1096، والتذكير 0..365 — في الإضافة والتعديل */
let h: Awaited<ReturnType<typeof renderDataProvider>>;
beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  h = await renderDataProvider();
  await h.waitForReady();
});
afterEach(async () => { await h.unmount(); });

it.each([1097, 2914000, 1e8])('اشتراك "كل كام يوم" %s ← invalid', async v => {
  expect(await h.api().addSubscription(subData(h, { frequency: 'custom', customDays: v }) as never))
    .toMatchObject({ outcome: 'invalid', field: 'customDays' });
});
it('اشتراك تذكير 366 ← invalid', async () => {
  expect(await h.api().addSubscription(subData(h, { reminderDaysBefore: 366 }) as never))
    .toMatchObject({ outcome: 'invalid', field: 'reminderDays' });
});
it('الحدود نفسها (1096 و365) ← done ومتخزّنين', async () => {
  const id = await addOneSub(h, { frequency: 'custom', customDays: 1096, reminderDaysBefore: 365 });
  expect(await storedDoc('subscriptions', id)).toMatchObject({ customDays: 1096, reminderDaysBefore: 365 });
});
it('تعديل لـ1097 يوم أو تذكير 366 ← invalid والقديم فاضل', async () => {
  const id = await addOneSub(h, { frequency: 'custom', customDays: 30 });
  expect(await h.api().updateSubscription(id, { customDays: 1097 })).toMatchObject({ outcome: 'invalid', field: 'customDays' });
  expect(await h.api().updateSubscription(id, { reminderDaysBefore: 366 })).toMatchObject({ outcome: 'invalid', field: 'reminderDays' });
  expect(await storedDoc('subscriptions', id)).toMatchObject({ customDays: 30, reminderDaysBefore: 3 });
});
it('جمعية تذكير 366 ← invalid', async () => {
  expect(await h.api().addGamiya(gamData(h, { reminderDaysBefore: 366 }))).toMatchObject({ outcome: 'invalid', field: 'reminderDays' });
});
