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
