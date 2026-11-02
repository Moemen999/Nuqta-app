import WalletsScreen from '@/app/settings-screens/wallets';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { ThemeProvider } from '@/context/ThemeContext';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

/**
 * نقل التأكيدات — الدفعة 2 (المحافظ والفئات) عن طريق المكوّن نفسه، مش الـAlert الاحتياطي:
 * تأكيد المسح بشكل التطبيق، ورسالة المنع (زرار واحد) بقت notice.
 */

const cash = { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 };
const bank = { id: 'w2', name: 'البنك', openingBalance: 0, lowAlert: 0 };

const mockData: any = {};
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

function seed(wallets: object[]) {
  Object.assign(mockData, {
    wallets, categories: [], transactions: [], budgets: {}, debts: [],
    subscriptions: [], gamiyas: [], incomes: [], serverReachable: true, loadErrors: [],
    updateWallet: jest.fn(), addWallet: jest.fn(), deleteWallet: jest.fn(async () => ({ outcome: 'done' })),
    archiveWallet: jest.fn(async () => ({ outcome: 'done' })), restoreWallet: jest.fn(),
  });
}
const ui = () => <ThemeProvider><NoticeProvider><ConfirmProvider><WalletsScreen /></ConfirmProvider></NoticeProvider></ThemeProvider>;

it('مسح محفظة من غير تاريخ ← تأكيد التطبيق، و"حذف" بيمسح', async () => {
  seed([cash, bank]);
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('wallet_delete_w1')); });
  expect(screen.getByTestId('confirm_title').props.children).toBe('حذف محفظة');
  expect(mockData.deleteWallet).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(mockData.deleteWallet).toHaveBeenCalledWith('w1');
});

it('"إلغاء" مبيمسحش', async () => {
  seed([cash, bank]);
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('wallet_delete_w1')); });
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_cancel')); });
  expect(mockData.deleteWallet).not.toHaveBeenCalled();
});

it('آخر محفظة شغالة ← رسالة المنع بزرار "تمام" (notice) مش تأكيد', async () => {
  seed([cash]);
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('wallet_delete_w1')); });
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
  expect(screen.getByTestId('notice_title').props.children).toBe('دي آخر محفظة شغالة');
  expect(mockData.deleteWallet).not.toHaveBeenCalled();
});
