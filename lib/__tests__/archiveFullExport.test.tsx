import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import ArchiveScreen, { FULL_EXPORT_FAIL, FULL_EXPORT_WAIT } from '@/app/archive';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * زرار "صدّر كل بياناتك" في الأرشيف: الملف بيتعمل من **قراية من السيرفر وقت الدوسة** (`readAllFromServer`) مش من اللي
 * على الشاشة — حالة الـlisteners ممكن تكون نص من الكاش (silent-failure-hunter). من غير نت الزرار مقفول وسطر بيقول ليه،
 * والقراية لو مكملتش ← رسالة صريحة ومفيش ملف.
 */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/', writeAsStringAsync: jest.fn(async () => {}) }));

const serverData = {
  wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [],
  transactions: [{ id: 't1', type: 'expense', amount: 10, date: '2026-11-01', walletId: 'w' }],
  debts: [], subscriptions: [], gamiyas: [], incomes: [], budgets: {}, shakhbataIncome: {}, shakhbataPercents: null,
};
function setData(over: Record<string, unknown>) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    transactions: serverData.transactions, wallets: serverData.wallets, categories: [], debts: [], gamiyas: [],
    pendingTxIds: new Set(), serverReachable: true,
    readAllFromServer: jest.fn(async () => ({ outcome: 'done', data: serverData })),
    ...over,
  });
}
beforeEach(() => { jest.clearAllMocks(); });
const mount = () => render(<ThemeProvider><NoticeProvider><PrivacyProvider><ArchiveScreen /></PrivacyProvider></NoticeProvider></ThemeProvider>);
const press = () => act(async () => { fireEvent.press(screen.getByTestId('archive_full_export_button')); });

it('من غير نت ← الزرار مقفول، والسطر بيقول ليه (وهو نفسه الـhint)، ومفيش قراية ولا ملف', async () => {
  setData({ serverReachable: false });
  await mount();
  const btn = screen.getByTestId('archive_full_export_button');
  expect(btn.props.accessibilityState.disabled).toBe(true);
  expect(btn.props.accessibilityHint).toBe(FULL_EXPORT_WAIT);
  expect(screen.getByTestId('archive_full_export_wait').props.children).toBe(FULL_EXPORT_WAIT);
  await press();
  expect(mockData.readAllFromServer).not.toHaveBeenCalled();
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
});

it('النت شغال ← قراية من السيرفر، ملف واحد في الكاش، ومشاركته — والزرار ليه اسم ثابت لقارئ الشاشة', async () => {
  setData({});
  await mount();
  expect(screen.queryByTestId('archive_full_export_wait')).toBeNull();
  expect(screen.getByTestId('archive_full_export_button').props.accessibilityLabel).toBe('صدّر كل بياناتك (إكسيل)');
  await press();
  expect(mockData.readAllFromServer).toHaveBeenCalledTimes(1);
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
  const [uri] = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0];
  expect(uri).toMatch(/^file:\/\/\/cache\/nuqta-all-data-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(Sharing.shareAsync).toHaveBeenCalledWith(uri, expect.objectContaining({ dialogTitle: 'تصدير كل بياناتك' }));
});

it.each(['no-connection', 'failed'] as const)('القراية رجعت %s ← رسالة صريحة ومفيش ملف', async outcome => {
  setData({ readAllFromServer: jest.fn(async () => ({ outcome })) });
  await mount();
  await press();
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  expect(screen.getByTestId('notice_title').props.children).toBe(FULL_EXPORT_FAIL[outcome][0]);
  expect(screen.getByTestId('notice_body').props.children).toBe(FULL_EXPORT_FAIL[outcome][1]);
});

it('الكتابة رمت ← جملة ثابتة مش نص الخطأ الخام', async () => {
  (FileSystem.writeAsStringAsync as jest.Mock).mockImplementationOnce(async () => { throw new Error('ENOSPC: /data/user/0/x'); });
  setData({});
  await mount();
  await press();
  expect(screen.getByTestId('notice_body').props.children).toBe(FULL_EXPORT_FAIL.failed[1]);
});
