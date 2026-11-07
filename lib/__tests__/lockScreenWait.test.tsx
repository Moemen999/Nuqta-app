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
  expect(screen.getByTestId('lock_wait')).toHaveTextContent('جرّب تاني بعد 30 ثانية');
  const k = screen.getByTestId('lock_key_1');
  expect(k.props.accessibilityState).toEqual({ disabled: true });
  for (const d of ['1', '2', '3', '4']) await act(async () => { fireEvent.press(screen.getByTestId(`lock_key_${d}`)); });
  expect(mockLock.verify).not.toHaveBeenCalled();
  expect(screen.getByTestId('lock_forgot_button')).toBeTruthy();
  expect(screen.getByTestId('lock_wait_reason')).toHaveTextContent('غلطت في الكود كذا مرة ورا بعض');
  // العدّ بينزل
  await act(async () => { nowMs += 10_000; jest.advanceTimersByTime(1000); });
  expect(screen.getByTestId('lock_wait')).toHaveTextContent('جرّب تاني بعد 20 ثانية');
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

it('الغلطة اللي بدأت الانتظار: «غلط» متظهرش تاني بعد ما العدّ يخلص', async () => {
  mockLock.waitUntil = 0;
  const view = await render(<ThemeProvider><LockScreen /></ThemeProvider>);
  // التالتة: verify بيرجع wrong والانتظار بيبدأ
  mockLock.verify.mockImplementationOnce(async () => { mockLock.waitUntil = nowMs + 30_000; return 'wrong' as const; });
  for (const d of ['1', '2', '3', '4']) await act(async () => { fireEvent.press(screen.getByTestId(`lock_key_${d}`)); });
  await view.rerender(<ThemeProvider><LockScreen /></ThemeProvider>);
  expect(screen.getByTestId('lock_wait')).toBeTruthy();
  await act(async () => { nowMs += 30_001; jest.advanceTimersByTime(1000); });
  expect(screen.queryByTestId('lock_wait')).toBeNull();
  expect(screen.queryByText('غلط، جرّب تاني')).toBeNull();
});

it('مودال القفل: «استنى» بالسبب، والعدّ بينزل، وبتتشال لما الوقت يخلص', async () => {
  const SetLockModal = require('@/components/SetLockModal').default;
  mockLock.disableLock.mockImplementation(async () => 'wait');
  await render(<ThemeProvider><SetLockModal visible mode="disable" onClose={() => {}} /></ThemeProvider>);
  await act(async () => { fireEvent.changeText(screen.getByLabelText('الرقم السري الحالي'), '1234'); });
  await act(async () => { fireEvent.press(screen.getByTestId('setlock_submit')); });
  expect(screen.getByTestId('setlock_wait')).toHaveTextContent('غلطت في الكود كذا مرة ورا بعض. جرّب تاني بعد 30 ثانية');
  await act(async () => { nowMs += 10_000; jest.advanceTimersByTime(1000); });
  expect(screen.getByTestId('setlock_wait')).toHaveTextContent(/جرّب تاني بعد 20 ثانية$/);
  await act(async () => { nowMs += 20_001; jest.advanceTimersByTime(1000); });
  expect(screen.queryByTestId('setlock_wait')).toBeNull();
});

it('مساحة الحالة ثابتة في الحالتين (اللوحة مبتنطش لما سطر السبب يظهر أو يختفي)', async () => {
  const view = await render(<ThemeProvider><LockScreen /></ThemeProvider>);
  const waitingStyle = screen.getByTestId('lock_screen_status').props.style;
  mockLock.waitUntil = 0;
  await view.rerender(<ThemeProvider><LockScreen /></ThemeProvider>);
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(screen.queryByTestId('lock_wait')).toBeNull();
  expect(screen.getByTestId('lock_screen_status').props.style).toEqual(waitingStyle);
  expect(waitingStyle.minHeight).toBeGreaterThanOrEqual(48);
});
