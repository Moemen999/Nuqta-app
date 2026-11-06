import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import LockScreen from '@/components/LockScreen';
import { ThemeProvider } from '@/context/ThemeContext';

/** بند E جولة 3 (بعد دمج A): لوحة الـPIN لقارئ الشاشة — كل رقم زرار باسمه، المسح باسم، الخانة الفاضية مش زرار، والنقط بتقول اتكتب كام */

const mockLock = {
  lockType: 'pin' as const,
  verify: jest.fn(async () => 'wrong' as const),
  unlock: jest.fn(), clearLock: jest.fn(async () => {}), readFailed: false, retryRead: jest.fn(async () => false),
  setupLock: jest.fn(), changeCode: jest.fn(), disableLock: jest.fn(),
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
  expect(screen.getByLabelText('لسه مكتبتش أي رقم')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('lock_key_2')); });
  expect(screen.getByLabelText('اتكتب رقم واحد من 4')).toBeTruthy();
  // الخانة الفاضية مش عنصر بيتوقف عنده قارئ الشاشة (كانت "زرار" من غير اسم)
  expect(screen.getByTestId('lock_key_empty', { includeHiddenElements: true }).props.accessible).toBe(false);
});

it('صيغة التقدّم بتتفق مع العدد', () => {
  const { pinProgressLabel } = require('@/components/LockScreen');
  expect([0, 1, 2, 3, 4].map(pinProgressLabel)).toEqual(['لسه مكتبتش أي رقم', 'اتكتب رقم واحد من 4', 'اتكتب رقمين من 4', 'اتكتب 3 أرقام من 4', 'اتكتب 4 أرقام من 4']);
});

it('مودال تغيير القفل: الخانات التلاتة ليها أسامي (كانت "حقل تعديل" بس)', async () => {
  const SetLockModal = require('@/components/SetLockModal').default;
  await render(<ThemeProvider><SetLockModal visible mode="change" onClose={() => {}} /></ThemeProvider>);
  for (const name of ['الرقم السري الحالي', 'الرقم السري الجديد', 'تأكيد الرقم']) expect(screen.getByLabelText(name)).toBeTruthy();
});
