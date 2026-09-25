import { db } from '@/firebaseConfig';
import { clearFirestore, settle, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { deleteDoc, doc, getDocFromServer, waitForPendingWrites } from 'firebase/firestore';
import { Alert } from 'react-native';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * الأرشفة بتلمس فلوس بشكل غير مباشر: الاشتراك الشغّال بيولّد عملية خصم كل
 * شهر، ولو اتأرشفت محفظته من غير ما ينتقل بيفضل يرفض التسديد. والنقل والأرشفة
 * بيتبعتوا في دفعة واحدة عشان ميحصلش نص تنفيذ.
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;

beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForReady();
});

afterEach(async () => {
  await harness.unmount();
});

describe('أرشفة محفظة', () => {
  it('بتتكتب archived و archivedAt، والمحفظة بتفضل موجودة', async () => {
    const wallet = harness.api().wallets[0];
    await harness.api().archiveWallet(wallet.id, {});
    await harness.waitForData(api => !!api.wallets.find(w => w.id === wallet.id)?.archived);

    const after = harness.api().wallets.find(w => w.id === wallet.id);
    expect(after).toBeDefined();
    expect(after!.archived).toBe(true);
    expect(typeof after!.archivedAt).toBe('string');
    // اسمها ما اتغيرش — التاريخ لسه بيقدر يوصل لها
    expect(after!.name).toBe(wallet.name);
  });

  it('النقل والأرشفة بيحصلوا مع بعض: الاشتراك بيتنقل والمحفظة بتتأرشف', async () => {
    const [from, to] = harness.api().wallets;
    await harness.api().addSubscription({
      name: 'نتفليكس', amount: 100, walletId: from.id,
      frequency: 'monthly', nextDueDate: '2026-10-01', reminderDaysBefore: 2,
    });
    await harness.waitForData(api => api.subscriptions.length === 1);
    const sub = harness.api().subscriptions[0];

    await harness.api().archiveWallet(from.id, { subscriptions: { [sub.id]: to.id } });
    await harness.waitForData(api =>
      !!api.wallets.find(w => w.id === from.id)?.archived
      && api.subscriptions[0]?.walletId === to.id
    );

    expect(harness.api().subscriptions[0].walletId).toBe(to.id);
    expect(harness.api().wallets.find(w => w.id === from.id)!.archived).toBe(true);
  });

  it('الجمعية بتتنقل بنفس الطريقة', async () => {
    const [from, to] = harness.api().wallets;
    await harness.api().addGamiya({
      name: 'جمعية الشغل', monthlyAmount: 500, totalMonths: 3, payoutMonthIndex: 2,
      payoutAmount: 1500, walletId: from.id, startDate: '2026-10-01', reminderDaysBefore: 2,
    });
    await harness.waitForData(api => api.gamiyas.length === 1);
    const g = harness.api().gamiyas[0];

    await harness.api().archiveWallet(from.id, { gamiyas: { [g.id]: to.id } });
    await harness.waitForData(api => api.gamiyas[0]?.walletId === to.id);

    expect(harness.api().gamiyas[0].walletId).toBe(to.id);
    // شهور الجمعية ما اتلمستش — النقل بيغيّر الجاي مش اللي فات
    expect(harness.api().gamiyas[0].months).toHaveLength(3);
    expect(harness.api().gamiyas[0].months.every(m => m.status === 'pending')).toBe(true);
  });

  it('العمليات القديمة مش بتتلمس خالص — التاريخ بيفضل على محفظته', async () => {
    const [from, to] = harness.api().wallets;
    await harness.api().addTransaction({ type: 'expense', amount: 250, walletId: from.id, date: '2026-09-10' });
    await harness.waitForData(api => api.transactions.length === 1);

    await harness.api().archiveWallet(from.id, {});
    await harness.waitForData(api => !!api.wallets.find(w => w.id === from.id)?.archived);
    await settle();

    expect(harness.api().transactions).toHaveLength(1);
    expect(harness.api().transactions[0].walletId).toBe(from.id);
    expect(harness.api().transactions[0].walletId).not.toBe(to.id);
  });

  it('الرجوع بيشيل الحقلين خالص — المحفظة ترجع زي أي محفظة عادية', async () => {
    const wallet = harness.api().wallets[0];
    await harness.api().archiveWallet(wallet.id, {});
    await harness.waitForData(api => !!api.wallets.find(w => w.id === wallet.id)?.archived);

    await harness.api().restoreWallet(wallet.id);
    await harness.waitForData(api => !api.wallets.find(w => w.id === wallet.id)?.archived);

    const after = harness.api().wallets.find(w => w.id === wallet.id)!;
    expect(after.archived).toBeUndefined();
    expect(after.archivedAt).toBeUndefined();
  });
});

