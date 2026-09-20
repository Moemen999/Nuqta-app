import LockScreen, { FORGOT_CONFIRM, FORGOT_LABEL, FORGOT_TITLE } from '@/components/LockScreen';
import { ThemeProvider } from '@/context/ThemeContext';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

/**
 * القفل بيتحط قدام التطبيق كله قبل حتى شاشة الدخول. يعني المستخدم اللي بينسى
 * كوده مكانش قدامه أي طريق غير إنه يمسح التطبيق — وعلى آيفون الكيتشين ممكن
 * يعيش بعد المسح، فحتى ده مش مضمون.
 *
 * مفيش بصمة في التطبيق أصلاً (`LockType` = pin أو password بس)، فالمخرج
 * الوحيد الممكن هو الربط بباسورد الحساب.
 */

const mockLock = {
  lockType: 'pin' as 'pin' | 'password',
  verify: jest.fn(async () => false),
  unlock: jest.fn(),
  clearLock: jest.fn(async () => {}),
};
const mockAuth = { logOut: jest.fn(async () => {}) };

jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => mockLock }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => mockAuth }));

async function renderLock() {
  return render(<ThemeProvider><LockScreen /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLock.lockType = 'pin';
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('مخرج "نسيت الكود؟"', () => {
  it('موجود مع القفل الرقمي', async () => {
    await renderLock();
    expect(screen.getByTestId('lock_forgot_button')).toBeTruthy();
    expect(screen.getByText(FORGOT_LABEL)).toBeTruthy();
  });

  it('موجود مع الباسورد النصي كمان', async () => {
    mockLock.lockType = 'password';
    await renderLock();
    expect(screen.getByTestId('lock_forgot_button')).toBeTruthy();
  });

  it('بيسأل الأول — مبيشلش القفل من غير تأكيد', async () => {
    await renderLock();
    await act(async () => { fireEvent.press(screen.getByTestId('lock_forgot_button')); });

    expect(Alert.alert).toHaveBeenCalled();
    expect((Alert.alert as unknown as jest.Mock).mock.calls[0][0]).toBe(FORGOT_TITLE);
    expect(mockLock.clearLock).not.toHaveBeenCalled();
    expect(mockAuth.logOut).not.toHaveBeenCalled();
  });

  it('التأكيد بيشيل القفل **و**بيخرج من الحساب', async () => {
    await renderLock();
    await act(async () => { fireEvent.press(screen.getByTestId('lock_forgot_button')); });

    const buttons = (Alert.alert as unknown as jest.Mock).mock.calls[0][2];
    const confirm = buttons.find((b: any) => b.text === FORGOT_CONFIRM);
    expect(confirm).toBeDefined();
    await act(async () => { await confirm.onPress(); });

    expect(mockLock.clearLock).toHaveBeenCalled();
    expect(mockAuth.logOut).toHaveBeenCalled();
  });

  it('الإلغاء مبيعملش حاجة', async () => {
    await renderLock();
    await act(async () => { fireEvent.press(screen.getByTestId('lock_forgot_button')); });

    const buttons = (Alert.alert as unknown as jest.Mock).mock.calls[0][2];
    const cancel = buttons.find((b: any) => b.style === 'cancel');
    expect(cancel).toBeDefined();
    expect(mockLock.clearLock).not.toHaveBeenCalled();
  });
});
