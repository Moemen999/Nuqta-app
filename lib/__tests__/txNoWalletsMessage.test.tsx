import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AddTransactionModal from '@/app/modal';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { warmUp } from '@/test-utils/warmUp';

/**
 * الحفظ من غير ولا محفظة شغالة ممنوع في الإضافة والتعديل (`app/modal.tsx`).
 * الرفض هو هو، بس الكلام لازم يناسب الحالة: رسالة الإضافة ("لسه"، "سجّل
 * العملية") كانت بتطلع في التعديل كمان — والمستخدم هناك عنده محافظ، بس
 * كلها اتأرشفت أو اتمسحت.
 */

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const ADD_TEXT = 'مفيش ولا محفظة لسه — ضيف محفظة الأول، وبعدين سجّل العملية.';
const EDIT_TEXT = 'مفيش ولا محفظة شغالة دلوقتي، فمش هينفع نحفظ التعديل. رجّع محفظة من الإعدادات ← المحافظ، أو ضيف محفظة جديدة، وبعدين عدّل تاني.';

const archived = { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0, archived: true };
const tx = { id: 't1', type: 'expense', amount: 50, walletId: 'w1', date: '2026-01-02' };

function seed(wallets: object[]) {
  Object.assign(mockData, {
    wallets, categories: [], transactions: [tx],
    addTransaction: jest.fn(), updateTransaction: jest.fn(), deleteTransaction: jest.fn(), transactionLinkWarning: () => null,
  });
}

beforeEach(() => { mockParams = {}; seed([archived]); });

const ui = () => <ThemeProvider><PrivacyProvider><AddTransactionModal /></PrivacyProvider></ThemeProvider>;
warmUp(() => { seed([archived]); return ui(); });

async function save() {
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });
}

it('تعديل والمحافظ كلها مؤرشفة ← كلام التعديل، ومفيش حفظ', async () => {
  mockParams = { id: 't1' };
  await save();
  expect(screen.getByText(EDIT_TEXT)).toBeTruthy();
  expect(screen.queryByText(ADD_TEXT)).toBeNull();
  expect(mockData.updateTransaction).not.toHaveBeenCalled();
});

it('عملية جديدة والمحافظ كلها مؤرشفة ← كلام الإضافة زي ما هو، ومفيش حفظ', async () => {
  await save();
  // مرتين: البانر اللي فوق ("ضيف محفظة") وسطر الغلط تحت
  expect(screen.getAllByText(ADD_TEXT)).toHaveLength(2);
  expect(screen.queryByText(EDIT_TEXT)).toBeNull();
  expect(mockData.addTransaction).not.toHaveBeenCalled();
});

it('عملية جديدة ومفيش ولا محفظة خالص ← كلام الإضافة', async () => {
  seed([]);
  await save();
  expect(screen.getAllByText(ADD_TEXT)).toHaveLength(2);
  expect(screen.queryByText(EDIT_TEXT)).toBeNull();
});
