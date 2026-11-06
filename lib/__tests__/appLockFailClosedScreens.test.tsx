import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import LockScreen from '@/components/LockScreen';
import { ThemeProvider } from '@/context/ThemeContext';
import { LOCK_READ_FAILED, LOCK_STORAGE_ERROR } from '@/lib/lockMessages';

/**
 * بند A على الشاشة:
 * - القراية فشلت ← رسالة + "جرّب تاني" (بينادي retryRead) ومفيش لوحة أرقام، و"نسيت الكود؟" لسه موجود.
 * - التحقق رجّع error ← رسالة التخزين، مش "غلط، جرب تاني".
 */

const mockLock = {
  lockType: 'pin' as 'pin' | 'password',
  verify: jest.fn(async () => 'wrong' as 'ok' | 'wrong' | 'error'),
  unlock: jest.fn(),
  clearLock: jest.fn(async () => {}),
  readFailed: false,
  retryRead: jest.fn(async () => {}),
};
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => mockLock }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ logOut: jest.fn(async () => {}) }) }));
jest.mock('@/context/DataContext', () => ({ useData: () => ({ serverReachable: true }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockLock.readFailed = false;
  mockLock.lockType = 'pin';
});

const renderLock = () => render(<ThemeProvider><LockScreen /></ThemeProvider>);

it('القراية فشلت ← الرسالة و"جرّب تاني" بيقرا تاني، ومفيش لوحة، والمخرج موجود', async () => {
  mockLock.readFailed = true;
  await renderLock();
  expect(screen.getByTestId('lock_read_failed').props.children).toBe(LOCK_READ_FAILED);
  expect(screen.queryByText('1')).toBeNull();
  expect(screen.getByTestId('lock_forgot_button')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('lock_read_retry')); });
  expect(mockLock.retryRead).toHaveBeenCalled();
});

it('التحقق رجّع error ← رسالة التخزين مش "غلط"', async () => {
  mockLock.lockType = 'password';
  mockLock.verify.mockResolvedValueOnce('error');
  await renderLock();
  await act(async () => { fireEvent.changeText(screen.getByTestId('lock_password_input'), 'abcd'); });
  await act(async () => { fireEvent.press(screen.getByTestId('lock_submit_button')); });
  expect(screen.getByText(LOCK_STORAGE_ERROR)).toBeTruthy();
  expect(screen.queryByText('غلط، جرب تاني')).toBeNull();
  expect(mockLock.unlock).not.toHaveBeenCalled();
});

it('التحقق رجّع wrong ← "غلط، جرب تاني" زي الأول', async () => {
  mockLock.lockType = 'password';
  await renderLock();
  await act(async () => { fireEvent.changeText(screen.getByTestId('lock_password_input'), 'abcd'); });
  await act(async () => { fireEvent.press(screen.getByTestId('lock_submit_button')); });
  expect(screen.getByText('غلط، جرب تاني')).toBeTruthy();
});

it('"جرب تاني" ومحاولة فشلت تاني ← سطر إنها ما نفعتش (مش ساكت)', async () => {
  mockLock.readFailed = true;
  await renderLock();
  expect(screen.queryByTestId('lock_read_retry_failed')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('lock_read_retry')); });
  expect(screen.getByTestId('lock_read_retry_failed').props.children).toBe(LOCK_STORAGE_ERROR);
});

it('"نسيت الكود؟" ومسح القفل رمى بعد الخروج ← رسالة، مش رمية ساكتة', async () => {
  const { Alert } = require('react-native');
  const spy = jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    // تأكيد "نسيت الكود؟" ← اضغط الزرار التاني (المدمّر)
    const buttons = args[2] as { onPress?: () => void }[] | undefined;
    buttons?.[1]?.onPress?.();
  });
  mockLock.clearLock.mockRejectedValueOnce(new Error('keystore'));
  await renderLock();
  await act(async () => { fireEvent.press(screen.getByTestId('lock_forgot_button')); });
  await act(async () => {});
  expect(spy).toHaveBeenCalledWith(LOCK_STORAGE_ERROR);
  spy.mockRestore();
});
