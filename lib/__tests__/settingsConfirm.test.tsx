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
let mockOutboxUnknown = false;
let mockOutboxCount = 0;
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
  useData: () => ({ wallets: [], categories: [], pendingWrites: mockPending, outboxCount: mockOutboxCount, outboxCountUnknown: mockOutboxUnknown }),
}));
const mockReport = jest.fn();
jest.mock('@/lib/atomicFailure', () => ({ reportAtomicFailure: (...a: unknown[]) => mockReport(...a) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeEach(() => { mockLogOut.mockClear(); mockPending = 0; mockOutboxUnknown = false; mockOutboxCount = 0; });

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

it('الميزة 8 (L): قراية الطابور فشلت (العدد مش معروف) ← تحذير مش "متأكد؟"، و"أستنى" مبيخرجش', async () => {
  mockOutboxUnknown = true;
  await openLogout();
  expect(screen.getByTestId('confirm_title').props.children).toBe('مش متأكدين إن كل عملياتك اترفعت');
  await act(async () => { fireEvent.press(screen.getByText('أستنى')); });
  expect(mockLogOut).not.toHaveBeenCalled();
});

it('الجولة 2، بند 6: فيه عدد معروف بس القراية فشلت ← نص «مش متأكدين» (مش «فيه عمليتين» وبس — ممكن يكونوا أكتر)', async () => {
  mockOutboxUnknown = true;
  mockOutboxCount = 2;
  await openLogout();
  expect(screen.getByTestId('confirm_title').props.children).toBe('مش متأكدين إن كل عملياتك اترفعت');
});

describe('الميزة 11 (arabic-copy-reviewer + silent-failure-hunter)', () => {
  it('11 تعديل ← «فيه 11 تعديل لسه بيترفع» (مش «تعديلات»)', async () => {
    mockPending = 11;
    await openLogout();
    expect(screen.getByTestId('confirm_body').props.children).toContain('فيه 11 تعديل لسه بيترفع');
  });
  it('عمليتين في الطابور ← «يخلص رفعهم»', async () => {
    mockOutboxCount = 2;
    await openLogout();
    expect(screen.getByTestId('confirm_body').props.children).toContain('يخلص رفعهم');
  });
  it('الخروج وقع ← رسالة (مش رمية ساكتة)', async () => {
    mockLogOut.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/network-request-failed' }));
    const { NoticeProvider } = require('@/components/NoticeProvider');
    await render(<ThemeProvider><NoticeProvider><ConfirmProvider><SettingsScreen /></ConfirmProvider></NoticeProvider></ThemeProvider>);
    await act(async () => { fireEvent.press(screen.getByText('تسجيل الخروج')); });
    await act(async () => { fireEvent.press(screen.getByText('خروج')); });
    expect(screen.getByTestId('notice_title').props.children).toBe('ما خرجناش');
    // silent M3: بيوصل Sentry كمان
    expect(mockReport).toHaveBeenCalledWith('الخروج من الحساب', expect.anything());
  });
  it('شاشة الترحيب: الزرار «اعرضها تاني»', async () => {
    await render(<ThemeProvider><ConfirmProvider><SettingsScreen /></ConfirmProvider></ThemeProvider>);
    await act(async () => { fireEvent.press(screen.getByText('إعادة عرض شاشة الترحيب')); });
    expect(screen.getByTestId('confirm_action_0')).toHaveTextContent('اعرضها تاني');
  });
});
