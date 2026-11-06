import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import DebtsTabScreen from '@/app/(tabs)/debts';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/** دراسة الشكل خطوة 3 (ب): الأحمر = متأخر بس — "عليا" مش متأخر مش أحمر، والمتأخر بيتقال بالكلام كمان */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/components/useDeviceContacts', () => ({ useDeviceContacts: () => ({}) }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));

const base = { direction: 'i_owe', totalAmount: 500, isInstallment: false, date: '2026-01-01', payments: [], increases: [] };
it('عليا مش متأخر ← مش أحمر؛ عليا متأخر ← "متأخر" بالأحمر', async () => {
  Object.assign(mockData, {
    debts: [{ ...base, id: 'a', personName: 'لسه', dueDate: '2099-01-01' }, { ...base, id: 'b', personName: 'فات', dueDate: '2020-01-01' }],
    wallets: [], categories: [], transactions: [], loadErrors: [], subscriptions: [], gamiyas: [],
  });
  await render(<ThemeProvider><NoticeProvider><PrivacyProvider><DebtsTabScreen /></PrivacyProvider></NoticeProvider></ThemeProvider>);
  const late = screen.getByText(/متأخر — معاده/);
  expect(StyleSheet.flatten(late.props.style).color).toBeDefined();
  const lines = screen.getAllByText(/معاده/);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const colorOf = (n: any) => StyleSheet.flatten(n.props.style)?.color;
  const notLate = lines.find(n => !String(n.props.children).includes('متأخر'))!;
  expect(colorOf(notLate)).not.toBe(colorOf(late));
});
