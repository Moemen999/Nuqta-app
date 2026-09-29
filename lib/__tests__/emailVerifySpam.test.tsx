import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import HomeTab, { VERIFY_SPAM_HINT } from '@/app/(tabs)/index';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * رسالة التأكيد بتوصل بس بتقع في الـSpam (2026-09-28). المستخدم اللي مش لاقيها
 * في الوارد هيفتكر التطبيق بايظ — فبانر "لسه مش مأكّد" بيقوله يبص هناك.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/components/IncomeHomeCards', () => ({ __esModule: true, default: () => null, IncomeAutoNotices: () => null }));
jest.mock('@/components/ChargeHomeCards', () => ({ __esModule: true, default: () => null, ChargeAutoNotices: () => null }));
jest.mock('@/components/PendingSheet', () => ({ __esModule: true, default: () => null }));

const mockUser: Record<string, unknown> = {};
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, resendVerificationEmail: jest.fn(async () => {}) }),
}));
jest.mock('@/context/DataContext', () => ({
  useData: () => ({
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [], transactions: [], budgets: {},
    subscriptions: [], gamiyas: [], incomes: [], debts: [], pendingTxIds: new Set(), serverReachable: true,
    setupStatus: 'done', loadErrors: [],
  }),
}));

async function mount() {
  await render(<ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>);
  await act(async () => {});
}

it('إيميل وباسورد ولسه مش مأكّد ← البانر بيقول يبص في الـSpam', async () => {
  Object.assign(mockUser, {
    uid: 'u1', email: 'a@b.com', emailVerified: false,
    providerData: [{ providerId: 'password' }], reload: async () => {},
  });
  await mount();
  expect(screen.getByTestId('verify_spam_hint').props.children).toBe(VERIFY_SPAM_HINT);
  expect(VERIFY_SPAM_HINT).toContain('Spam');
});

it('داخل بجوجل (مأكّد) ← مفيش بانر ولا سطر', async () => {
  Object.assign(mockUser, {
    uid: 'u2', email: 'g@b.com', emailVerified: true,
    providerData: [{ providerId: 'google.com' }], reload: async () => {},
  });
  await mount();
  expect(screen.queryByTestId('verify_spam_hint')).toBeNull();
});
