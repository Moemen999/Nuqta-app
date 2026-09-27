import { db } from '@/firebaseConfig';
import { SETUP_FEATURE_CUTOFF, SKIP_SETUP } from '@/lib/firstRunSetup';
import { walletBalance } from '@/lib/finance';
import { clearFirestore, settle, signInTestUser, writeLegacyDoc } from '@/test-utils/emulator';
import { setMockCreationTime, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { disableNetwork, doc, enableNetwork, getDoc, runTransaction, setDoc } from 'firebase/firestore';

/**
 * runTransaction ملفوفة عشان نقدر نخليها تفشل. `disableNetwork` مش بيقطع
 * الـtransactions في الـJS SDK (بتروح للسيرفر من طريق تاني — اتقاس: وصلت في
 * 431ms وكتبت)، فمش بيمثّل موبايل من غير نت. الموبايل الحقيقي من غير نت
 * بيرجّع `unavailable` (CLAUDE.md)، وده اللي بنحقنه هنا.
 */
jest.mock('firebase/firestore', () => {
  const actual = jest.requireActual('firebase/firestore');
  return { ...actual, runTransaction: jest.fn((...args: unknown[]) => (actual.runTransaction as (...a: unknown[]) => unknown)(...args)) };
});
const failNextTransaction = (code: string) =>
  (runTransaction as unknown as jest.Mock).mockImplementationOnce(async () => { throw Object.assign(new Error(code), { code }); });

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: require('@/test-utils/mockAuth').getMockUser() }),
}));

