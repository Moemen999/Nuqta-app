import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import HomeTab from '@/app/(tabs)/index';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * حساب مسح (أو أرشف) كل محافظه بيفتح على صفر محافظ ومفيش شاشة تجهيز — فالرئيسية
 * بتقول كده وبتودّيه يضيف محفظة. بس لما نكون متأكدين: من غير نت ده بانر
 * "مفيش نت"، ولو listener المحافظ اترفض ده بانر "مقدرناش نجيب بياناتك".
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/components/IncomeHomeCards', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ChargeHomeCards', () => ({ __esModule: true, default: () => null }));
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'تجربة', emailVerified: true, providerData: [], reload: async () => {} } }),
}));

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));

function setData(over: Record<string, unknown>) {
  Object.assign(mockData, {
    wallets: [], categories: [], transactions: [], budgets: {}, subscriptions: [], gamiyas: [], incomes: [],
    debts: [], pendingTxIds: new Set(), serverReachable: true, setupStatus: 'done', loadErrors: [],
    ...over,
  });
}

async function mountAndWait() {
  jest.useFakeTimers();
  await render(<ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>);
  // الحالة الفاضية بتستنى 2.5 ثانية من فتح الشاشة عشان متلمعش وإحنا بنحمّل
  await act(async () => { jest.advanceTimersByTime(3000); });
  jest.useRealTimers();
}

beforeEach(() => { mockPush.mockClear(); });

describe('الرئيسية من غير محافظ', () => {
  it('متصل وصفر محافظ ← "مفيش ولا محفظة" وزرار "ضيف محفظة" بيودّي للمحافظ', async () => {
    setData({});
    await mountAndWait();
    expect(screen.getByTestId('home_no_wallets')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('home_add_wallet')); });
    expect(mockPush).toHaveBeenCalledWith('/settings-screens/wallets');
  });

  it('كل المحافظ متأرشفة ← نفس الحالة، والكلام بيقول إنها متأرشفة', async () => {
    setData({ wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0, archived: true }] });
    await mountAndWait();
    expect(screen.getByTestId('home_no_wallets')).toBeTruthy();
    expect(screen.getByText(/كل محافظك متأرشفة/)).toBeTruthy();
  });

  it.each([
    ['من غير نت', { serverReachable: false }],
    ['listener المحافظ اترفض', { loadErrors: ['wallets'] }],
    ['لسه بنتأكد من الحساب', { setupStatus: 'unknown' }],
    ['فيه محفظة', { wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }] }],
  ])('%s ← مفيش حالة "مفيش ولا محفظة"', async (_name, over) => {
    setData(over);
    await mountAndWait();
    expect(screen.queryByTestId('home_no_wallets')).toBeNull();
  });
});