describe('تسديد على محفظة مؤرشفة أو ممسوحة', () => {
  it('اشتراك على محفظة مؤرشفة بيرفض التسديد ومبيعملش أي عملية', async () => {
    const wallet = harness.api().wallets[0];
    await harness.api().addSubscription({
      name: 'نتفليكس', amount: 100, walletId: wallet.id,
      frequency: 'monthly', nextDueDate: '2026-10-01', reminderDaysBefore: 2,
    });
    await harness.waitForData(api => api.subscriptions.length === 1);
    const sub = harness.api().subscriptions[0];

    // أرشفة من غير نقل (سيناريو "اتأرشفت من جهاز تاني")
    await harness.api().archiveWallet(wallet.id, {});
    await harness.waitForData(api => !!api.wallets.find(w => w.id === wallet.id)?.archived);

    const outcome = await harness.api().markSubscriptionPaid(sub.id, '2026-10-01');
    expect(outcome).toBe('wallet-missing');

    await settle();
    expect(harness.api().transactions).toHaveLength(0);
    expect(harness.api().subscriptions[0].history || []).toHaveLength(0);
    // وموعد الاستحقاق ما اتحركش
    expect(harness.api().subscriptions[0].nextDueDate).toBe('2026-10-01');
  });

  it('اشتراك على محفظة ممسوحة بيرفض التسديد كمان', async () => {
    const wallet = harness.api().wallets[0];
    await harness.api().addSubscription({
      name: 'سبوتيفاي', amount: 60, walletId: wallet.id,
      frequency: 'monthly', nextDueDate: '2026-10-01', reminderDaysBefore: 2,
    });
    await harness.waitForData(api => api.subscriptions.length === 1);
    const sub = harness.api().subscriptions[0];

    await harness.api().deleteWallet(wallet.id);
    await harness.waitForData(api => !api.wallets.some(w => w.id === wallet.id));

    expect(await harness.api().markSubscriptionPaid(sub.id, '2026-10-01')).toBe('wallet-missing');
    await settle();
    expect(harness.api().transactions).toHaveLength(0);
  });

  it('شهر جمعية على محفظة مؤرشفة بيرفض ومبيسجلش الشهر', async () => {
    const wallet = harness.api().wallets[0];
    await harness.api().addGamiya({
      name: 'جمعية', monthlyAmount: 500, totalMonths: 2, payoutMonthIndex: 2,
      payoutAmount: 1000, walletId: wallet.id, startDate: '2026-10-01', reminderDaysBefore: 2,
    });
    await harness.waitForData(api => api.gamiyas.length === 1);
    const g = harness.api().gamiyas[0];

    await harness.api().archiveWallet(wallet.id, {});
    await harness.waitForData(api => !!api.wallets.find(w => w.id === wallet.id)?.archived);

    expect(await harness.api().markGamiyaMonthDone(g.id, g.months[0].id)).toBe('wallet-missing');
    await settle();
    expect(harness.api().transactions).toHaveLength(0);
    expect(harness.api().gamiyas[0].months[0].status).toBe('pending');
  });

  it('بعد النقل لمحفظة شغالة، التسديد بيشتغل عادي على المحفظة الجديدة', async () => {
    const [from, to] = harness.api().wallets;
    await harness.api().addSubscription({
      name: 'نتفليكس', amount: 100, walletId: from.id,
      frequency: 'monthly', nextDueDate: '2026-10-01', reminderDaysBefore: 2,
    });
    await harness.waitForData(api => api.subscriptions.length === 1);
    const sub = harness.api().subscriptions[0];

    await harness.api().archiveWallet(from.id, { subscriptions: { [sub.id]: to.id } });
    await harness.waitForData(api => api.subscriptions[0]?.walletId === to.id);

    expect(await harness.api().markSubscriptionPaid(sub.id, '2026-10-01')).toBe('done');
    await harness.waitForData(api => api.transactions.length === 1);
    expect(harness.api().transactions[0].walletId).toBe(to.id);
  });
});

