import { db } from '@/firebaseConfig';
import { gamiyaTxId, subscriptionTxId } from '@/lib/autoCharge';
import { addDays, addMonths, todayStr, walletBalance } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * الخصم التلقائي على محاكي فايرستور الحقيقي. أهم وعد في البند: **الفترة
 * عمرها ما تتخصم مرتين** — لا بجهازين، ولا بـ"سدّد" من الشاشة وبعدين التلقائي،
 * ولا فوق عملية المستخدم عدّلها، ولا بعد ما المستخدم مسحها.
 *
 * "جهازين" هنا = ذرتين متوازيتين فعلاً (`Promise.all`) — نفس طريقة
 * `debtConcurrency`: فايرستور بتعيد الذرة التانية فبتلاقي الأولى قفلت.
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;
const today = todayStr();

beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForReady();
});

afterEach(async () => {
  await harness.unmount();
});

const userDoc = (...path: string[]) => doc(db, 'users', getMockUid(), ...path);

async function makeSub(over: { nextDueDate?: string; chargeMode?: 'auto' | 'confirm'; autoSince?: string; amount?: number } = {}) {
  const w = harness.api().wallets[0];
  await harness.api().addSubscription({
    name: 'نتفليكس', amount: over.amount ?? 200, walletId: w.id, frequency: 'monthly',
    nextDueDate: over.nextDueDate ?? today, reminderDaysBefore: 3, chargeMode: over.chargeMode,
  });
  await harness.waitForData(api => api.subscriptions.length === 1);
  const id = harness.api().subscriptions[0].id;
  // تاريخ تفعيل التلقائي في الماضي — عشان نختبر فترات متأخرة على "تلقائي"
  if (over.autoSince) await updateDoc(userDoc('subscriptions', id), { chargeAutoSince: over.autoSince });
  await harness.waitForData(api => api.pendingWrites === 0
    && (!over.autoSince || api.subscriptions[0].chargeAutoSince === over.autoSince));
  return { walletId: w.id, id };
}

async function makeGamiya(over: { chargeMode?: 'auto' | 'confirm'; autoSince?: string } = {}) {
  const w = harness.api().wallets[0];
  // 4 شهور: اتنين فاتوا (الأول استلام)، والنهاردة، وواحد جاي
  await harness.api().addGamiya({
    name: 'العيلة', monthlyAmount: 1000, totalMonths: 4, payoutMonthIndex: 1, payoutAmount: 4000,
    walletId: w.id, startDate: addMonths(today, -2), reminderDaysBefore: 3, chargeMode: over.chargeMode,
  });
  await harness.waitForData(api => api.gamiyas.length === 1);
  const id = harness.api().gamiyas[0].id;
  if (over.autoSince) await updateDoc(userDoc('gamiyas', id), { chargeAutoSince: over.autoSince });
  await harness.waitForData(api => api.pendingWrites === 0
    && (!over.autoSince || api.gamiyas[0].chargeAutoSince === over.autoSince));
  return { walletId: w.id, id, months: harness.api().gamiyas[0].months };
}

function balanceOf(walletId: string) {
  const w = harness.api().wallets.find(x => x.id === walletId)!;
  return walletBalance(harness.api().transactions, w.id, w.openingBalance);
}
const subTxs = (id: string) => harness.api().transactions.filter(t => t.subscriptionId === id);
const gamiyaTxs = (id: string) => harness.api().transactions.filter(t => t.gamiyaId === id);
const sub = () => harness.api().subscriptions[0];

