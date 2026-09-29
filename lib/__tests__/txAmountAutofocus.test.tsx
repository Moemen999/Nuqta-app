import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react-native';
import AddTransactionModal from '@/app/modal';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * "+" بيودّي على كتابة الرقم على طول (2026-09-29): خانة المبلغ بتاخد التركيز
 * لوحدها في عملية جديدة — مش في التعديل، ولا من غير محفظة (الكيبورد كان هيغطي
 * "ضيف محفظة"). وزرار الحفظ لازم يفضل فوق الكيبورد: فوتر لاصق برّه الـScrollView
 * جوه KeyboardAvoidingView (باج قديم اتصلح — stickyFooterModals.test بيحرسه كمان).
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

beforeEach(() => {
  mockParams = {};
  Object.assign(mockData, {
    wallets: [wallet], categories: [], transactions: [tx],
    addTransaction: jest.fn(), updateTransaction: jest.fn(), deleteTransaction: jest.fn(), transactionLinkWarning: () => null,
  });
});

const amountInput = async () => {
  await render(<ThemeProvider><PrivacyProvider><AddTransactionModal /></PrivacyProvider></ThemeProvider>);
  return screen.getByTestId('tx_amount_input');
};

it('عملية جديدة وفيه محفظة ← خانة المبلغ بتاخد التركيز لوحدها', async () => {
  expect((await amountInput()).props.autoFocus).toBe(true);
});

it('تعديل عملية ← مفيش تركيز تلقائي (جه يبص الأول)', async () => {
  mockParams = { id: 't1' };
  expect((await amountInput()).props.autoFocus).toBe(false);
});

it('من غير محفظة ← مفيش تركيز تلقائي، و"ضيف محفظة" ظاهر', async () => {
  mockData.wallets = [];
  expect((await amountInput()).props.autoFocus).toBe(false);
  expect(screen.getByTestId('tx_no_wallets_add')).toBeTruthy();
});

it('زرار الحفظ في فوتر لاصق برّه الـScrollView وجوه KeyboardAvoidingView', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'modal.tsx'), 'utf8');
  const kav = src.indexOf('<KeyboardAvoidingView');
  const scrollEnd = src.indexOf('</ScrollView>');
  const save = src.indexOf('testID="tx_save_button"');
  const kavEnd = src.indexOf('</KeyboardAvoidingView>');
  expect(kav).toBeGreaterThan(-1);
  expect(save).toBeGreaterThan(scrollEnd);
  expect(save).toBeLessThan(kavEnd);
  expect(src).toMatch(/footer: stickyFooterStyle\(/);
});
