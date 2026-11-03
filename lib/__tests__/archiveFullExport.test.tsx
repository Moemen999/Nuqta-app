import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import ArchiveScreen from '@/app/archive';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * زرار "صدّر كل بياناتك" في الأرشيف (`lib/fullExport.ts`): مقفول وسطر بيقول ليه لحد ما **كل** البيانات توصل من
 * السيرفر (ملف ناقص بيتقري "دي كل بياناتي")، ولما تبقى جاهزة بيكتب ملف إكسيل واحد ويشاركه.
 */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///docs/', writeAsStringAsync: jest.fn(async () => {}) }));

function setData(over: Record<string, unknown>) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    transactions: [{ id: 't1', type: 'expense', amount: 10, date: '2026-11-01', walletId: 'w' }],
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [],
    debts: [], gamiyas: [], subscriptions: [], incomes: [], budgets: {}, shakhbataIncome: {},
    shakhbataPercents: { needs: 50, wants: 30, future: 20 },
    pendingTxIds: new Set(), serverReachable: true, allSourcesReady: true, figuresFromServer: true,
    ...over,
  });
}
beforeEach(() => { jest.clearAllMocks(); });
const mount = () => render(<ThemeProvider><PrivacyProvider><ArchiveScreen /></PrivacyProvider></ThemeProvider>);

it.each([
  ['لسه في listener ما وصلش', { allSourcesReady: false }],
  ['الأرقام لسه من الكاش (أوفلاين)', { figuresFromServer: false }],
])('%s ← الزرار مقفول، والسطر بيقول ليه، ومفيش ملف', async (_, over) => {
  setData(over);
  await mount();
  expect(screen.getByTestId('archive_full_export_button').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('archive_full_export_wait')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('archive_full_export_button')); });
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
});

it('كل البيانات وصلت ← ملف واحد بإسم كل البيانات، ومشاركته', async () => {
  setData({});
  await mount();
  expect(screen.queryByTestId('archive_full_export_wait')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('archive_full_export_button')); });
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
  const [uri] = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0];
  expect(uri).toMatch(/^file:\/\/\/docs\/nuqta-all-data-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(Sharing.shareAsync).toHaveBeenCalledWith(uri, expect.objectContaining({ dialogTitle: 'تصدير كل بياناتك' }));
});