describe('أرشفة فئة', () => {
  it('الميزانية بتتمسح مع الأرشفة', async () => {
    const cat = harness.api().categories[0];
    await harness.api().setBudget(cat.id, 1500);
    await harness.waitForData(api => api.budgets[cat.id] === 1500);

    await harness.api().archiveCategory(cat.id, {});
    await harness.waitForData(api =>
      !!api.categories.find(c => c.id === cat.id)?.archived && api.budgets[cat.id] == null
    );

    expect(harness.api().budgets[cat.id]).toBeUndefined();
    expect(harness.api().categories.find(c => c.id === cat.id)!.archived).toBe(true);
  });

  it('اشتراك بيتنقل لفئة تانية والفئة القديمة بتتأرشف في نفس الدفعة', async () => {
    const [from, to] = harness.api().categories;
    const wallet = harness.api().wallets[0];
    await harness.api().addSubscription({
      name: 'نتفليكس', amount: 100, walletId: wallet.id, categoryId: from.id,
      frequency: 'monthly', nextDueDate: '2026-10-01', reminderDaysBefore: 2,
    });
    await harness.waitForData(api => api.subscriptions.length === 1);
    const sub = harness.api().subscriptions[0];

    await harness.api().archiveCategory(from.id, { [sub.id]: to.id });
    await harness.waitForData(api =>
      api.subscriptions[0]?.categoryId === to.id && !!api.categories.find(c => c.id === from.id)?.archived
    );

    expect(harness.api().subscriptions[0].categoryId).toBe(to.id);
    expect(harness.api().categories.find(c => c.id === from.id)!.archived).toBe(true);
  });

  it('العمليات القديمة بتفضل على فئتها بعد الأرشفة', async () => {
    const cat = harness.api().categories[0];
    const wallet = harness.api().wallets[0];
    await harness.api().addTransaction({
      type: 'expense', amount: 80, walletId: wallet.id, categoryId: cat.id, date: '2026-09-10',
    });
    await harness.waitForData(api => api.transactions.length === 1);

    await harness.api().archiveCategory(cat.id, {});
    await harness.waitForData(api => !!api.categories.find(c => c.id === cat.id)?.archived);
    await settle();

    expect(harness.api().transactions[0].categoryId).toBe(cat.id);
  });

  it('الرجوع بيشيل الحقلين، والميزانية مبترجعش لوحدها', async () => {
    const cat = harness.api().categories[0];
    await harness.api().setBudget(cat.id, 900);
    await harness.waitForData(api => api.budgets[cat.id] === 900);

    await harness.api().archiveCategory(cat.id, {});
    await harness.waitForData(api => !!api.categories.find(c => c.id === cat.id)?.archived);

    await harness.api().restoreCategory(cat.id);
    await harness.waitForData(api => !api.categories.find(c => c.id === cat.id)?.archived);
    await settle();

    expect(harness.api().categories.find(c => c.id === cat.id)!.archived).toBeUndefined();
    expect(harness.api().budgets[cat.id]).toBeUndefined();
  });
});

describe('حذف فئة بيمسح ميزانيتها', () => {
  it('الميزانية مبتفضلش يتيمة بعد الحذف', async () => {
    const cat = harness.api().categories[0];
    await harness.api().setBudget(cat.id, 1200);
    await harness.waitForData(api => api.budgets[cat.id] === 1200);

    await harness.api().deleteCategory(cat.id);
    await harness.waitForData(api =>
      !api.categories.some(c => c.id === cat.id) && api.budgets[cat.id] == null
    );

    expect(harness.api().budgets[cat.id]).toBeUndefined();
  });

  it('ميزانيات الفئات التانية مبتتلمسش', async () => {
    const [a, b] = harness.api().categories;
    await harness.api().setBudget(a.id, 100);
    await harness.api().setBudget(b.id, 200);
    await harness.waitForData(api => api.budgets[a.id] === 100 && api.budgets[b.id] === 200);

    await harness.api().deleteCategory(a.id);
    await harness.waitForData(api => !api.categories.some(c => c.id === a.id));
    await settle();

    expect(harness.api().budgets[b.id]).toBe(200);
  });
});

/**
 * شيت الأرشفة بيبني خريطة النقل من النسخة اللي عنده لحظة ما اتفتح. لو اشتراك
 * أو جمعية أو دخل اتمسح من جهاز تاني والشيت مفتوح، `batch.update` على مستند مش موجود
 * كان بيوقّع الدفعة كلها — والمحفظة ما تتأرشفش، برسالة خطأ عامة.
 */
