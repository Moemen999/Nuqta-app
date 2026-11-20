import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { addOneSub, storedDoc, userCol } from '@/test-utils/entryFixtures';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { deleteDoc, doc, getDoc } from 'firebase/firestore';

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
 * الميزة 10 (الجولة الأخيرة): حراس `archiveCategory`/`deleteCategory`/`archiveWallet` في DataContext نفسه — الشاشة بتفحص،
 * بس اللي نسي الفحص (أو اتغيّرت البيانات بين الفحص والكتابة) بيترفض هنا.
 */
async function archiveAllBut(keepId: string) {
  for (const c of h.api().categories.filter(x => x.id !== keepId)) {
    expect(await h.api().archiveCategory(c.id, {})).toEqual({ outcome: 'done' });
    await h.waitForData(api => !!api.categories.find(x => x.id === c.id)?.archived);
  }
}

it('آخر فئة شغالة ← الأرشفة والمسح بيترفضوا ومفيش حاجة اتكتبت', async () => {
  const last = h.api().categories[0];
  await archiveAllBut(last.id);
  expect(await h.api().archiveCategory(last.id, {})).toEqual({ outcome: 'blocked', block: { kind: 'last-active' } });
  expect(await h.api().deleteCategory(last.id)).toEqual({ outcome: 'blocked', block: { kind: 'last-active' } });
  const stored = await getDoc(doc(userCol('categories'), last.id));
  expect(stored.exists()).toBe(true);
  expect(stored.data()!.archived).toBeFalsy();
});

it('النقل لفئة مؤرشفة ← blocked والاشتراك فاضل على فئته', async () => {
  const [a, b] = h.api().categories;
  const id = await addOneSub(h, { categoryId: a.id });
  expect(await h.api().archiveCategory(b.id, {})).toEqual({ outcome: 'done' });
  await h.waitForData(api => !!api.categories.find(x => x.id === b.id)?.archived);
  expect(await h.api().archiveCategory(a.id, { [id]: b.id })).toEqual({ outcome: 'blocked', block: { kind: 'target-gone' } });
  expect((await storedDoc('subscriptions', id)).categoryId).toBe(a.id);
  expect((await storedDoc('categories', a.id)).archived).toBeFalsy();
});

it('اشتراك اتمسح والشيت مفتوح ← بيتفوّت والفئة بتتأرشف (الدفعة مبتقعش)', async () => {
  const [a, b] = h.api().categories;
  const id = await addOneSub(h, { categoryId: a.id });
  await deleteDoc(doc(userCol('subscriptions'), id));
  await h.waitForData(api => api.subscriptions.length === 0);
  expect(await h.api().archiveCategory(a.id, { [id]: b.id })).toEqual({ outcome: 'done' });
  await h.waitForData(api => !!api.categories.find(x => x.id === a.id)?.archived);
  expect((await storedDoc('categories', a.id)).archived).toBe(true);
});

it('المحفظة: النقل لمحفظة مؤرشفة ← blocked والاشتراك فاضل', async () => {
  const [a, b, c] = h.api().wallets;
  const id = await addOneSub(h, { walletId: a.id });
  expect(await h.api().archiveWallet(b.id, {})).toEqual({ outcome: 'done' });
  await h.waitForData(api => !!api.wallets.find(x => x.id === b.id)?.archived);
  expect(await h.api().archiveWallet(a.id, { subscriptions: { [id]: b.id } })).toEqual({ outcome: 'blocked', block: { kind: 'target-gone' } });
  expect((await storedDoc('subscriptions', id)).walletId).toBe(a.id);
  expect(await h.api().archiveWallet(a.id, { subscriptions: { [id]: c.id } })).toEqual({ outcome: 'done' });
  await h.waitForData(api => api.subscriptions[0]?.walletId === c.id);
});

it('جولة 2: «آخر شغالة» بس لو هي نفسها شغالة — مؤرشفة وفيه شغالة واحدة ← مش last-active', async () => {
  const last = h.api().categories[0];
  await archiveAllBut(last.id);
  const archived = h.api().categories.find(x => x.id !== last.id)!;
  expect(await h.api().archiveCategory(archived.id, {})).not.toEqual({ outcome: 'blocked', block: { kind: 'last-active' } });
  const ws = h.api().wallets;
  for (const w of ws.slice(1)) {
    expect(await h.api().archiveWallet(w.id, {})).toEqual({ outcome: 'done' });
    await h.waitForData(api => !!api.wallets.find(x => x.id === w.id)?.archived);
  }
  expect(await h.api().archiveWallet(ws[1].id, {})).not.toEqual({ outcome: 'blocked', block: { kind: 'last-active' } });
});
