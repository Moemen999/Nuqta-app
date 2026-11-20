import SettingsScreen from '@/app/(tabs)/settings';
import { ThemeProvider } from '@/context/ThemeContext';
import { render, screen } from '@testing-library/react-native';
import React from 'react';

/** سطر حالة المحافظ والفئات: مش «مفيش» وهي لسه بتحمّل أو فشلت */
let mockUndelivered: string[] = [];
let mockErrors: string[] = [];

jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { email: 'a@b.c' }, logOut: jest.fn() }) }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ enabled: false }) }));
jest.mock('@/context/NotificationsContext', () => ({
  useNotifications: () => ({ enabled: false, dailyEnabled: false, dailyHour: 20 }),
}));
jest.mock('@/context/DataContext', () => ({
  useData: () => ({ wallets: [], categories: [], undelivered: mockUndelivered, loadErrors: mockErrors, pendingWrites: 0 }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const ui = () => <ThemeProvider><SettingsScreen /></ThemeProvider>;

describe('حالة المحافظ والفئات في الإعدادات', () => {
  it('لسه بتحمّل ← بنحمّل…', async () => {
    mockUndelivered = ['wallets', 'categories']; mockErrors = [];
    await render(ui());
    expect(screen.getAllByText('بنحمّل…').length).toBe(2);
    expect(screen.queryByText('مفيش محافظ')).toBeNull();
  });
  it('فشل التحميل ← ما قدرناش نجيبها', async () => {
    mockUndelivered = []; mockErrors = ['wallets', 'categories'];
    await render(ui());
    expect(screen.getAllByText('ما قدرناش نجيبها').length).toBe(2);
  });
  it('وصلت ← العدد', async () => {
    mockUndelivered = []; mockErrors = [];
    await render(ui());
    expect(screen.getByText('مفيش محافظ')).toBeTruthy();
  });
});

describe('نصوص الرأي والترحيب', () => {
  it('ملاحظة الخصوصية والتأكيد', () => {
    const { FEEDBACK_PRIVACY_NOTE } = require('@/lib/feedback');
    expect(FEEDBACK_PRIVACY_NOTE).toBe('هنبعت مع رأيك رقم الإصدار ونوع الموبايل ونظامه، ومربوط بحسابك. مفيش أي بيانات مالية.');
    const src = require('fs').readFileSync('app/(tabs)/settings.tsx', 'utf8');
    expect(src).toContain('هتظهرلك تاني بعد ما تقفل التطبيق خالص وتفتحه من الأول.');
    expect(src).toContain("notice('ما اتحفظش', 'ما قدرناش نظبط شاشة الترحيب. جرّب تاني.')");
  });
});
