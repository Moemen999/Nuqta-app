import LockGate, { PRIVACY_COVER_TEST_ID } from '@/components/LockGate';
import { ThemeProvider } from '@/context/ThemeContext';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import fs from 'fs';
import path from 'path';

/**
 * الميزة 11، بند 7: شاشة القفل **فوق** الشجرة مش بدلها — الرجوع من جوجل (Custom Tab) مبيشيلش شاشة الدخول/مسح الحساب،
 * والمكتوب في الفورم مبيضيعش مع القفل. واللي تحت: مش مقروء ولا بيتداس.
 * بند 6: غطا الخصوصية لما التطبيق يروح الخلفية والقفل مفعّل.
 */

jest.mock('@/components/LockScreen', () => {
  const { Text: T } = require('react-native');
  return { __esModule: true, default: () => <T testID="lock_screen">مقفول</T> };
});

const onPress = jest.fn();
function Underneath() {
  const [v, setV] = useState('');
  return (
    <>
      <Text>رصيدك 5,000</Text>
      <TouchableOpacity testID="under_btn" onPress={onPress}><Text>اضغط</Text></TouchableOpacity>
      <TextInput testID="under_input" value={v} onChangeText={setV} />
    </>
  );
}
const wrap = (locked: boolean) => (
  <ThemeProvider><LockGate locked={locked}><Underneath /></LockGate></ThemeProvider>
);

beforeEach(() => jest.clearAllMocks());

describe('7: القفل فوق الشجرة', () => {
  it('مقفول ← شاشة القفل ظاهرة، واللي تحت مش مقروء ومبيتداسش', async () => {
    await render(wrap(true));
    expect(screen.getByTestId('lock_screen')).toBeTruthy();
    expect(screen.queryByText('رصيدك 5,000', { includeHiddenElements: false })).toBeNull();
    fireEvent.press(screen.getByTestId('under_btn', { includeHiddenElements: true }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('المكتوب في الفورم بيفضل بعد القفل والفتح (الشجرة مبتتشالش)', async () => {
    await render(wrap(false));
    await act(async () => { fireEvent.changeText(screen.getByTestId('under_input'), 'نص ما اتحفظش'); });
    await screen.rerender(wrap(true));
    await screen.rerender(wrap(false));
    expect(screen.getByTestId('under_input').props.value).toBe('نص ما اتحفظش');
    expect(screen.queryByTestId('lock_screen')).toBeNull();
    expect(screen.getByText('رصيدك 5,000', { includeHiddenElements: false })).toBeTruthy();
  });
});

describe('silent M2: الغطا المعتم تحت القفل كمان', () => {
  it('مقفول ← الغطا موجود (تحت الـModal) ومش مقروء', async () => {
    await render(wrap(true));
    expect(screen.getByTestId('lock_screen')).toBeTruthy();
    expect(screen.getByTestId(PRIVACY_COVER_TEST_ID, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId(PRIVACY_COVER_TEST_ID, { includeHiddenElements: false })).toBeNull();
  });
  it('مفتوح ← مفيش غطا', async () => {
    await render(wrap(false));
    expect(screen.queryByTestId(PRIVACY_COVER_TEST_ID, { includeHiddenElements: true })).toBeNull();
  });
});

describe('6: غطا الخصوصية في الخلفية اتشال (مبيشتغلش على أندرويد، قرار مؤمن 2026-11-20)', () => {
  it('_layout مبقاش بيستخدم usePrivacyCover', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8');
    expect(src).not.toContain('usePrivacyCover');
  });
});

describe('app/_layout.tsx', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8');
  it('بيستخدم LockGate ومبيرجّعش LockScreen بدل الـStack', () => {
    expect(src).toContain('<LockGate');
    expect(src).not.toMatch(/<LockScreen \/>/);
  });
  it('NotificationTapRouter مبيتركّبش والقفل ظاهر', () => {
    expect(src).toMatch(/!lockShown && <NotificationTapRouter \/>/);
  });
});
