import CategoriesScreen from '@/app/settings-screens/categories';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { ThemeProvider } from '@/context/ThemeContext';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

/** نقل التأكيدات — الدفعة 2: الفئات بالمكوّن نفسه (مسح، مسح نهائي بعد "عليها عمليات"، الإلغاء) */

const mockData: any = {};
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

const food = { id: 'c1', name: 'أكل' };
function seed(transactions: object[] = []) {
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [food], transactions,
    budgets: {}, debts: [], subscriptions: [], gamiyas: [], incomes: [], serverReachable: true, loadErrors: [],
    updateCategory: jest.fn(), addCategory: jest.fn(), deleteCategory: jest.fn(async () => ({ outcome: 'done' })),
    archiveCategory: jest.fn(async () => ({ outcome: 'done' })), restoreCategory: jest.fn(),
  });
}
const ui = () => <ThemeProvider><NoticeProvider><ConfirmProvider><CategoriesScreen /></ConfirmProvider></NoticeProvider></ThemeProvider>;

it('فئة من غير عمليات ← "حذف فئة"، و"إلغاء" مبيمسحش', async () => {
  seed();
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('category_delete_c1')); });
  expect(screen.getByTestId('confirm_title').props.children).toBe('حذف فئة');
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_cancel')); });
  expect(mockData.deleteCategory).not.toHaveBeenCalled();
});

it('فئة عليها عمليات ← التأكيد الأول، وبعده "مسح نهائي" بالأرقام قبل أي مسح', async () => {
  seed([{ id: 't1', type: 'expense', amount: 50, walletId: 'w1', categoryId: 'c1', date: '2026-01-01' }]);
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('category_delete_c1')); });
  expect(screen.getByTestId('confirm_title').props.children).toBe('الفئة دي عليها عمليات');
  const destructive = screen.getAllByTestId(/confirm_action_/).find(b => b.props.accessibilityHint === 'تأكيد فعل خطر')!;
  await act(async () => { fireEvent.press(destructive); });
  expect(screen.getByTestId('confirm_title').props.children).toBe('مسح نهائي');
  expect(mockData.deleteCategory).not.toHaveBeenCalled();
});
