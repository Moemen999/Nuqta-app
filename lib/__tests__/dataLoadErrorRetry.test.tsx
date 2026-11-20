import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import DataLoadErrorBanner, { RETRY_BUSY_TEXT, RETRY_DONE_ANNOUNCEMENT, RETRY_STILL_FAILED, RETRY_WAIT_MS } from '@/components/DataLoadErrorBanner';
import { ThemeProvider } from '@/context/ThemeContext';
import { resetBannerDismissForTests } from '@/lib/useBannerDismiss';

/**
 * مراجعة التطبيق كله، الميزة 7 (LOW): «جرّب تاني» مكانش بيدّي أي إحساس — الدوسة بتفتح الـlisteners من الأول ومفيش
 * حاجة بتتغيّر لو فشلوا تاني. دلوقتي الزرار بيلف «بنجرّب…» وبيتقال النتيجة: وصلت، أو لسه ما وصلتش.
 */
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));

const ui = () => <ThemeProvider><DataLoadErrorBanner /></ThemeProvider>;
let announce: jest.SpyInstance;
beforeEach(async () => {
  resetBannerDismissForTests(); await AsyncStorage.clear();
  Object.assign(mockData, { loadErrors: ['transactions'], retryLoad: jest.fn() });
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.useFakeTimers();
});
afterEach(() => { jest.useRealTimers(); announce.mockRestore(); resetBannerDismissForTests(); });

it('الدوسة ← «بنجرّب…» والزرار مقفول ومشغول؛ ما وصلتش بعد المهلة ← بيتقال ويرجع', async () => {
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('data_load_error_retry')); });
  expect(mockData.retryLoad).toHaveBeenCalledTimes(1);
  const btn = screen.getByTestId('data_load_error_retry');
  expect(btn.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  expect(screen.getByText(RETRY_BUSY_TEXT)).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(RETRY_WAIT_MS + 10); });
  expect(announce.mock.calls.map(c => c[0])).toContain(RETRY_STILL_FAILED);
  expect(screen.getByTestId('data_load_error_retry').props.accessibilityState).toMatchObject({ busy: false });
});

it('وصلت ← بيتقال «وصلت» والبانر بيختفي', async () => {
  const r = await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('data_load_error_retry')); });
  mockData.loadErrors = [];
  await act(async () => { r.rerender(ui()); });
  expect(screen.queryByTestId('data_load_error_banner')).toBeNull();
  expect(announce.mock.calls.map(c => c[0])).toContain(RETRY_DONE_ANNOUNCEMENT);
});

it('الجولة الأخيرة (H1-B): listener تاني وقع وإحنا بنجرّب ومفيش حاجة رجعت ← لسه «بنجرّب» (مش «جزء وصل»)', async () => {
  const r = await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('data_load_error_retry')); });
  mockData.loadErrors = ['debts', 'transactions'];
  await act(async () => { r.rerender(ui()); });
  expect(screen.getByTestId('data_load_error_retry').props.accessibilityState).toMatchObject({ busy: true });
  expect(announce.mock.calls.map(c => c[0]).some(t => /جزء من بياناتك وصل/.test(t))).toBe(false);
  await act(async () => { jest.advanceTimersByTime(RETRY_WAIT_MS + 10); });
  expect(announce.mock.calls.map(c => c[0])).toContain(RETRY_STILL_FAILED);
});

it('الجولة الأخيرة: جزء رجع ← إعلان واحد بس (مش «جزء وصل» + نص البانر من جديد)', async () => {
  mockData.loadErrors = ['debts', 'transactions'];
  const r = await render(ui());
  await act(async () => { jest.advanceTimersByTime(10); });
  await act(async () => { fireEvent.press(screen.getByTestId('data_load_error_retry')); });
  announce.mockClear();
  mockData.loadErrors = ['debts'];
  await act(async () => { r.rerender(ui()); });
  await act(async () => { r.rerender(ui()); });
  const said = announce.mock.calls.map(c => c[0]);
  expect(said).toHaveLength(1);
  expect(said[0]).toMatch(/جزء من بياناتك وصل/);
});
