import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { addOneGam, addOneSub, gamData, storedDoc, subData } from '@/test-utils/entryFixtures';
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

/** tdd-guide: الحدود المقبولة والمرفوضة على الدوال الحقيقية، مش الفورم بس */
describe('جمعية', () => {
  it('60 شهر والاستلام في 60 ← done و60 شهر متخزّنين', async () => {
    const id = await addOneGam(h, { totalMonths: 60, payoutMonthIndex: 60, payoutAmount: 60000 });
    const g = await storedDoc('gamiyas', id);
    expect(g.months).toHaveLength(60);
    expect(g.months[59].isPayoutMonth).toBe(true);
  });
  it('شهر واحد والاستلام فيه ← done', async () => { await addOneGam(h, { totalMonths: 1, payoutMonthIndex: 1 }); });
  it.each([0, 61])('%s شهر ← invalid', async n => {
    expect(await h.api().addGamiya(gamData(h, { totalMonths: n }))).toMatchObject({ outcome: 'invalid', field: 'totalMonths' });
  });
  it.each([0, 11])('شهر استلام %s (برّه 1..10) ← invalid', async n => {
    expect(await h.api().addGamiya(gamData(h, { payoutMonthIndex: n }))).toMatchObject({ outcome: 'invalid', field: 'payoutMonth' });
  });
});
describe('اشتراك', () => {
  it('تذكير 0 ← done', async () => {
    const id = await addOneSub(h, { reminderDaysBefore: 0 });
    expect((await storedDoc('subscriptions', id)).reminderDaysBefore).toBe(0);
  });
  it('customDays 1 ← done', async () => {
    const id = await addOneSub(h, { frequency: 'custom', customDays: 1 });
    expect((await storedDoc('subscriptions', id)).customDays).toBe(1);
  });
  it('customDays 0 ← invalid', async () => {
    expect(await h.api().addSubscription(subData(h, { frequency: 'custom', customDays: 0 }) as never)).toMatchObject({ outcome: 'invalid', field: 'customDays' });
  });
});
