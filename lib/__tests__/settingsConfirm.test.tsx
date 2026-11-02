import SettingsScreen from '@/app/(tabs)/settings';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { ThemeProvider } from '@/context/ThemeContext';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

/**
 * نقل تأكيدات الإعدادات لمكوّن التأكيد بشكل التطبيق (الدفعة 1، بدون فلوس): تسجيل الخروج —
 * بالتحذير لو فيه حاجة بترفع — وإعادة شاشة الترحيب. نفس النصوص والأزرار اللي كانت في Alert.
 */

const mockLogOut = jest.fn();
let mockPending = 0;
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'test@nuqta.app' }, logOut: mockLogOut }),
}));
jest.mock('@/context/AppLockContext', () => ({
  useAppLock: () => ({ enabled: false, isLocked: false }),
}));
jest.mock('@/context/NotificationsContext', () => ({
  useNotifications: () => ({ enabled: false, dailyEnabled: false, dailyHour: 20 }),
}));
jest.mock('@/context/DataContext', () => ({
  useData: () => ({ wallets: [], categories: [], pendingWrites: mockPending }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeEach(() => { mockLogOut.mockClear(); mockPending = 0; });

async function openLogout() {
  await render(<ThemeProvider><ConfirmProvider><SettingsScreen /></ConfirmProvider></ThemeProvider>);
  await act(async () => { fireEvent.press(screen.getByText('تسجيل الخروج')); });
}

it('تسجيل الخروج ← تأكيد التطبيق، و"خروج" بيخرج', async () => {
  await openLogout();
  expect(screen.getByTestId('confirm_title').props.children).toBe('تسجيل الخروج');
  expect(mockLogOut).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByText('خروج')); });
  expect(mockLogOut).toHaveBeenCalledTimes(1);
});

it('"إلغاء" مبيخرجش', async () => {
  await openLogout();
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_cancel')); });
  expect(mockLogOut).not.toHaveBeenCalled();
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
});

it('فيه حاجة بترفع ← التحذير، و"أستنى" مبيخرجش', async () => {
  mockPending = 2;
  await openLogout();
  expect(screen.getByTestId('confirm_title').props.children).toBe('لسه فيه بيانات بترفع');
  await act(async () => { fireEvent.press(screen.getByText('أستنى')); });
  expect(mockLogOut).not.toHaveBeenCalled();
});
