import React from 'react';
import { render, screen } from '@testing-library/react-native';
import AddTransactionModal from '@/app/modal';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { warmUp } from '@/test-utils/warmUp';

/**
 * المودال اتفتح على عملية (`id`) ومش لاقيها — اتمسحت من جهاز تاني قبل الفتح
 * أو وهو مفتوح. قبل كده `isEdit = !!existing` كان بيقلب الفورم لـ"عملية جديدة"
 * والحفظ بيضيف نسخة تانية من الفلوس ساكت. بقت مهمة أكتر من بند 14: الأرشيف
 * بيفتح أي عملية، مش أحدث 10 بس (silent-failure-hunter).
 */

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const wallet = { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 };
const tx = { id: 't1', type: 'expense', amount: 50, walletId: 'w1', date: '2026-01-02' };

function seed(transactions: object[]) {
  Object.assign(mockData, {
    wallets: [wallet], categories: [], debts: [], subscriptions: [], gamiyas: [], incomes: [], linkSourcesReady: true, loadErrors: [], retryLoad: jest.fn(), transactions,
    addTransaction: jest.fn(), updateTransaction: jest.fn(), deleteTransaction: jest.fn(), transactionLinkWarning: () => null,
  });
}

beforeEach(() => { mockParams = { id: 't1' }; seed([tx]); });

const ui = () => <ThemeProvider><PrivacyProvider><AddTransactionModal /></PrivacyProvider></ThemeProvider>;
warmUp(() => { seed([tx]); return ui(); });

it('العملية مش موجودة من الأول ← رسالة ورجوع، مش فورم إضافة', async () => {
  seed([]);
  await render(ui());
  expect(screen.getByTestId('tx_missing')).toBeTruthy();
  expect(screen.queryByText('عملية جديدة')).toBeNull();
  expect(screen.queryByTestId('tx_save_button')).toBeNull();
});

it('العملية اتمسحت والفورم مفتوح ← الفورم بيتقفل ومفيش إضافة', async () => {
  const r = await render(ui());
  expect(screen.getByTestId('tx_save_button')).toBeTruthy();
  seed([]);
  await r.rerender(ui());
  expect(screen.getByTestId('tx_missing')).toBeTruthy();
  expect(screen.queryByTestId('tx_save_button')).toBeNull();
  expect(mockData.addTransaction).not.toHaveBeenCalled();
});

it('من غير `id` ← فورم الإضافة عادي', async () => {
  mockParams = {};
  await render(ui());
  expect(screen.queryByTestId('tx_missing')).toBeNull();
  expect(screen.getByText('عملية جديدة')).toBeTruthy();
});
