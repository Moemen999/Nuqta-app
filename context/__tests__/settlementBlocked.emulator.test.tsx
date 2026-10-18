import { settleBlockedBody, settleBlockedHint, useArchivedSettlement } from '@/components/ArchivedSettlement';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { db } from '@/firebaseConfig';
import { walletBalance } from '@/lib/finance';
import { maskedAmount, plainAmount } from '@/lib/money';
import { clearFirestore, settle, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { doc, getDocFromServer } from 'firebase/firestore';
import React from 'react';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * مسح عملية على محفظة مؤرشفة ومفيش ولا محفظة شغالة نحط فيها الفرق.
 *
 * قبل كده الحالة دي كانت في نفس السطر مع "مفيش مؤرشفة هتتأثر"، فالمسح كان
 * بيتشغّل من غير تسوية ورصيد المؤرشفة يبعد عن الصفر — وهي مخفية من الإجمالي،
 * فمحدش كان هيشوف. دلوقتي الشيت بتفتح ممنوعة ومفيش ولا كتابة.
 *
 * الهوك والشيت الحقيقيين فوق البروفايدر الحقيقي والمحاكي — مش mock.
 */

const settleHolder: { current: ReturnType<typeof useArchivedSettlement> | null } = { current: null };
function SettleProbe() {
  const s = useArchivedSettlement();
  settleHolder.current = s;
  return <>{s.sheet}</>;
}

let uid: string;
let harness: Awaited<ReturnType<typeof renderDataProvider>>;

beforeEach(async () => {
  await clearFirestore();
  uid = await signInTestUser();
  setMockUid(uid);
  settleHolder.current = null;
  harness = await renderDataProvider(<ThemeProvider><PrivacyProvider><SettleProbe /></PrivacyProvider></ThemeProvider>);
  await harness.waitForReady();
});

afterEach(async () => {
  await harness.unmount();
});

function balanceOf(walletId: string) {
  const api = harness.api();
  const w = api.wallets.find(x => x.id === walletId)!;
  return Math.round(walletBalance(api.transactions, walletId, w.openingBalance) * 100) / 100;
}

const activeCount = () => harness.api().wallets.filter(w => !w.archived).length;
const onServer = async (txId: string) => (await getDocFromServer(doc(db, 'users', uid, 'transactions', txId))).exists();

/** محفظة رصيدها صفر (دخل ومصروف متساويين) اتأرشفت، والمحافظ التانية زي ما هي */
async function archivedWalletWithHistory(amount = 500) {
  const [arch, ...others] = harness.api().wallets;
  await harness.api().addTransaction({ type: 'income', amount, walletId: arch.id, date: '2026-08-01' });
  const expenseId = await harness.api().addTransaction({ type: 'expense', amount, walletId: arch.id, date: '2026-08-02' });
  await harness.waitForData(api => api.transactions.length === 2);
  await harness.api().archiveWallet(arch.id, {});
  await harness.waitForData(api => !!api.wallets.find(w => w.id === arch.id)?.archived);
  expect(balanceOf(arch.id)).toBe(0);
  return { arch, others, expenseId };
}

async function deleteWallets(ids: string[]) {
  for (const id of ids) await harness.api().deleteWallet(id);
  await harness.waitForData(api => ids.every(id => !api.wallets.some(w => w.id === id)));
}

/** نفس اللي `app/modal.tsx` بيعمله في الحذف: الطلب، والتشغيل بيمسح فعلاً */
async function requestDelete(txId: string) {
  const tx = harness.api().transactions.find(t => t.id === txId)!;
  const run = jest.fn((settlements) => { harness.api().deleteTransaction(txId, settlements); });
  await act(async () => { settleHolder.current!.request([{ before: tx }], run); });
  return run;
}

describe('مفيش ولا محفظة شغالة', () => {
  it('حذف عملية على المؤرشفة ← ممنوع: مفيش كتابة، والرصيد صفر زي ما هو', async () => {
    const { arch, others, expenseId } = await archivedWalletWithHistory(500);
    await deleteWallets(others.map(w => w.id));
    expect(activeCount()).toBe(0);

    const run = await requestDelete(expenseId);

    expect(run).not.toHaveBeenCalled();
    expect(screen.getByTestId('settle_blocked')).toBeTruthy();
    expect(screen.queryByTestId('settle_confirm')).toBeNull();
    expect(screen.getByText(settleBlockedBody(arch.name, 500, true, plainAmount))).toBeTruthy();
    expect(screen.getByTestId('settle_blocked_hint').props.children).toBe(settleBlockedHint(true));

    await act(async () => { fireEvent.press(screen.getByTestId('settle_blocked_ok')); });
    expect(screen.queryByTestId('settle_blocked')).toBeNull();
    await settle();

    expect(run).not.toHaveBeenCalled();
    expect(await onServer(expenseId)).toBe(true);
    expect(harness.api().transactions).toHaveLength(2);
    expect(harness.api().transactions.some(t => t.isSettlement)).toBe(false);
    expect(balanceOf(arch.id)).toBe(0);
  });

  it('الكلام بيقول "مسح" مش "التعديل ده"، والمطلوب منه بالظبط', () => {
    expect(settleBlockedBody('توفير', 500, true, plainAmount)).toBe('مسح العملية دي هيزوّد رصيد "توفير" المؤرشفة 500 ج.م.');
    expect(settleBlockedBody('توفير', -500, true, plainAmount)).toBe('مسح العملية دي هينقّص رصيد "توفير" المؤرشفة 500 ج.م.');
    expect(settleBlockedHint(true)).toContain('فما اتمسحش حاجة');
    expect(settleBlockedHint(true)).toContain('رجّع محفظة من الإعدادات ← المحافظ، أو ضيف محفظة جديدة');
  });

  it('والتعديل بكلام التعديل', () => {
    expect(settleBlockedBody('توفير', 100, false, plainAmount)).toBe('التعديل ده هيزوّد رصيد "توفير" المؤرشفة 100 ج.م.');
    // الرفض بيعدّي من `money` بتاعة الإخفاء، مش رقم حقيقي ثابت
    expect(settleBlockedBody('توفير', 100, false, maskedAmount)).toBe('التعديل ده هيزوّد رصيد "توفير" المؤرشفة •••• ج.م.');
    expect(settleBlockedHint(false)).toContain('فما اتعدّلش حاجة');
    expect(settleBlockedHint(false)).toContain('وبعدين عدّل تاني.');
  });

  it('محفظة جديدة اتعملت والشيت الممنوعة مفتوحة ← بتبقى عادية ولازم يختار، ومفيش كتابة لوحدها', async () => {
    const { others, expenseId } = await archivedWalletWithHistory(500);
    await deleteWallets(others.map(w => w.id));
    const run = await requestDelete(expenseId);
    expect(screen.getByTestId('settle_blocked')).toBeTruthy();

    await harness.api().addWallet('جديدة');
    await waitFor(() => expect(screen.getByTestId('settle_sheet')).toBeTruthy());
    expect(screen.getByTestId('settle_confirm').props.accessibilityState?.disabled).toBe(true);
    await settle();

    expect(run).not.toHaveBeenCalled();
    expect(await onServer(expenseId)).toBe(true);
  });
});

describe('المؤرشفة اتغيّرت والشيت مفتوحة — الفرق بيتحسب تاني', () => {
  it('المؤرشفة رجعت ← الشيت بتتقفل ومفيش مسح ولا تسوية', async () => {
    const { arch, others, expenseId } = await archivedWalletWithHistory(500);
    await deleteWallets([others[1].id]);
    const run = await requestDelete(expenseId);
    expect(screen.getByTestId('settle_sheet')).toBeTruthy();

    await harness.api().restoreWallet(arch.id);
    await waitFor(() => expect(screen.queryByTestId('settle_sheet')).toBeNull());
    await settle();

    expect(run).not.toHaveBeenCalled();
    expect(await onServer(expenseId)).toBe(true);
    expect(harness.api().transactions.some(t => t.isSettlement)).toBe(false);
  });

  it('محفظة تانية اتأرشفت بعد الفتح ← كارت ليها، و"احفظ" مقفول لحد ما يختار للاتنين', async () => {
    const { arch, others } = await archivedWalletWithHistory(500);
    const [moved, target] = others;
    // تحويل من المؤرشفة لمحفظة لسه شغالة: مسحه بيلمس الاتنين لو التانية اتأرشفت
    const transferId = await harness.api().addTransaction({
      type: 'withdraw', amount: 200, walletId: arch.id, toWalletId: moved.id, date: '2026-08-03',
    });
    await harness.waitForData(api => api.transactions.some(t => t.id === transferId));
    const archBefore = balanceOf(arch.id);
    const movedBefore = balanceOf(moved.id);
    const run = await requestDelete(transferId);
    await act(async () => { fireEvent.press(screen.getByText(target.name)); });
    expect(screen.getByTestId('settle_confirm').props.accessibilityState?.disabled).toBe(false);

    await harness.api().archiveWallet(moved.id, {});
    await waitFor(() => expect(screen.getByText(new RegExp(`رصيد "${moved.name}" المؤرشفة`))).toBeTruthy());
    expect(screen.getByTestId('settle_confirm').props.accessibilityState?.disabled).toBe(true);

    const chips = screen.getAllByText(target.name);
    await act(async () => { fireEvent.press(chips[chips.length - 1]); });
    await act(async () => { fireEvent.press(screen.getByTestId('settle_confirm')); });

    expect(run).toHaveBeenCalledTimes(1);
    const settlements = run.mock.calls[0][0];
    expect(settlements.map((s: { archivedWalletId: string }) => s.archivedWalletId).sort()).toEqual([arch.id, moved.id].sort());
    await harness.waitForData(api => !api.transactions.some(t => t.id === transferId));
    await settle();
    // المؤرشفتين رصيدهم زي ما كان قبل المسح بالظبط — ده اللي التسوية بتضمنه
    expect(movedBefore).toBe(200);
    expect(balanceOf(arch.id)).toBe(archBefore);
    expect(balanceOf(moved.id)).toBe(movedBefore);
  });

  it('المحفظة اللي اختارها اتمسحت ← "احفظ" بيتقفل تاني', async () => {
    const { others, expenseId } = await archivedWalletWithHistory(500);
    const [picked, other] = others;
    const run = await requestDelete(expenseId);
    await act(async () => { fireEvent.press(screen.getByText(picked.name)); });
    expect(screen.getByTestId('settle_confirm').props.accessibilityState?.disabled).toBe(false);

    await deleteWallets([picked.id]);
    await waitFor(() => expect(screen.getByTestId('settle_confirm').props.accessibilityState?.disabled).toBe(true));
    expect(screen.getByText(other.name)).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('الحالات اللي لازم تفضل زي ما هي', () => {
  it('عملية مش على مؤرشفة (مفيش فرق) ← بتتمسح على طول من غير شيت', async () => {
    const { others } = await archivedWalletWithHistory(500);
    const txId = await harness.api().addTransaction({ type: 'expense', amount: 50, walletId: others[0].id, date: '2026-08-03' });
    await harness.waitForData(api => api.transactions.some(t => t.id === txId));

    const run = await requestDelete(txId);

    expect(run).toHaveBeenCalledWith([]);
    expect(screen.queryByTestId('settle_sheet')).toBeNull();
    expect(screen.queryByTestId('settle_blocked')).toBeNull();
    await harness.waitForData(api => !api.transactions.some(t => t.id === txId));
    await settle();
    expect(await onServer(txId)).toBe(false);
  });

  it('فيه محفظة شغالة ← الشيت العادية بالاختيارات، مش الممنوعة', async () => {
    const { others, expenseId } = await archivedWalletWithHistory(500);
    await deleteWallets([others[1].id]);
    expect(activeCount()).toBe(1);

    const run = await requestDelete(expenseId);

    expect(screen.getByTestId('settle_sheet')).toBeTruthy();
    expect(screen.queryByTestId('settle_blocked')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('آخر محفظة شغالة اتمسحت والشيت مفتوحة ← بتبقى ممنوعة، ومفيش كتابة', async () => {
    const { arch, others, expenseId } = await archivedWalletWithHistory(500);
    await deleteWallets([others[1].id]);
    const run = await requestDelete(expenseId);
    expect(screen.getByTestId('settle_sheet')).toBeTruthy();

    await deleteWallets([others[0].id]);
    await waitFor(() => expect(screen.getByTestId('settle_blocked')).toBeTruthy());
    expect(screen.queryByTestId('settle_confirm')).toBeNull();
    await settle();

    expect(run).not.toHaveBeenCalled();
    expect(await onServer(expenseId)).toBe(true);
    expect(balanceOf(arch.id)).toBe(0);
  });
});
