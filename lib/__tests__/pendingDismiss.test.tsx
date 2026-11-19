import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import PendingSummary from '@/components/PendingSheet';
import { ThemeProvider } from '@/context/ThemeContext';
import { resetBannerDismissForTests } from '@/lib/useBannerDismiss';

/**
 * silent-failure-hunter: سطر "مستنيين ردك" هو الطريق الوحيد لكروت "اتخصم؟/نزل؟".
 * الـ✕ بيقفل العدد ده بس — حاجة جديدة مستنية رد بترجّع السطر على طول.
 */
let mockCharges: { kind: string }[] = [];
jest.mock('@/components/ChargeHomeCards', () => ({ __esModule: true, default: () => null, usePendingCharges: () => mockCharges }));
jest.mock('@/components/IncomeHomeCards', () => ({ __esModule: true, default: () => null, usePendingIncomes: () => [] }));

beforeEach(async () => { resetBannerDismissForTests(); await AsyncStorage.clear(); mockCharges = [{ kind: 'subscription' }]; });
afterEach(() => resetBannerDismissForTests());

const ui = () => <ThemeProvider><PendingSummary /></ThemeProvider>;

it('✕ ← السطر يختفي، وحاجة جديدة مستنية ← يرجع على طول', async () => {
  const r = await render(ui());
  await act(async () => {});
  expect(screen.getByTestId('home_pending_summary')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('home_pending_dismiss')); });
  expect(screen.queryByTestId('home_pending_summary')).toBeNull();
  mockCharges = [{ kind: 'subscription' }, { kind: 'gamiya' }];
  await r.rerender(ui());
  expect(screen.getByTestId('home_pending_summary')).toBeTruthy();
});

it('الـ✕ بالحاجات نفسها مش بالعدد (الميزة 7): حاجة اتردّ عليها وجت غيرها بنفس العدد ← السطر يرجع', async () => {
  mockCharges = [{ kind: 'subscription', id: 's1', charges: [{ key: '2026-11-01' }] }] as never;
  const r = await render(ui());
  await act(async () => {});
  await act(async () => { fireEvent.press(screen.getByTestId('home_pending_dismiss')); });
  expect(screen.queryByTestId('home_pending_summary')).toBeNull();
  // نفس الحاجة ← لسه مقفول
  await r.rerender(ui());
  expect(screen.queryByTestId('home_pending_summary')).toBeNull();
  // اتردّ على s1 وجه s2 — العدد لسه 1
  mockCharges = [{ kind: 'subscription', id: 's2', charges: [{ key: '2026-11-02' }] }] as never;
  await r.rerender(ui());
  expect(screen.getByTestId('home_pending_summary')).toBeTruthy();
});

it('السطر قدّام الـ✕ بمسافة 8 (a11y: هدفين لمس ملزوقين)', async () => {
  await render(ui());
  await act(async () => {});
  const { StyleSheet } = require('react-native');
  expect(StyleSheet.flatten(screen.getByTestId('home_pending_row').props.style).gap).toBe(8);
});

it('LOW (الجولة الأخيرة): حاجة جديدة بنفس العدد بعد مهلة التحميل ← بتتقال لقارئ الشاشة (مش بس لما العدد يزيد)', async () => {
  const { AccessibilityInfo } = require('react-native');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.useFakeTimers();
  try {
    mockCharges = [{ kind: 'subscription', id: 's1', charges: [{ key: '2026-11-01' }] }] as never;
    const r = await render(ui());
    await act(async () => { jest.advanceTimersByTime(3000); });
    announce.mockClear();
    // نفس الحاجة ← مفيش إعلان
    await act(async () => { r.rerender(ui()); });
    expect(announce).not.toHaveBeenCalled();
    mockCharges = [{ kind: 'subscription', id: 's2', charges: [{ key: '2026-11-02' }] }] as never;
    await act(async () => { r.rerender(ui()); });
    expect(announce).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
    announce.mockRestore();
  }
});