/**
 * شاشة "نبدأ بإيه؟" بدل التعبئة الأوتوماتيك القديمة (`claimSeeding`) اللي كانت
 * بتبلع فشلها وتسيب الحساب الجديد من غير محافظ ومن غير كلمة.
 *
 * الاختبارات بتمشي على المحاكي الحقيقي: الحساب الجديد بيتعرف من السيرفر،
 * والحفظ ذري (كله أو ولا حاجة)، والفشل بيرجع نتيجة صريحة مش سكوت.
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;
let uid: string;

beforeEach(async () => {
  await clearFirestore();
  uid = await signInTestUser();
  setMockUid(uid);
  setMockCreationTime(undefined);
});
afterEach(async () => {
  if (harness) await harness.unmount();
});

const choice = {
  wallets: [{ name: 'كاش', openingBalance: 1500 }, { name: 'كارت ائتمان', openingBalance: -2000.456 }],
  categories: ['أكل', 'فواتير'],
};

describe('حساب جديد', () => {
  it('السيرفر بيأكد إنه جديد ← needed، ومفيش ولا محفظة اتعملت لوحدها', async () => {
    harness = await renderDataProvider();
    await harness.waitForData(api => api.setupStatus === 'needed');
    await settle(800);
    expect(harness.api().wallets).toHaveLength(0);
  });

  it('الحفظ بيكتب المحافظ بأرصدتها والفئات و seeded مرة واحدة', async () => {
    harness = await renderDataProvider();
    await harness.waitForData(api => api.setupStatus === 'needed');
    expect(await harness.api().completeSetup(choice)).toBe('done');
    await harness.waitForData(api => api.wallets.length === 2 && api.categories.length === 2);
    const api = harness.api();
    expect(api.setupStatus).toBe('done');
    const card = api.wallets.find(w => w.name === 'كارت ائتمان')!;
    // مقرّب للقرش، والسالب مسموح (كارت ائتمان)
    expect(card.openingBalance).toBe(-2000.46);
    expect(walletBalance(api.transactions, card.id, card.openingBalance)).toBe(-2000.46);
    expect(api.wallets.find(w => w.name === 'كاش')!.openingBalance).toBe(1500);
    expect((await getDoc(doc(db, 'users', uid))).data()?.seeded).toBe(true);
  });

  it('"تخطي" بيدي محفظة كاش وفئات أساسية بنفس الطريق', async () => {
    harness = await renderDataProvider();
    await harness.waitForData(api => api.setupStatus === 'needed');
    expect(await harness.api().completeSetup(SKIP_SETUP)).toBe('done');
    await harness.waitForData(api => api.wallets.length === 1);
    expect(harness.api().wallets[0].name).toBe('كاش');
    expect(harness.api().categories.map(c => c.name).sort()).toEqual([...SKIP_SETUP.categories].sort());
  });

  it('مفيش حساب يطلع بصفر محافظ ساكت: اختيار من غير محفظة بيترفض وما بيكتبش حاجة', async () => {
    harness = await renderDataProvider();
    await harness.waitForData(api => api.setupStatus === 'needed');
    expect(await harness.api().completeSetup({ wallets: [], categories: ['أكل'] })).toBe('failed');
    await settle(800);
    expect(harness.api().setupStatus).toBe('needed');
    expect(harness.api().categories).toHaveLength(0);
    expect((await getDoc(doc(db, 'users', uid))).data()?.seeded).toBeUndefined();
  });

  it('نداءين مع بعض (جهازين/دوستين) ← مجموعة محافظ واحدة بس', async () => {
    harness = await renderDataProvider();
    await harness.waitForData(api => api.setupStatus === 'needed');
    const [a, b] = await Promise.all([harness.api().completeSetup(choice), harness.api().completeSetup(choice)]);
    expect([a, b].sort()).toEqual(['already-done', 'done']);
    await harness.waitForData(api => api.wallets.length >= 2);
    await settle(1000);
    expect(harness.api().wallets).toHaveLength(2);
  });
});

describe('الفشل بيتقال — مش بيعدّي ساكت', () => {
  it.each([['unavailable', 'no-connection'], ['permission-denied', 'failed']])(
    'runTransaction بيرجع %s ← %s، ومفيش أي حاجة اتسجلت، و"جرّب تاني" بينجح', async (code, expected) => {
      harness = await renderDataProvider();
      await harness.waitForData(api => api.setupStatus === 'needed');
      failNextTransaction(code);
      expect(await harness.api().completeSetup(choice)).toBe(expected);
      await settle(800);
      expect(harness.api().setupStatus).toBe('needed');
      expect(harness.api().wallets).toHaveLength(0);
      expect((await getDoc(doc(db, 'users', uid))).data()?.seeded).toBeUndefined();
      // "جرّب تاني"
      expect(await harness.api().completeSetup(choice)).toBe('done');
      await harness.waitForData(api => api.wallets.length === 2);
      expect(harness.api().setupStatus).toBe('done');
    });
});

/**
 * محاولة قديمة بأرقام قبل ما تتعدّل وصلت السيرفر متأخر (بعد السقف)، والمستخدم
 * عدّل وحفظ تاني ← ممنوع نقول "اتحفظ" على أرقام مش هي اللي اتكتبت (money-reviewer).
 */
/**
 * السقف (20 ثانية) خلص والعملية لسه شغالة — ممنوع نقول "ما اتحفظش" (مش مؤكد).
 * ولو وصلت بعدين، الحالة بتبقى done لوحدها والتطبيق بيفتح (silent-failure-hunter).
 */
describe('السقف خلص والعملية وصلت بعده', () => {
  it('unconfirmed ← وبعدين done لوحده لما العملية المتأخرة توصل', async () => {
    harness = await renderDataProvider();
    await harness.waitForData(api => api.setupStatus === 'needed');
    const actual = jest.requireActual('firebase/firestore');
    (runTransaction as unknown as jest.Mock).mockImplementationOnce((...args: unknown[]) =>
      new Promise(resolve => setTimeout(() => resolve((actual.runTransaction as (...a: unknown[]) => unknown)(...args)), 21000)));
    expect(await harness.api().completeSetup(choice)).toBe('unconfirmed');
    expect(harness.api().setupStatus).toBe('needed');
    await harness.waitForData(api => api.setupStatus === 'done' && api.wallets.length === 2, 20000);
  }, 70000);
});

