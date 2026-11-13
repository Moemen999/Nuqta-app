import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import DebtsTabScreen from '@/app/(tabs)/debts';
import { NoticeProvider } from '@/components/NoticeProvider';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { DUE_NOT_RESTORED } from '@/lib/reopenDue';

/**
 * بند 12 (جولة 1): تأكيد مسح الزيادة اتحسب من حالة الرياكت ووعد إن المعاد هيرجع؛ الذرة بتقرا من السيرفر.
 * لو ما رجّعتوش (الدين اتغيّر من جهاز تاني) ← رسالة "المعاد ما رجعش"، مش وعد ساكت. والكارت بيعرض "15 مارس".
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/components/useDeviceContacts', () => ({ useDeviceContacts: () => ({}) }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));

const W = { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 };
// 3000 على 3 اتسدد، وزيادة 500 فتحته وقدّمت المعاد من 03-15 لـ 12-15
const debt = {
  id: 'd1', direction: 'i_owe', personName: 'صاحبي', totalAmount: 3000, isInstallment: true, installmentCount: 4,
  installmentAmount: 1000, date: '2026-01-01', createdAt: 'x', dueDate: '2026-12-15', initialTransactionId: 't0', initialWalletId: 'w1',
  payments: [1, 2, 3].map(i => ({ id: `p${i}`, date: '2026-02-01', amount: 1000, walletId: 'w1', transactionId: `tp${i}` })),
  increases: [{ id: 'i1', date: '2026-11-05', amount: 500, walletId: 'w1', transactionId: 'ti1', reopenedFrom: '2026-03-15', reopenedTo: '2026-12-15' }],
};

function seed(restored: string | null, entryGone = false) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    debts: [debt], wallets: [W], categories: [], transactions: [], loadErrors: [], figuresPending: [], pendingTxIds: new Set(),
    subscriptions: [], gamiyas: [],
    deleteDebt: jest.fn(), deleteDebtPayment: jest.fn(),
    deleteDebtIncrease: jest.fn(async (_d: string, _e: string, out?: { dueRestored?: string | null; entryGone?: boolean }) => {
      if (out) { out.dueRestored = entryGone ? undefined : restored; out.entryGone = entryGone; }
      return 'done';
    }),
  });
}

// الساعة بس متثبّتة (13 نوفمبر 2026) — المؤقتات حقيقية (الشاشة بتستنى async)
beforeEach(() => { jest.useFakeTimers({ now: new Date(2026, 10, 13, 12, 0, 0), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] }); });
afterEach(() => jest.useRealTimers());

async function deleteIncrease() {
  await render(<ThemeProvider><NoticeProvider><ConfirmProvider><PrivacyProvider><DebtsTabScreen /></PrivacyProvider></ConfirmProvider></NoticeProvider></ThemeProvider>);
  await act(async () => { fireEvent.press(screen.getByText('صاحبي')); });
  await act(async () => { fireEvent.press(screen.getByTestId('debt_entry_delete_i1')); });
  // التأكيد وعد بالرجوع
  expect(screen.getByText(/معاد القسط الجاي هيرجع 15 مارس/)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
}

it('الذرة رجّعت المعاد اللي اتوعد بيه ← مفيش رسالة زيادة', async () => {
  seed('2026-03-15');
  await deleteIncrease();
  expect(mockData.deleteDebtIncrease).toHaveBeenCalledWith('d1', 'i1', expect.any(Object));
  expect(screen.queryByText(DUE_NOT_RESTORED.title)).toBeNull();
});

it('الذرة ما رجّعتوش ← "المعاد ما رجعش"', async () => {
  seed(null);
  await deleteIncrease();
  expect(screen.getByText(DUE_NOT_RESTORED.title)).toBeTruthy();
});

it('الزيادة كانت اتمسحت من جهاز تاني ← مفيش "المعاد ما رجعش" (جولة 2)', async () => {
  seed(null, true);
  await deleteIncrease();
  expect(screen.queryByText(DUE_NOT_RESTORED.title)).toBeNull();
});

describe('سطر الدين المتأخر: «معاده …» من غير سنة لو السنة دي (13 نوفمبر 2026)', () => {
  const overdue = (dueDate: string) => ({
    id: 'd2', direction: 'owed_to_me', personName: 'فلان', totalAmount: 200, date: '2026-01-01', createdAt: 'x', dueDate,
    payments: [], increases: [], initialTransactionId: 't9', initialWalletId: 'w1',
  });
  const line = async (dueDate: string) => {
    seed(null);
    mockData.debts = [overdue(dueDate)];
    await render(<ThemeProvider><NoticeProvider><ConfirmProvider><PrivacyProvider><DebtsTabScreen /></PrivacyProvider></ConfirmProvider></NoticeProvider></ThemeProvider>);
    return screen.getByText(/معاده/).props.children.flat().join('');
  };
  it('نفس السنة', async () => {
    const t = await line('2026-09-15');
    expect(t).toContain('متأخر — ');
    expect(t).toContain('معاده 15 سبتمبر');
    expect(t).not.toContain('2026');
  });
  it('سنة تانية: السنة بتفضل', async () => {
    expect(await line('2025-09-15')).toContain('معاده 15 سبتمبر 2025');
  });
});
