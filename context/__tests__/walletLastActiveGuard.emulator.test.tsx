import { db } from '@/firebaseConfig';
import { clearFirestore, signInTestUser, writeRawDoc } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * بند 13 على المحاكي: نداء مباشر لـ`deleteWallet`/`archiveWallet` على آخر محفظة
 * شغالة **مبيمسحش ومبيأرشفش** — الحظر مبقاش في الشاشة بس. سباق الجهازين (كل واحد
 * بيمسح واحدة من آخر اتنين) اتقفل في 9.5-3: الحارس بقى جوه ذرة من السيرفر (آخر اختبار تحت).
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;
beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForReady();
});
afterEach(async () => { await harness.unmount(); });

const serverWallets = async () =>
  (await getDocsFromServer(collection(db, 'users', getMockUid(), 'wallets'))).docs.map(d => ({ id: d.id, ...d.data() } as { id: string; archived?: boolean }));
const active = () => harness.api().wallets.filter(w => !w.archived);

/** يسيب محفظة شغالة واحدة: الباقي يتأرشفوا (مسموح طول ما فيه أكتر من واحدة) */
async function leaveOneActive() {
  const [keep, ...rest] = harness.api().wallets;
  for (const w of rest) {
    expect(await harness.api().archiveWallet(w.id, {})).toEqual({ outcome: 'done' });
    await harness.waitForData(api => !!api.wallets.find(x => x.id === w.id)?.archived);
  }
  expect(active().map(w => w.id)).toEqual([keep.id]);
  return { keep, archived: rest };
}

it('مسح آخر محفظة شغالة ← blocked، والمحفظة لسه على السيرفر', async () => {
  const { keep } = await leaveOneActive();
  expect(await harness.api().deleteWallet(keep.id)).toEqual({ outcome: 'blocked', block: { kind: 'last-active' } });
  const onServer = await serverWallets();
  expect(onServer.find(w => w.id === keep.id)).toBeTruthy();
  expect(onServer.filter(w => !w.archived)).toHaveLength(1);
});

it('أرشفة آخر محفظة شغالة ← blocked، ومش مؤرشفة على السيرفر', async () => {
  const { keep } = await leaveOneActive();
  expect(await harness.api().archiveWallet(keep.id, {})).toEqual({ outcome: 'blocked', block: { kind: 'last-active' } });
  expect((await serverWallets()).find(w => w.id === keep.id)?.archived).toBeFalsy();
});

it('مسح مؤرشفة والشغالة واحدة بس ← مسموح (مبيغيّرش عدد الشغالة)', async () => {
  const { archived } = await leaveOneActive();
  expect(await harness.api().deleteWallet(archived[0].id)).toEqual({ outcome: 'done' });
  await harness.waitForData(api => !api.wallets.some(w => w.id === archived[0].id));
  expect((await serverWallets()).some(w => w.id === archived[0].id)).toBe(false);
});

it('فيه شغالة تانية ← المسح والأرشفة ماشيين زي الأول', async () => {
  const [a, b] = harness.api().wallets;
  expect(await harness.api().archiveWallet(a.id, {})).toEqual({ outcome: 'done' });
  await harness.waitForData(api => !!api.wallets.find(x => x.id === a.id)?.archived);
  expect(await harness.api().deleteWallet(b.id)).toEqual({ outcome: 'done' });
  await harness.waitForData(api => !api.wallets.some(w => w.id === b.id));
  expect(active()).toHaveLength(1);
});

/**
 * الشاشة بتنادي المسح/الأرشفة من زرار Alert اتعمل في render قديم — يعني دوال من
 * `api` قديم. الحارس لازم يشوف آخر محافظ وصلت، مش اللي كانت وقت الـrender ده.
 */
it('دالة من render قديم (المحافظ اتغيّرت بعدها) ← بتشوف المحافظ الجديدة وبترفض', async () => {
  const stale = harness.api();
  const { keep } = await leaveOneActive();
  expect(await stale.deleteWallet(keep.id)).toEqual({ outcome: 'blocked', block: { kind: 'last-active' } });
  expect(await stale.archiveWallet(keep.id, {})).toEqual({ outcome: 'blocked', block: { kind: 'last-active' } });
  const onServer = await serverWallets();
  expect(onServer.find(w => w.id === keep.id)?.archived).toBeFalsy();
});

/**
 * 9.5-3: جهاز تاني أرشف المحفظة التانية ولسه الـlistener ما وصلش ← الحارس بيتحسب على السيرفر، فالمسح والأرشفة
 * بيترفضوا (قبل كده كانوا بيعدّوا على نسختنا القديمة والحساب يفضل من غير محفظة شغالة).
 */
it('9.5-3: آخر اتنين وجهاز تاني أرشف واحدة لسه ما وصلتش ← blocked على السيرفر', async () => {
  const { archived } = await leaveOneActive();
  // رجّع واحدة عشان يبقوا اتنين شغالين عندنا
  harness.api().restoreWallet(archived[0].id);
  await harness.waitForData(api => !api.wallets.find(x => x.id === archived[0].id)?.archived);
  await harness.waitForData(api => api.pendingWrites === 0);
  const [a, b] = active();
  const uid = getMockUid();
  const bOnServer = (await getDocFromServer(doc(db, 'users', uid, 'wallets', b.id))).data()!;
  await writeRawDoc(`users/${uid}/wallets/${b.id}`, { ...bOnServer, archived: true, archivedAt: new Date().toISOString() });
  expect(await harness.api().deleteWallet(a.id)).toEqual({ outcome: 'blocked', block: { kind: 'last-active' } });
  expect((await serverWallets()).find(w => w.id === a.id)).toBeTruthy();
  await harness.waitForData(api => !!api.wallets.find(x => x.id === b.id)?.archived);
  expect(await harness.api().archiveWallet(a.id, {})).toEqual({ outcome: 'blocked', block: { kind: 'last-active' } });
  expect((await serverWallets()).find(w => w.id === a.id)?.archived).toBeFalsy();
});