describe('اشتراك "بتأكيد" (الافتراضي)', () => {
  it('الافتراضي "بتأكيد" ← التلقائي مبيسجلش حاجة', async () => {
    const { id } = await makeSub();
    expect(sub().chargeMode).toBe('confirm');
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true });
    expect(r).toEqual({ outcome: 'done', recorded: [] });
    expect(subTxs(id)).toHaveLength(0);
  });

  it('"اتخصم" ← عملية بالمعرّف الثابت، الفترة اتقفلت، المعاد اتقدّم، الرصيد نقص', async () => {
    const { walletId, id } = await makeSub();
    const before = balanceOf(walletId);
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    expect(r).toEqual({ outcome: 'done', recorded: [today] });
    await harness.waitForData(() => subTxs(id).length === 1 && sub().nextDueDate === addMonths(today, 1));
    const tx = subTxs(id)[0];
    expect(tx.id).toBe(subscriptionTxId(id, today));
    expect(tx).toMatchObject({ type: 'expense', amount: 200, walletId, date: today, periodKey: today });
    expect(tx.autoRecorded).toBeUndefined();
    expect(sub().closed?.[today]?.txId).toBe(tx.id);
    expect(sub().history.map(h => h.periodKey)).toEqual([today]);
    expect(before - balanceOf(walletId)).toBe(200);
  });

  it('"المبلغ مختلف" ← المرة دي بس، والمعتاد زي ما هو', async () => {
    const { id } = await makeSub();
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 240 }]);
    await harness.waitForData(() => subTxs(id).length === 1);
    expect(subTxs(id)[0].amount).toBe(240);
    expect(sub().amount).toBe(200);
  });

  it('"ما اتخصمش" ← الفترة اتقفلت من غير عملية والمعاد اتقدّم', async () => {
    const { walletId, id } = await makeSub();
    const before = balanceOf(walletId);
    expect(await harness.api().skipSubscriptionCharge(id, today)).toBe('done');
    await harness.waitForData(() => sub().nextDueDate === addMonths(today, 1));
    expect(sub().closed?.[today]?.skipped).toBe(true);
    expect(subTxs(id)).toHaveLength(0);
    expect(balanceOf(walletId)).toBe(before);
  });

  it('فترة مش مستحقة لسه ← مبتتسجلش من الكارت', async () => {
    const { id } = await makeSub({ nextDueDate: addDays(today, 3) });
    const r = await harness.api().recordCharges('subscription', id, [{ key: addDays(today, 3), amount: 200 }]);
    expect(r.recorded).toEqual([]);
  });
});

describe('اشتراك "تلقائي"', () => {
  it('غاب شهرين ← التلات فترات في نداء واحد، كلهم عليهم علامة "اتسجلت لوحدها"', async () => {
    const start = addMonths(today, -2);
    const { walletId, id } = await makeSub({ chargeMode: 'auto', nextDueDate: start, autoSince: start });
    const before = balanceOf(walletId);
    const keys = [start, addMonths(start, 1), addMonths(start, 2)];
    const r = await harness.api().recordCharges('subscription', id, keys.map(key => ({ key, amount: 200 })), { auto: true });
    expect(r.recorded).toEqual(keys);
    await harness.waitForData(() => subTxs(id).length === 3);
    expect(subTxs(id).every(t => t.autoRecorded === true)).toBe(true);
    expect(sub().history.every(h => h.auto)).toBe(true);
    expect(before - balanceOf(walletId)).toBe(600);
    expect(sub().nextDueDate).toBe(addMonths(start, 3));
  });

  it('فترات قبل تفعيل التلقائي ← مبتتخصمش لوحدها (بتسأل)', async () => {
    const start = addMonths(today, -2);
    const { id } = await makeSub({ chargeMode: 'auto', nextDueDate: start });
    // اتفعّل النهاردة (addSubscription) ← الشهرين اللي فاتوا مش تلقائي
    const keys = [start, addMonths(start, 1), addMonths(start, 2)];
    const r = await harness.api().recordCharges('subscription', id, keys.map(key => ({ key, amount: 200 })), { auto: true });
    expect(r.recorded).toEqual([today]);
  });
});

