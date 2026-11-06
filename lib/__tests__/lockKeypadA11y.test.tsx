import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import LockScreen from '@/components/LockScreen';
import { ThemeProvider } from '@/context/ThemeContext';

/** بند E جولة 3 (بعد دمج A): لوحة الـPIN لقارئ الشاشة — كل رقم زرار باسمه، المسح باسم، الخانة الفاضية مش زرار، والنقط بتقول اتكتب كام */

const mockLock = {
  lockType: 'pin' as const,
  verify: jest.fn(async () => 'wrong' as const),
  unlock: jest.fn(), clearLock: jest.fn(async () => {}), readFailed: false, retryRead: jest.fn(async () => false),
};
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => mockLock }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ logOut: jest.fn(async () => {}) }) }));
jest.mock('@/context/DataContext', () => ({ useData: () => ({ serverReachable: true }) }));

it('الأرقام والمسح أزرار بأسامي، والنقط بتتحدّث', async () => {
  await render(<ThemeProvider><LockScreen /></ThemeProvider>);
  for (const d of ['0', '1', '5', '9']) {
    const k = screen.getByTestId(`lock_key_${d}`);
    expect([k.props.accessibilityRole, k.props.accessibilityLabel]).toEqual(['button', d]);
  }
  expect(screen.getByTestId('lock_key_backspace').props.accessibilityLabel).toBe('امسح آخر رقم');
  expect(screen.getByLabelText('اتكتب 0 من 4 أرقام')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('lock_key_2')); });
  expect(screen.getByLabelText('اتكتب 1 من 4 أرقام')).toBeTruthy();
  // الخانة الفاضية مش عنصر بيتوقف عنده قارئ الشاشة (كانت "زرار" من غير اسم)
  expect(screen.getByTestId('lock_key_empty', { includeHiddenElements: true }).props.accessible).toBe(false);
});
