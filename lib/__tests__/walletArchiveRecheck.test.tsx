import WalletsScreen from '@/app/settings-screens/wallets';
import { ThemeProvider } from '@/context/ThemeContext';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

/**
 * شروط الأرشفة بتتفحص تاني **وقت التأكيد** مش وقت فتح الشيت بس.
 *
 * money-reviewer (2026-09-25): الرصيد كان بيتفحص لما الشيت يتفتح. لو وهو
 * مفتوح جهاز تاني سجّل عملية على المحفظة، أو مسح جمعية/اشتراك ومعاهم
 * دفعاتهم، المحفظة كانت بتتأرشف ورصيدها مش صفر — ومفيش حاجة بتقول.
 * (قبل تفويت المحذوف في `archiveWallet` الحالة التانية كانت بتقع بالصدفة
 * برسالة عامة؛ بعده بقت بتعدّي ساكتة.)
 */

const wallets = [
  { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 },
  { id: 'w2', name: 'البنك', openingBalance: 0, lowAlert: 0 },
];
const gamiya = {
  id: 'g1', name: 'جمعية الشغل', walletId: 'w1', monthlyAmount: 500, totalMonths: 2, payoutMonthIndex: 2,
  payoutAmount: 1000, startDate: '2026-09-01', reminderDaysBefore: 2,
  months: [
    { id: 'm1', monthIndex: 1, dueDate: '2026-09-01', isPayoutMonth: false, amount: 500, status: 'done', transactionId: 't1' },
    { id: 'm2', monthIndex: 2, dueDate: '2026-10-01', isPayoutMonth: true, amount: 1000, status: 'pending' },
  ],
};
// الرصيد صفر: دخل 500 ودفعة الجمعية 500
const baseTxs = [
  { id: 't0', type: 'income', amount: 500, walletId: 'w1', date: '2026-09-01' },
  { id: 't1', type: 'expense', amount: 500, walletId: 'w1', date: '2026-09-01' },
];

const mockData: any = {};
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  Object.assign(mockData, {
    wallets, categories: [], transactions: baseTxs, budgets: {}, debts: [],
    subscriptions: [], gamiyas: [gamiya], incomes: [], serverReachable: true,
    updateWallet: jest.fn(), addWallet: jest.fn(), deleteWallet: jest.fn(),
    archiveWallet: jest.fn(), restoreWallet: jest.fn(),
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

const ui = () => <ThemeProvider><WalletsScreen /></ThemeProvider>;

/** "امسح" ← "أرشفها" ← الشيت مفتوح وجمعية الشغل رايحة للبنك */
async function openSheetAndAssign() {
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('wallet_delete_w1')); });
  const buttons = alertSpy.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  await act(async () => { buttons.find(b => b.text === 'أرشفها')!.onPress!(); });
  const chips = screen.getAllByText('البنك');
  await act(async () => { fireEvent.press(chips[chips.length - 1]); });
  alertSpy.mockClear();
}

async function confirm() {
  await screen.rerender(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('archive_sheet_confirm')); });
}

it('مفيش حاجة اتغيّرت ← بتتأرشف والجمعية بتتنقل', async () => {
  await openSheetAndAssign();
  await confirm();
  expect(mockData.archiveWallet).toHaveBeenCalledWith('w1', { subscriptions: {}, gamiyas: { g1: 'w2' }, incomes: {} });
});

it('عملية جديدة على المحفظة والشيت مفتوح ← مفيش أرشفة، ورسالة الرصيد', async () => {
  await openSheetAndAssign();
  mockData.transactions = [...baseTxs, { id: 't9', type: 'expense', amount: 120, walletId: 'w1', date: '2026-09-25' }];
  await confirm();
  expect(mockData.archiveWallet).not.toHaveBeenCalled();
  expect(alertSpy).toHaveBeenCalledWith('رصيدها لسه مش صفر', expect.stringContaining('كاش'), expect.anything());
});

it('الجمعية اتمسحت من جهاز تاني ومعاها دفعتها ← الرصيد بقى +500، مفيش أرشفة', async () => {
  await openSheetAndAssign();
  mockData.gamiyas = [];
  mockData.transactions = baseTxs.filter(t => t.id !== 't1');
  await confirm();
  expect(mockData.archiveWallet).not.toHaveBeenCalled();
  expect(alertSpy).toHaveBeenCalledWith('رصيدها لسه مش صفر', expect.anything(), expect.anything());
});

it('المحفظة نفسها اتمسحت من جهاز تاني والشيت مفتوح ← مفيش أرشفة، ورسالة إنها اتمسحت', async () => {
  await openSheetAndAssign();
  mockData.wallets = wallets.filter(w => w.id !== 'w1');
  await confirm();
  expect(mockData.archiveWallet).not.toHaveBeenCalled();
  expect(alertSpy).toHaveBeenCalledWith('المحفظة دي اتمسحت', expect.stringContaining('كاش'), expect.anything());
});

it('الجمعية اختفت بس دفعتها لسه ما اتشالتش من الرصيد (listeners منفصلة) ← مفيش أرشفة على رقم قديم', async () => {
  await openSheetAndAssign();
  mockData.gamiyas = [];
  await confirm();
  expect(mockData.archiveWallet).not.toHaveBeenCalled();
  expect(alertSpy).toHaveBeenCalledWith('فيه حاجة اتغيّرت', expect.stringContaining('كاش'), expect.anything());
});
