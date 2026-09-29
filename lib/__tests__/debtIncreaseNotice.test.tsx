import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DebtIncreaseModal, INSTALLMENTS_CHANGED_TITLE } from '@/components/DebtEntryModals';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import type { Debt } from '@/context/DataContext';

/**
 * زيادة غيّرت عدد الأقساط ← المستخدم بيتقاله، بنفس تنبيه الدفعة بالظبط
 * (`INSTALLMENTS_CHANGED_TITLE` + الجملة اللي راجعة من `addDebtIncrease`).
 * الحساب نفسه مختبَر على المحاكي (`debtIncreaseRecount`)؛ هنا الشاشة بس.
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/components/useDeviceContacts', () => ({ useDeviceContacts: () => ({}) }));

const debt = {
  id: 'd1', direction: 'i_owe', personName: 'صاحبي', totalAmount: 6000, isInstallment: true,
  installmentCount: 6, installmentAmount: 1000, date: '2026-01-01', payments: [], increases: [],
} as unknown as Debt;

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  Object.assign(mockData, { wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], transactions: [] });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

async function save(result: unknown) {
  const onClose = jest.fn();
  mockData.addDebtIncrease = jest.fn(async () => result);
  await render(<ThemeProvider><PrivacyProvider><DebtIncreaseModal debt={debt} onClose={onClose} /></PrivacyProvider></ThemeProvider>);
  await act(async () => { fireEvent.changeText(screen.getByTestId('debt_increase_amount'), '2000'); });
  await act(async () => { fireEvent.press(screen.getByTestId('debt_increase_save')); });
  expect(mockData.addDebtIncrease).toHaveBeenCalledWith('d1', 2000, expect.any(String), 'w1');
  return onClose;
}

it('العدد اتغيّر ← تنبيه "عدد الأقساط اتظبط" بالقديم والجديد، والمودال بيتقفل', async () => {
  const onClose = await save({ outcome: 'done', note: 'بعد الزيادة، الأقساط بقت 8 بدل 6.' });
  expect(alertSpy).toHaveBeenCalledWith(INSTALLMENTS_CHANGED_TITLE, 'بعد الزيادة، الأقساط بقت 8 بدل 6.');
  expect(onClose).toHaveBeenCalled();
});

it('العدد ما اتغيرش ← مفيش تنبيه', async () => {
  const onClose = await save({ outcome: 'done', note: null });
  expect(alertSpy).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

it('الزيادة ما اتسجلتش ← تنبيه الفشل بس، مش تنبيه الأقساط، والمودال مفتوح', async () => {
  const onClose = await save({ outcome: 'failed' });
  expect(alertSpy).toHaveBeenCalledTimes(1);
  expect(alertSpy.mock.calls[0][0]).not.toBe(INSTALLMENTS_CHANGED_TITLE);
  expect(onClose).not.toHaveBeenCalled();
});
