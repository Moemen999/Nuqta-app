import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DebtIncreaseModal } from '@/components/DebtEntryModals';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import type { Debt } from '@/context/DataContext';
import { DUE_MOVED_TITLE } from '@/lib/reopenDue';

/** بند 12: الزيادة اللي فتحت دين متسدد بتقول "المعاد الجاي بقى …" — لوحدها، أو جوه رسالة العدد */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/components/useDeviceContacts', () => ({
  useDeviceContacts: () => ({ contacts: [], visible: false, open: jest.fn(), close: jest.fn(), createContact: jest.fn() }),
}));

const debt = {
  id: 'd1', direction: 'i_owe', personName: 'صاحبي', totalAmount: 1000, isInstallment: false,
  date: '2026-01-01', payments: [], increases: [],
} as unknown as Debt;
const DUE = 'الزيادة فتحت الدين تاني، فالمعاد الجاي بقى 15 ديسمبر 2026.';

function seed(result: Record<string, unknown>) {
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [], transactions: [],
    addDebtIncrease: jest.fn(async () => ({ outcome: 'done', ...result })),
  });
}

async function increase() {
  await render(<ThemeProvider><NoticeProvider><PrivacyProvider><DebtIncreaseModal debt={debt} onClose={jest.fn()} /></PrivacyProvider></NoticeProvider></ThemeProvider>);
  await act(async () => { fireEvent.changeText(screen.getByTestId('debt_increase_amount'), '500'); });
  await act(async () => { fireEvent.press(screen.getByTestId('debt_increase_save')); });
}

it('المعاد بس اتغيّر ← رسالة بعنوانها', async () => {
  seed({ note: null, dueNote: DUE });
  await increase();
  expect(screen.getByText(DUE_MOVED_TITLE)).toBeTruthy();
  expect(screen.getByText(DUE)).toBeTruthy();
});

it('العدد والمعاد اتغيّروا ← رسالة واحدة فيها الاتنين', async () => {
  seed({ note: 'بعد الزيادة، الأقساط بقت 4 بدل 3.', dueNote: DUE });
  await increase();
  expect(screen.getByText(`بعد الزيادة، الأقساط بقت 4 بدل 3.\n${DUE}`)).toBeTruthy();
});

it('مفيش تغيير في المعاد ← مفيش رسالة معاد', async () => {
  seed({ note: null, dueNote: null });
  await increase();
  expect(screen.queryByText(DUE_MOVED_TITLE)).toBeNull();
});