describe('الحساب اتجهّز قبل كده — بنفس الاختيارات ولا بغيرها', () => {
  it('نفس الاختيارات ← already-done؛ اختيارات تانية ← already-done-other، ومفيش كتابة زيادة', async () => {
    harness = await renderDataProvider();
    await harness.waitForData(api => api.setupStatus === 'needed');
    expect(await harness.api().completeSetup(choice)).toBe('done');
    expect(await harness.api().completeSetup({ ...choice, categories: [...choice.categories].reverse() })).toBe('already-done');
    const edited = { ...choice, wallets: [{ name: 'كاش', openingBalance: 9999 }] };
    expect(await harness.api().completeSetup(edited)).toBe('already-done-other');
    await settle(800);
    expect(harness.api().wallets).toHaveLength(2);
    expect(harness.api().wallets.find(w => w.name === 'كاش')!.openingBalance).toBe(1500);
  });
});

describe('المستخدم القديم عمره ما يشوف الشاشة', () => {
  it('seeded موجود ← done على طول', async () => {
    await setDoc(doc(db, 'users', uid), { seeded: true }, { merge: true });
    harness = await renderDataProvider();
    await harness.waitForData(api => api.setupStatus !== 'checking');
    expect(harness.api().setupStatus).toBe('done');
  });

  it('حساب قديم جدًا من غير seeded بس عنده محفظة ← done مش needed', async () => {
    await writeLegacyDoc(`users/${uid}/wallets/old`, { name: 'CIB', openingBalance: 0, lowAlert: 0 });
    harness = await renderDataProvider();
    await harness.waitForData(api => api.setupStatus !== 'checking');
    expect(harness.api().setupStatus).toBe('done');
  });
});

/**
 * creationTime: حساب اتعمل قبل ما الشاشة تبقى موجودة قديم بالتعريف ← done فوري
 * ومن غير سيرفر (من غير الـ8 ثواني). اللي اتعمل بعدها بيعدّي على السيرفر زي الأول.
 * disableNetwork هنا صح: getDocFromServer (مش transaction) بيقف معاه.
 */
describe('الفحص حسب تاريخ إنشاء الحساب', () => {
  const before = new Date(Date.parse(SETUP_FEATURE_CUTOFF) - 86400000).toUTCString();
  const after = new Date(Date.parse(SETUP_FEATURE_CUTOFF) + 86400000).toUTCString();

  it('حساب قديم جدًا (قبل الشاشة)، ومن غير نت، ومن غير بيانات ← done على طول', async () => {
    setMockCreationTime(before);
    await disableNetwork(db);
    try {
      harness = await renderDataProvider();
      await harness.waitForData(api => api.setupStatus !== 'checking', 3000);
      expect(harness.api().setupStatus).toBe('done');
    } finally {
      await enableNetwork(db);
    }
  });

  it('حساب جديد (بعد الشاشة) من غير بيانات ← needed من السيرفر زي الأول', async () => {
    setMockCreationTime(after);
    harness = await renderDataProvider();
    await harness.waitForData(api => api.setupStatus === 'needed');
  });

  it('حساب جديد ومن غير نت ← unknown (مبنقررش على تخمين)', async () => {
    setMockCreationTime(after);
    await disableNetwork(db);
    try {
      harness = await renderDataProvider();
      await harness.waitForData(api => api.setupStatus === 'unknown', 15000);
    } finally {
      await enableNetwork(db);
    }
  }, 30000);

  it('حساب موجود (seeded) بعد الشاشة ← done من السيرفر', async () => {
    setMockCreationTime(after);
    await setDoc(doc(db, 'users', uid), { seeded: true }, { merge: true });
    harness = await renderDataProvider();
    await harness.waitForData(api => api.setupStatus === 'done');
  });

  it('creationTime بيتغيّر وهو شغال (undefined ← قديم) ← آخر نتيجة هي اللي بتكسب ومفيش رجوع', async () => {
    // silent-failure-hunter: الـcancelled guard لازم يمنع نتيجة الفحص القديم (needed من
    // السيرفر) إنها تكتب فوق النتيجة الجديدة (done فوري)
    setMockCreationTime(undefined);
    harness = await renderDataProvider();
    setMockCreationTime(before);
    await harness.rerender();
    await harness.waitForData(api => api.setupStatus === 'done', 5000);
    await settle(3000);
    expect(harness.api().setupStatus).toBe('done');
  }, 30000);
});