describe('أرشفة محفظة وحاجة في خريطة النقل اتمسحت من جهاز تاني', () => {
  let alertSpy: jest.SpyInstance;
  beforeEach(() => { alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
  afterEach(() => { alertSpy.mockRestore(); });

  /**
   * `pendingWrites === 0` هنا مش كفاية: عدّاد رياكت بيتأخر render، فالشرط كان
   * بيعدّي قبل ما الأرشفة تتعدّ. و`getDocFromServer` بيحط الكتابات اللي لسه
   * بترفع فوق نسخة السيرفر — فلازم نستنى السيرفر يقبل أو يرفض الأول.
   */
  async function expectArchivedOnServer(walletId: string) {
    await waitForPendingWrites(db);
    await settle();
    const snap = await getDocFromServer(doc(db, 'users', getMockUid(), 'wallets', walletId));
    expect(snap.data()?.archived).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  }

  it('اشتراك اتمسح ← المحفظة بتتأرشف برضه، والباقي بيتنقل', async () => {
    const [from, to] = harness.api().wallets;
    await harness.api().addSubscription({
      name: 'نتفليكس', amount: 100, walletId: from.id,
      frequency: 'monthly', nextDueDate: '2026-10-01', reminderDaysBefore: 2,
    });
    await harness.api().addSubscription({
      name: 'سبوتيفاي', amount: 60, walletId: from.id,
      frequency: 'monthly', nextDueDate: '2026-10-05', reminderDaysBefore: 2,
    });
    await harness.waitForData(api => api.subscriptions.length === 2 && api.pendingWrites === 0);
    const [gone, kept] = harness.api().subscriptions;
    // الشيت اتفتح وهو شايف الاتنين
    const reassign = { subscriptions: { [gone.id]: to.id, [kept.id]: to.id } };

    await deleteDoc(doc(db, 'users', getMockUid(), 'subscriptions', gone.id));
    await harness.waitForData(api => api.subscriptions.length === 1);

    await harness.api().archiveWallet(from.id, reassign);
    await expectArchivedOnServer(from.id);
    const keptSnap = await getDocFromServer(doc(db, 'users', getMockUid(), 'subscriptions', kept.id));
    expect(keptSnap.data()?.walletId).toBe(to.id);
    // الممسوح ما رجعش (update مبيعملش مستند)
    expect((await getDocFromServer(doc(db, 'users', getMockUid(), 'subscriptions', gone.id))).exists()).toBe(false);
  });

  it('جمعية اتمسحت ← المحفظة بتتأرشف برضه، والباقية بتتنقل', async () => {
    const [from, to] = harness.api().wallets;
    const base = { monthlyAmount: 500, totalMonths: 3, payoutMonthIndex: 2, payoutAmount: 1500, startDate: '2026-10-01', reminderDaysBefore: 2 };
    await harness.api().addGamiya({ ...base, name: 'جمعية الشغل', walletId: from.id });
    await harness.api().addGamiya({ ...base, name: 'جمعية العيلة', walletId: from.id });
    await harness.waitForData(api => api.gamiyas.length === 2 && api.pendingWrites === 0);
    const [gone, kept] = harness.api().gamiyas;
    const reassign = { gamiyas: { [gone.id]: to.id, [kept.id]: to.id } };

    await deleteDoc(doc(db, 'users', getMockUid(), 'gamiyas', gone.id));
    await harness.waitForData(api => api.gamiyas.length === 1);

    await harness.api().archiveWallet(from.id, reassign);
    await expectArchivedOnServer(from.id);
    const keptSnap = await getDocFromServer(doc(db, 'users', getMockUid(), 'gamiyas', kept.id));
    expect(keptSnap.data()?.walletId).toBe(to.id);
    expect((await getDocFromServer(doc(db, 'users', getMockUid(), 'gamiyas', gone.id))).exists()).toBe(false);
  });

  it('دخل ثابت اتمسح ← نفس الحاجة', async () => {
    const [from, to] = harness.api().wallets;
    await harness.api().addIncome({
      name: 'المرتب', amount: 8000, walletId: from.id, frequency: 'monthly', dayOfMonth: 25, mode: 'confirm',
    } as any);
    await harness.waitForData(api => api.incomes.length === 1 && api.pendingWrites === 0);
    const inc = harness.api().incomes[0];
    const reassign = { incomes: { [inc.id]: to.id } };

    await deleteDoc(doc(db, 'users', getMockUid(), 'incomes', inc.id));
    await harness.waitForData(api => api.incomes.length === 0);

    await harness.api().archiveWallet(from.id, reassign);
    await expectArchivedOnServer(from.id);
  });
});