describe('ممنوع يتخصم مرتين', () => {
  it('"سدّد" من الشاشة وبعدين التلقائي ← التلقائي ملقاش حاجة', async () => {
    const { walletId, id } = await makeSub({ chargeMode: 'auto', autoSince: today });
    const before = balanceOf(walletId);
    expect(await harness.api().markSubscriptionPaid(id, today)).toBe('done');
    await harness.waitForData(() => subTxs(id).length === 1);
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true });
    expect(r.recorded).toEqual([]);
    await harness.waitForData(api => api.pendingWrites === 0);
    expect(subTxs(id)).toHaveLength(1);
    // اليدوي بنفس المعرّف الثابت — فحتى جهاز تاني متأخر مكانش هيعمل عملية تانية
    expect(subTxs(id)[0].id).toBe(subscriptionTxId(id, today));
    expect(before - balanceOf(walletId)).toBe(200);
  });

  it('التلقائي وبعدين "سدّد" ← "سدّد" بيدفع الفترة الجاية مش نفس الفترة تاني', async () => {
    const { id } = await makeSub({ chargeMode: 'auto', autoSince: today });
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true });
    await harness.waitForData(() => subTxs(id).length === 1);
    await harness.api().markSubscriptionPaid(id, addDays(today, 1));
    await harness.waitForData(() => subTxs(id).length === 2);
    expect(subTxs(id).map(t => t.periodKey).sort()).toEqual([today, addMonths(today, 1)]);
  });

  it('فترتين متأخرتين: "سدّد" مرتين النهاردة ← التانية بتقول "اتسجل النهاردة خلاص" (مش "تم" ساكتة)، والكارت بيقفل التانية', async () => {
    const start = addMonths(today, -1);
    const { walletId, id } = await makeSub({ nextDueDate: start });
    const before = balanceOf(walletId);
    expect(await harness.api().markSubscriptionPaid(id, today)).toBe('done');
    await harness.waitForData(() => subTxs(id).length === 1);
    expect(await harness.api().markSubscriptionPaid(id, today)).toBe('already-paid-today');
    expect(subTxs(id)).toHaveLength(1);
    // الفترة التانية لسه مفتوحة ← كارت "اتخصم؟" بيقفلها
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    expect(r.recorded).toEqual([today]);
    await harness.waitForData(() => subTxs(id).length === 2);
    expect(before - balanceOf(walletId)).toBe(400);
    expect(subTxs(id).map(t => t.periodKey).sort()).toEqual([start, today]);
  });

  it('جهازين في نفس اللحظة (تلقائي + تلقائي) ← عملية واحدة', async () => {
    const { walletId, id } = await makeSub({ chargeMode: 'auto', autoSince: today });
    const before = balanceOf(walletId);
    const [a, b] = await Promise.all([
      harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true }),
      harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true }),
    ]);
    expect([...a.recorded, ...b.recorded]).toEqual([today]);
    await harness.waitForData(api => api.pendingWrites === 0 && subTxs(id).length === 1);
    expect(sub().history).toHaveLength(1);
    expect(before - balanceOf(walletId)).toBe(200);
  });

  it('جهازين: واحد "سدّد" والتاني تلقائي في نفس اللحظة ← عملية واحدة', async () => {
    const { id } = await makeSub({ chargeMode: 'auto', autoSince: today });
    await Promise.all([
      harness.api().markSubscriptionPaid(id, today),
      harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true }),
    ]);
    await harness.waitForData(api => api.pendingWrites === 0 && subTxs(id).length >= 1);
    expect(subTxs(id)).toHaveLength(1);
    expect(sub().closed?.[today]?.txId).toBe(subscriptionTxId(id, today));
  });

  it('العملية موجودة ومعدّلة (100 ← 120) والفترة مش مقفولة ← بتتقفل عليها من غير ما نكتب فوقها', async () => {
    const { walletId, id } = await makeSub({ amount: 100 });
    await setDoc(userDoc('transactions', subscriptionTxId(id, today)), {
      type: 'expense', amount: 120, walletId, date: today, subscriptionId: id, periodKey: today, createdAt: today,
    });
    await harness.waitForData(() => subTxs(id).length === 1);
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 100 }]);
    expect(r.recorded).toEqual([]);
    await harness.waitForData(() => !!sub().closed?.[today]);
    expect(subTxs(id)).toHaveLength(1);
    expect(subTxs(id)[0].amount).toBe(120);
  });
});

