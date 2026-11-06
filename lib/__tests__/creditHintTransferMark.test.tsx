import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AddDebtModal, DebtIncreaseModal } from '@/components/DebtEntryModals';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import type { Debt } from '@/context/DataContext';
import { CREDIT_PURCHASE_HINT } from '@/lib/spending';

/** قرار مؤمن 2026-11-06: سطر تحذير الشرا بالأجل (العلامة في `transferMarkArchive.test`) */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/components/useDeviceContacts', () => ({
  useDeviceContacts: () => ({ contacts: [], visible: false, open: jest.fn(), close: jest.fn(), createContact: jest.fn() }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const wrap = (ui: React.ReactElement) => <ThemeProvider><NoticeProvider><PrivacyProvider>{ui}</PrivacyProvider></NoticeProvider></ThemeProvider>;
beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [], transactions: [],
    addDebt: jest.fn(async () => {}), addDebtIncrease: jest.fn(async () => ({ outcome: 'done', note: null })),
  });
});

it('دين جديد: السطر بيظهر بس مع "عليا" ومن غير محفظة', async () => {
  await render(wrap(<AddDebtModal onClose={() => {}} />));
  expect(screen.queryByTestId('debt_credit_hint')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByText('لأ (بالأجل مثلاً)')); });
  expect(screen.queryByTestId('debt_credit_hint')).toBeNull(); // "ليا" الافتراضي
  await act(async () => { fireEvent.press(screen.getByText('عليا (هو قرضني)')); });
  expect(screen.getByTestId('debt_credit_hint').props.children).toBe(CREDIT_PURCHASE_HINT);
});

it('زيادة دين "عليا" بالأجل ← السطر؛ "ليا" ← مفيش', async () => {
  const debt = (direction: string) => ({ id: 'd1', direction, personName: 'س', totalAmount: 100, date: '2026-01-01', payments: [], increases: [] }) as unknown as Debt;
  const r = await render(wrap(<DebtIncreaseModal debt={debt('i_owe')} onClose={() => {}} />));
  await act(async () => { fireEvent.press(screen.getByText('لأ (بالأجل)')); });
  expect(screen.getByTestId('debt_increase_credit_hint')).toBeTruthy();
  r.unmount();
  await render(wrap(<DebtIncreaseModal debt={debt('owed_to_me')} onClose={() => {}} />));
  await act(async () => { fireEvent.press(screen.getByText('لأ (بالأجل)')); });
  expect(screen.queryByTestId('debt_increase_credit_hint')).toBeNull();
});

