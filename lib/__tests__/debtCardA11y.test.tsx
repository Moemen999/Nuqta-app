import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import DebtsTabScreen from '@/app/(tabs)/debts';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/** بند E جولة 2: كارت الدين بيقول مفتوح ولا مقفول، وجهة الاتصال "إجراء" عليه (الزرار اللي جواه TalkBack مبيوصلوش) */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/components/useDeviceContacts', () => ({ useDeviceContacts: () => ({}) }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));

beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    debts: [{ id: 'd1', personName: 'أحمد', personPhone: '0100', direction: 'owed_to_me', totalAmount: 100, isInstallment: false, date: '2026-07-01', createdAt: 'x', payments: [], increases: [] }],
    wallets: [], categories: [], transactions: [], loadErrors: [], figuresPending: [], pendingTxIds: new Set(), subscriptions: [], gamiyas: [],
    deleteDebt: jest.fn(), deleteDebtPayment: jest.fn(), deleteDebtIncrease: jest.fn(),
  });
});

it('الكارت: expanded بيتغيّر مع الدوسة، وفيه إجراء "افتح كارت أحمد"', async () => {
  await render(<ThemeProvider><NoticeProvider><PrivacyProvider><DebtsTabScreen /></PrivacyProvider></NoticeProvider></ThemeProvider>);
  const head = screen.getAllByRole('button').find(b => b.props.accessibilityState?.expanded !== undefined)!;
  expect(head.props.accessibilityState.expanded).toBe(false);
  expect(head.props.accessibilityActions).toEqual([{ name: 'openContact', label: 'افتح كارت أحمد' }]);
  await act(async () => { fireEvent.press(head); });
  const after = screen.getAllByRole('button').find(b => b.props.accessibilityState?.expanded !== undefined)!;
  expect(after.props.accessibilityState.expanded).toBe(true);
});
