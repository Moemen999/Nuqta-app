import { PrivacyProvider } from '@/context/PrivacyContext';
import WalletsScreen from '@/app/settings-screens/wallets';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { ThemeProvider } from '@/context/ThemeContext';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

/**
 * الميزة 6، الجولة الأخيرة (بند 7): خانات المحفظة كانت بترمي «٢٠٠٠» و«1,500» وترجع للمحفوظ ساكت. دلوقتي بتتقري زي
 * الميزانية، والغامض («1,5») بيترفض **وبيتقال**. اتكتب قبل التصليح واتشاف أحمر.
 */
const cash = { id: 'w1', name: 'كاش', openingBalance: 1000, lowAlert: 100 };

const mockData: any = {};
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

beforeEach(() => {
  Object.assign(mockData, {
    wallets: [cash], categories: [], transactions: [], brokenTransactions: [], budgets: {}, debts: [],
    subscriptions: [], gamiyas: [], incomes: [], serverReachable: true, loadErrors: [], figuresPending: [], undelivered: [],
    updateWallet: jest.fn(), addWallet: jest.fn(), deleteWallet: jest.fn(), archiveWallet: jest.fn(), restoreWallet: jest.fn(),
  });
});
const ui = () => <ThemeProvider><NoticeProvider><ConfirmProvider><PrivacyProvider><WalletsScreen /></PrivacyProvider></ConfirmProvider></NoticeProvider></ThemeProvider>;

it('حد التنبيه «٢٠٠» بالأرقام العربية بيتحفظ 200', async () => {
  await render(ui());
  const input = screen.getByTestId('wallet_alert_input_w1');
  await act(async () => { fireEvent.changeText(input, '٢٠٠'); });
  await act(async () => { fireEvent(input, 'blur'); });
  expect(mockData.updateWallet).toHaveBeenCalledWith('w1', { lowAlert: 200 });
});

it('حد التنبيه «1,5» مرفوض وبيتقال باسم المحفظة', async () => {
  await render(ui());
  const input = screen.getByTestId('wallet_alert_input_w1');
  await act(async () => { fireEvent.changeText(input, '1,5'); });
  await act(async () => { fireEvent(input, 'blur'); });
  expect(mockData.updateWallet).not.toHaveBeenCalled();
  expect(screen.getByTestId('notice_title').props.children).toBe('الرقم ده ما اتحفظش');
  expect(screen.getByTestId('notice_body').props.children).toMatch(/حد التنبيه لمحفظة "كاش"/);
});

it('الرصيد الابتدائي «abc» مرفوض وبيتقال (كان بيرجع ساكت)', async () => {
  await render(ui());
  const input = screen.getByTestId('wallet_opening_input_w1');
  await act(async () => { fireEvent.changeText(input, 'abc'); });
  await act(async () => { fireEvent(input, 'blur'); });
  expect(mockData.updateWallet).not.toHaveBeenCalled();
  expect(screen.getByTestId('notice_body').props.children).toMatch(/الرصيد الابتدائي لمحفظة "كاش"/);
});