describe('المبلغ طلع غلط بعد التسجيل', () => {
  it('تعديل العملية ← المبلغ الجديد يفضل، والتلقائي مبيرجعش يسجل', async () => {
    const { walletId, id } = await makeSub({ chargeMode: 'auto', autoSince: today });
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true });
    await harness.waitForData(() => subTxs(id).length === 1);
    const before = balanceOf(walletId);
    await harness.api().updateTransaction(subTxs(id)[0].id, { amount: 250 });
    await harness.waitForData(() => subTxs(id)[0].amount === 250);
    expect(before - balanceOf(walletId)).toBe(50);
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true });
    expect(r.recorded).toEqual([]);
    expect(subTxs(id)[0].amount).toBe(250);
  });

  it('مسح العملية (اتلغى) ← الفترة بترجع تسأل، التلقائي مبيخصمهاش تاني، والمعاد الجاي زي ما هو', async () => {
    const { walletId, id } = await makeSub({ chargeMode: 'auto', autoSince: today });
    const before = balanceOf(walletId);
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true });
    await harness.waitForData(() => subTxs(id).length === 1);
    expect(harness.api().transactionLinkWarning(subTxs(id)[0].id)).toContain('هترجع تسألك');

    await harness.api().deleteTransaction(subTxs(id)[0].id);
    await harness.waitForData(() => subTxs(id).length === 0 && !!sub().closed?.[today]?.reopened);
    expect(balanceOf(walletId)).toBe(before);
    expect(sub().history).toHaveLength(0);
    // كانت آخر فترة ← المعاد رجع لها (الشاشة بتقول "مستحق" عنها)، وهي بتسأل
    expect(sub().nextDueDate).toBe(today);

    const auto = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true });
    expect(auto.recorded).toEqual([]);

    // ولو اتخصم فعلاً بمبلغ تاني — الكارت بيسجله عادي
    const confirm = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 230 }]);
    expect(confirm.recorded).toEqual([today]);
    await harness.waitForData(() => subTxs(id).length === 1);
    expect(subTxs(id)[0].amount).toBe(230);
    expect(sub().closed?.[today]?.reopened).toBeUndefined();
  });

  it('مسح الفترة اللي رجعت تسأل بـ"ما اتخصمش" ← تتقفل من غير عملية', async () => {
    const { id } = await makeSub({ chargeMode: 'auto', autoSince: today });
    await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }], { auto: true });
    await harness.waitForData(() => subTxs(id).length === 1);
    await harness.api().deleteTransaction(subTxs(id)[0].id);
    await harness.waitForData(() => !!sub().closed?.[today]?.reopened);
    expect(await harness.api().skipSubscriptionCharge(id, today)).toBe('done');
    await harness.waitForData(() => !!sub().closed?.[today]?.skipped);
    expect(subTxs(id)).toHaveLength(0);
  });
});

