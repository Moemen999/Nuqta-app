import { db } from '@/firebaseConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACCOUNT_COLLECTIONS, deletePendingKey } from '@/context/DataContext';
import { LISTENER_LABELS } from '@/lib/listenerErrors';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { addOneGam, addOneSub } from '@/test-utils/entryFixtures';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * مسح الحساب — الخطوة 1 (`deleteAllMyData`): **كل** مستند تحت `users/{uid}` بيتمسح من السيرفر، و`users/{uid}` نفسه،
 * والمرة التانية آمنة. جوجل بلاي بتطلب البيانات المرتبطة بالحساب تتمسح — مستند فاضل = بيانات فاضلة.
 */
let h: Awaited<ReturnType<typeof renderDataProvider>>;
beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  h = await renderDataProvider();
  await h.waitForReady();
});
afterEach(async () => { await h.unmount(); });

const remaining = async () => {
  const uid = getMockUid();
  const counts = await Promise.all(ACCOUNT_COLLECTIONS.map(async n => [n, (await getDocsFromServer(collection(db, 'users', uid, n))).size] as const));
  return Object.fromEntries(counts.filter(([, c]) => c > 0));
};

it('قايمة المسح = كل المجموعات اللي ليها listeners (مجموعة جديدة متتنساش)', () => {
  expect([...ACCOUNT_COLLECTIONS].sort()).toEqual(Object.keys(LISTENER_LABELS).sort());
});

it('حساب فيه من كل نوع ← كله بيتمسح من السيرفر، ومستند المستخدم كمان، والمرة التانية done', async () => {
  const api = h.api();
  const w = api.wallets[0];
  await api.addTransaction({ type: 'expense', amount: 10, walletId: w.id, date: '2026-11-01', note: 'x' } as never);
  await api.addDebt({ personName: 'صاحبي', direction: 'owed_to_me', totalAmount: 300, walletId: w.id, date: '2026-11-01', isInstallment: false } as never);
  await addOneSub(h);
  await addOneGam(h);
  await api.setBudget(api.categories[0].id, 500);
  await api.setMonthlyIncome('2026-11', 9000);
  await api.setShakhbataPercents({ needs: 60, wants: 20, future: 20 });
  await h.waitForData(a => a.transactions.length >= 1 && a.debts.length === 1 && a.subscriptions.length === 1 && a.gamiyas.length === 1);
  expect(Object.keys(await remaining()).length).toBeGreaterThanOrEqual(8);

  expect(await h.api().deleteAllMyData()).toEqual({ outcome: 'done' });
  expect(await remaining()).toEqual({});
  expect((await getDocFromServer(doc(db, 'users', getMockUid()))).exists()).toBe(false);

  // بيتعاد بأمان (المستخدم داس تاني، أو المرة الأولى وقفت في النص)
  expect(await h.api().deleteAllMyData()).toEqual({ outcome: 'done' });
});

it('بعد ما المسح يبدأ ← التسجيل التلقائي والتجهيز بيترفضوا ومبيكتبوش، والعلامة على الجهاز (money + security)', async () => {
  const subId = await addOneSub(h);
  expect(await h.api().deleteAllMyData()).toEqual({ outcome: 'done' });
  expect(await AsyncStorage.getItem(deletePendingKey(getMockUid()))).toBe('1');
  // تسجيل تلقائي متأخر (رجوع من الخلفية) بعد المسح — كان هيعمل عملية يتيمة بمبلغ
  const r = await h.api().recordCharges('subscription', subId, [{ key: '2026-11-01', amount: 100 }], { auto: true });
  expect(r.outcome).toBe('failed');
  expect(await h.api().completeSetup({ wallets: [{ name: 'x', openingBalance: 0 }], categories: [] } as never)).toBe('failed');
  expect(await remaining()).toEqual({});
});

it('فشل قبل ما أي حاجة تتمسح ← القفل والعلامة بيتفكوا (من غيرها التسجيل التلقائي كان بيقف للأبد ساكت — جولة 2)', async () => {
  const { auth } = require('@/firebaseConfig');
  const { signOut } = require('firebase/auth');
  await signOut(auth); // القراية من السيرفر هترفض (permission-denied) قبل أي مسح
  const r = await h.api().deleteAllMyData();
  expect(r).toMatchObject({ outcome: 'failed', deleted: 0, uncertain: false });
  expect(await AsyncStorage.getItem(deletePendingKey(getMockUid()))).toBeNull();
  await h.waitForData(api => api.deletionPending === false);
});
