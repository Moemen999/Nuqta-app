import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import LockScreen from '@/components/LockScreen';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * حد المحاولات على الشاشة (2026-11-07): وقت الانتظار الأرقام مقفولة (المسح لأ)، والعدّ التنازلي ظاهر وبينزل،
 * و«نسيت الكود؟» شغال — مفيش حبسة. وبعد ما الوقت يخلص اللوحة بترجع.
 */
const mockLock = {
  lockType: 'pin' as 'pin' | 'password',
  verify: jest.fn(async () => 'wrong' as const),
  waitUntil: 0,
  unlock: jest.fn(), clearLock: jest.fn(async () => {}), readFailed: false, retryRead: jest.fn(async () => false),
  setupLock: jest.fn(), changeCode: jest.fn(), disableLock: jest.fn(),
};
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => mockLock }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ logOut: jest.fn(async () => {}) }) }));
jest.mock('@/context/DataContext', () => ({ useData: () => ({ serverReachable: true }) }));

let nowMs = 5_000_000;
beforeEach(() => {
  jest.useFakeTimers();
  nowMs = 5_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  mockLock.verify.mockClear();
  mockLock.lockType = 'pin';
  mockLock.waitUntil = nowMs + 30_000;
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

it('وقت الانتظار: العدّ ظاهر، الأرقام مقفولة ومبتبعتش تحقق، و«نسيت الكود؟» موجود', async () => {
  await render(<ThemeProvider><LockScreen /></ThemeProvider>);
  expect(screen.getByTestId('lock_wait')).toHaveTextContent('استنى 30 ثانية وجرّب تاني');
  const k = screen.getByTestId('lock_key_1');
  expect(k.props.accessibilityState).toEqual({ disabled: true });
  for (const d of ['1', '2', '3', '4']) await act(async () => { fireEvent.press(screen.getByTestId(`lock_key_${d}`)); });
  expect(mockLock.verify).not.toHaveBeenCalled();
  expect(screen.getByTestId('lock_forgot_button')).toBeTruthy();
  // العدّ بينزل
  await act(async () => { nowMs += 10_000; jest.advanceTimersByTime(1000); });
  expect(screen.getByTestId('lock_wait')).toHaveTextContent('استنى 20 ثانية وجرّب تاني');
  // الوقت خلص ← اللوحة رجعت
  await act(async () => { nowMs += 20_001; jest.advanceTimersByTime(1000); });
  expect(screen.queryByTestId('lock_wait')).toBeNull();
  expect(screen.getByTestId('lock_key_1').props.accessibilityState).toEqual({ disabled: false });
});

it('الباسورد: «دخول» مقفول وقت الانتظار', async () => {
  mockLock.lockType = 'password';
  await render(<ThemeProvider><LockScreen /></ThemeProvider>);
  const btn = screen.getByTestId('lock_submit_button');
  expect(btn.props.accessibilityState).toEqual({ disabled: true });
  expect(screen.getByTestId('lock_wait')).toBeTruthy();
});

it('مفيش انتظار ← مفيش عدّ، والأرقام شغالة', async () => {
  mockLock.waitUntil = 0;
  await render(<ThemeProvider><LockScreen /></ThemeProvider>);
  expect(screen.queryByTestId('lock_wait')).toBeNull();
  for (const d of ['1', '2', '3', '4']) await act(async () => { fireEvent.press(screen.getByTestId(`lock_key_${d}`)); });
  expect(mockLock.verify).toHaveBeenCalledWith('1234');
});