describe('الجمعية', () => {
  it('تلقائي ← الأقساط المستحقة بس؛ شهر الاستلام بيسأل دايمًا', async () => {
    const { walletId, id, months } = await makeGamiya({ chargeMode: 'auto', autoSince: addMonths(today, -3) });
    const before = balanceOf(walletId);
    const due = months.filter(m => m.dueDate <= today);
    const r = await harness.api().recordCharges('gamiya', id, due.map(m => ({ key: m.id, amount: m.amount })), { auto: true });
    const installments = due.filter(m => !m.isPayoutMonth).map(m => m.id);
    expect(r.recorded).toEqual(installments);
    await harness.waitForData(() => gamiyaTxs(id).length === installments.length);
    expect(gamiyaTxs(id).every(t => t.autoRecorded && t.type === 'expense')).toBe(true);
    expect(gamiyaTxs(id).map(t => t.id).sort()).toEqual(installments.map(m => gamiyaTxId(id, m)).sort());
    expect(before - balanceOf(walletId)).toBe(1000 * installments.length);
    const payout = harness.api().gamiyas[0].months.find(m => m.isPayoutMonth)!;
    expect(payout.status).toBe('pending');
  });

  it('"سدّد" من الشاشة وبعدين التلقائي ← مرة واحدة', async () => {
    const { id, months } = await makeGamiya({ chargeMode: 'auto', autoSince: addMonths(today, -3) });
    const m = months.find(x => !x.isPayoutMonth && x.dueDate <= today)!;
    expect(await harness.api().markGamiyaMonthDone(id, m.id)).toBe('done');
    await harness.waitForData(() => gamiyaTxs(id).length === 1);
    const r = await harness.api().recordCharges('gamiya', id, [{ key: m.id, amount: m.amount }], { auto: true });
    expect(r.recorded).toEqual([]);
    expect(gamiyaTxs(id)).toHaveLength(1);
    expect(gamiyaTxs(id)[0].id).toBe(gamiyaTxId(id, m.id));
  });

  it('جهازين في نفس اللحظة ← قسط واحد', async () => {
    const { id, months } = await makeGamiya({ chargeMode: 'auto', autoSince: addMonths(today, -3) });
    const m = months.find(x => !x.isPayoutMonth && x.dueDate <= today)!;
    await Promise.all([
      harness.api().recordCharges('gamiya', id, [{ key: m.id, amount: m.amount }], { auto: true }),
      harness.api().markGamiyaMonthDone(id, m.id),
    ]);
    await harness.waitForData(api => api.pendingWrites === 0 && gamiyaTxs(id).length >= 1);
    expect(gamiyaTxs(id)).toHaveLength(1);
  });

  it('الجمعية اتأخرت ← مسح القسط بيرجّع الشهر يسأل، والتلقائي مبيخصمهوش تاني', async () => {
    const { walletId, id, months } = await makeGamiya({ chargeMode: 'auto', autoSince: addMonths(today, -3) });
    const m = months.find(x => !x.isPayoutMonth && x.dueDate <= today)!;
    const before = balanceOf(walletId);
    await harness.api().recordCharges('gamiya', id, [{ key: m.id, amount: m.amount }], { auto: true });
    await harness.waitForData(() => gamiyaTxs(id).length === 1);
    await harness.api().deleteTransaction(gamiyaTxs(id)[0].id);
    const month = () => harness.api().gamiyas[0].months.find(x => x.id === m.id)!;
    await harness.waitForData(() => gamiyaTxs(id).length === 0 && !!month().reopened);
    expect(month().status).toBe('pending');
    expect(balanceOf(walletId)).toBe(before);
    const r = await harness.api().recordCharges('gamiya', id, [{ key: m.id, amount: m.amount }], { auto: true });
    expect(r.recorded).toEqual([]);
    // اتدفع بعدين ← "سدّد" بيقفله والعلامة بتتشال
    expect(await harness.api().markGamiyaMonthDone(id, m.id)).toBe('done');
    await harness.waitForData(() => month().status === 'done');
    expect(month().reopened).toBeUndefined();
  });
});

describe('الفشل بيتقال', () => {
  it('المحفظة اتأرشفت ← wallet-missing ومفيش أي خصم', async () => {
    const { walletId, id } = await makeSub();
    await updateDoc(userDoc('wallets', walletId), { archived: true, archivedAt: today });
    await harness.waitForData(api => !!api.wallets.find(w => w.id === walletId)?.archived);
    const r = await harness.api().recordCharges('subscription', id, [{ key: today, amount: 200 }]);
    expect(r).toEqual({ outcome: 'wallet-missing', recorded: [] });
    expect(subTxs(id)).toHaveLength(0);
    expect(sub().closed?.[today]).toBeUndefined();
  });
});

describe('القواعد', () => {
  it('chargeMode غلط بيترفض، والمستند القديم من غير الحقل بيتعدّل عادي', async () => {
    const { id } = await makeSub();
    await expect(updateDoc(userDoc('subscriptions', id), { chargeMode: 'sometimes' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(userDoc('subscriptions', id), { chargeAutoSince: 5 })).rejects.toMatchObject({ code: 'permission-denied' });
    await setDoc(userDoc('subscriptions', 'legacy'), { name: 'قديم', amount: 50, nextDueDate: today });
    await expect(updateDoc(userDoc('subscriptions', 'legacy'), { amount: 60 })).resolves.toBeUndefined();
  });

  it('نفس الكلام للجمعية', async () => {
    const { id } = await makeGamiya();
    await expect(updateDoc(userDoc('gamiyas', id), { chargeMode: 'yes' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(userDoc('gamiyas', id), { chargeMode: 'auto', chargeAutoSince: today })).resolves.toBeUndefined();
  });

  it('autoRecorded لازم bool', async () => {
    const w = harness.api().wallets[0];
    await expect(setDoc(userDoc('transactions', 'x'), {
      type: 'expense', amount: 1, walletId: w.id, date: today, autoRecorded: 'yes',
    })).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
