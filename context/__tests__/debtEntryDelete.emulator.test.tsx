import { disableNetwork, doc, enableNetwork, updateDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import type { Debt } from '@/context/DataContext';
import { debtEntryDeletePlan, walletBalance, type DebtEntryKind } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * تأكيد مسح الدفعة/الزيادة بيقول "الفلوس هترجع لمحفظة X" أو "هتتشال منها"
 * **قبل** الدوسة. الكلام ده وعد، والاختبار ده بيتأكد إن الرصيد بعد المسح
 * الفعلي على السيرفر بيعمل بالظبط اللي الرسالة قالته — في الأربع حالات،
 * ومعاه عدد الأقساط.
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

function balanceOf(walletId: string) {
  const w = harness.api().wallets.find(x => x.id === walletId)!;
  return walletBalance(harness.api().transactions, w.id, w.openingBalance);
}

async function setup(direction: Debt['direction'], kind: DebtEntryKind) {
  const w = harness.api().wallets[0];
  await harness.api().addDebt({
    direction, personName: 'صاحبي', totalAmount: 6000,
    isInstallment: true, installmentCount: 6, walletId: w.id, date: '2026-01-01',
  });
  await harness.waitForData(api => api.debts.length === 1);
  const debtId = harness.api().debts[0].id;

  if (kind === 'payment') {
    // 700 بدل 1000 ⇒ العدد بيطلع 7، فالمسح لازم يرجّعه 6
    await harness.api().addDebtPayment(debtId, 700, w.id, '2026-02-01');
    await harness.waitForData(api => (api.debts[0].payments || []).length === 1);
  } else {
    await harness.api().addDebtIncrease(debtId, 700, '2026-02-01', w.id);
    await harness.waitForData(api => (api.debts[0].increases || []).length === 1);
  }
  const debt = harness.api().debts[0];
  const entry = (kind === 'payment' ? debt.payments : debt.increases)[0];
  await harness.waitForData(api => api.transactions.some(t => t.id === entry.transactionId));
  return { walletId: w.id, debtId, entryId: entry.id };
}

describe.each([
  ['owed_to_me', 'payment'],
  ['i_owe', 'payment'],
  ['owed_to_me', 'increase'],
  ['i_owe', 'increase'],
] as const)('%s / %s', (direction, kind) => {
  it('الرصيد بعد المسح بيعمل اللي التأكيد قاله', async () => {
    const { walletId, debtId, entryId } = await setup(direction, kind);
    const plan = debtEntryDeletePlan(harness.api().debts[0], kind, entryId)!;
    expect(plan.walletId).toBe(walletId);
    const before = balanceOf(walletId);

    const del = kind === 'payment' ? harness.api().deleteDebtPayment : harness.api().deleteDebtIncrease;
    expect(await del(debtId, entryId)).toBe('done');
    await harness.waitForData(api => balanceOf(walletId) !== before);

    const delta = balanceOf(walletId) - before;
    expect(delta).toBe(plan.walletEffect === 'returns' ? 700 : -700);
  });

  it('وعدد الأقساط بيبقى اللي التأكيد قاله', async () => {
    const { debtId, entryId } = await setup(direction, kind);
    const debt = harness.api().debts[0];
    const plan = debtEntryDeletePlan(debt, kind, entryId)!;
    const expected = plan.countAfter ?? debt.installmentCount;

    const del = kind === 'payment' ? harness.api().deleteDebtPayment : harness.api().deleteDebtIncrease;
    expect(await del(debtId, entryId)).toBe('done');
    await harness.waitForData(api => {
      const d = api.debts[0];
      return (kind === 'payment' ? d.payments : d.increases || []).length === 0;
    });
    expect(harness.api().debts[0].installmentCount).toBe(expected);
  });
});

/**
 * من غير نت المسح بيرفض على طول (قاعدة 7): `DEBT_ENTRY_DELETE_ALERT` بيقول
 * "ما اتمسحش حاجة والرصيد زي ما هو" — والاختبار ده بيتأكد إن ده حقيقي:
 * السجل موجود، والعملية المالية موجودة، والرد جه في أقل من ثانيتين.
 */
describe('من غير نت', () => {
  it.each(['payment', 'increase'] as const)('%s: بيرفض على طول ومفيش حاجة بتتمسح', async kind => {
    const { walletId, debtId, entryId } = await setup('i_owe', kind);
    await harness.waitForData(api => api.pendingWrites === 0 && api.serverReachable === true);
    const before = balanceOf(walletId);

    // `enableNetwork` هنا في finally مش في afterEach: ندهه والنت شغال وبعده
    // unmount على طول بيوقّع الـSDK نفسه (INTERNAL ASSERTION b815) في الاختبار اللي بعده
    await disableNetwork(db);
    try {
      await harness.waitForData(api => api.serverReachable === false);

      const del = kind === 'payment' ? harness.api().deleteDebtPayment : harness.api().deleteDebtIncrease;
      const t0 = Date.now();
      expect(await del(debtId, entryId)).toBe('no-connection');
      expect(Date.now() - t0).toBeLessThan(2000);

      const d = harness.api().debts[0];
      expect((kind === 'payment' ? d.payments : d.increases).map(e => e.id)).toContain(entryId);
      expect(balanceOf(walletId)).toBe(before);
    } finally {
      await enableNetwork(db);
      await harness.waitForData(api => api.serverReachable === true);
    }
  });
});

/**
 * الشاشة بتمنع مسح دفعة محفظتها مؤرشفة قبل التأكيد، بس المحفظة ممكن تتأرشف
 * من جهاز تاني بين الدوسة والمسح. الفحص جوه الذرة هو اللي بيمنع رصيد
 * المؤرشفة يتغيّر من غير تسوية.
 */
describe('المحفظة اتأرشفت من جهاز تاني', () => {
  it.each(['payment', 'increase'] as const)('%s: المسح بيترفض والرصيد والسجل زي ما هما', async kind => {
    const { walletId, debtId, entryId } = await setup('i_owe', kind);
    const before = balanceOf(walletId);
    // كتابة مباشرة زي جهاز تاني — من غير ما الشاشة هنا تعرف
    await updateDoc(doc(db, 'users', getMockUid(), 'wallets', walletId), {
      archived: true, archivedAt: new Date().toISOString(),
    });

    const del = kind === 'payment' ? harness.api().deleteDebtPayment : harness.api().deleteDebtIncrease;
    expect(await del(debtId, entryId)).toBe('wallet-missing');

    const d = harness.api().debts[0];
    expect((kind === 'payment' ? d.payments : d.increases).map(e => e.id)).toContain(entryId);
    expect(balanceOf(walletId)).toBe(before);
  });
});
