import React from 'react';
import { render, screen } from '@testing-library/react-native';
import ReportsTab from '@/app/(tabs)/reports';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { todayStr } from '@/lib/finance';
import { CATEGORY_NAMES_MISSING, DEBTS_LOAD_FAILED, TX_LOAD_ERROR } from '@/lib/spending';
import { brokenTransactionsBannerText } from '@/lib/brokenDocs';

/**
 * Feature 9 بند 1 و2 و7: التقارير مبتعرضش «0» ولا «مفيش مصاريف» وهي لسه مش عارفة.
 * - العمليات لسه ما وصلتش (`figuresPending` فيها 'transactions') ← «بنحمّل» في كل حتة، حتى لو الديون والجمعية وصلوا.
 *   قبل كده الشرط كان على `transfersStatus` بس، فالتقارير كانت بتقول «0» و«مفيش مصاريف» لحظة الفتح.
 * - العمليات اترفضت ← رسالة خطأ مش صفر.
 * - الفئات ما وصلتش ← «بنحمّل» للأعمدة؛ اترفضت ← المصروف تحت «أسامي الفئات ما وصلتش» مش «فئات ممسوحة».
 * - الديون: بتحمّل ← «بنحمّل» مكان «مفيش حركة ديون»، اترفضت ← سطر صريح.
 */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const today = todayStr();
function setData(over: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }],
    categories: [{ id: 'c1', name: 'أكل' }],
    transactions: [],
    debts: [], gamiyas: [], brokenTransactions: [], pendingTxIds: new Set(), serverReachable: true,
    transfersStatus: 'ready', figuresPending: [], loadErrors: [], categoriesReady: true,
    ...over,
  });
}
const mount = () => render(<ThemeProvider><PrivacyProvider><ReportsTab /></PrivacyProvider></ThemeProvider>);
const NO_SPEND = /مفيش مصاريف/;

it('الديون والجمعية وصلوا والعمليات لسه ← بنحمّل، من غير «0» ولا «مفيش مصاريف»', async () => {
  setData({ figuresPending: ['transactions'] });
  await mount();
  expect(screen.getByTestId('reports_period_loading')).toBeTruthy();
  expect(screen.getByTestId('reports_bars_loading')).toBeTruthy();
  expect(screen.getByTestId('reports_trend_loading')).toBeTruthy();
  expect(screen.queryByText(NO_SPEND)).toBeNull();
  expect(screen.queryByText('0')).toBeNull();
  expect(screen.queryByText('مفيش فترة سابقة نقارن بيها')).toBeNull();
});

it('العمليات اترفضت ← رسالة خطأ مكان الرقم والأعمدة، مش «0» ولا «مفيش مصاريف»', async () => {
  setData({ loadErrors: ['transactions'] });
  await mount();
  expect(screen.getByTestId('reports_tx_error').props.children).toBe(TX_LOAD_ERROR);
  expect(screen.queryByText(NO_SPEND)).toBeNull();
  expect(screen.queryByText('0')).toBeNull();
});

it('الفئات لسه ما وصلتش ← الأعمدة بتحمّل (المصروف مش «فئات ممسوحة»)', async () => {
  setData({ categoriesReady: false, categories: [], transactions: [{ id: 't', type: 'expense', amount: 50, date: today, walletId: 'w', categoryId: 'c1' }] });
  await mount();
  expect(screen.getByTestId('reports_bars_loading')).toBeTruthy();
  expect(screen.queryByText('فئات ممسوحة')).toBeNull();
});

it('الفئات اترفضت ← المصروف تحت «أسامي الفئات ما وصلتش» مش «فئات ممسوحة»', async () => {
  setData({ categoriesReady: false, loadErrors: ['categories'], categories: [], transactions: [{ id: 't', type: 'expense', amount: 50, date: today, walletId: 'w', categoryId: 'c1' }] });
  await mount();
  expect(screen.getByText(CATEGORY_NAMES_MISSING)).toBeTruthy();
  expect(screen.queryByText('فئات ممسوحة')).toBeNull();
});

it('الديون لسه بتحمّل ← «بنحمّل» مكان «مفيش حركة ديون»', async () => {
  setData({ transfersStatus: 'loading', debtsReady: false });
  await mount();
  expect(screen.getByTestId('reports_people_loading')).toBeTruthy();
  expect(screen.queryByText('مفيش حركة ديون في الفترة دي')).toBeNull();
});

// الجولة الأخيرة: كشف الأشخاص من الديون بس (`debtsReady`)، مش من `transfersStatus` (الديون + الجمعية)
it('الديون وصلت والجمعية لسه ← الأشخاص ظاهرين (مش «بنحمّل»)', async () => {
  setData({ transfersStatus: 'loading', debtsReady: true });
  await mount();
  expect(screen.queryByTestId('reports_people_loading')).toBeNull();
  expect(screen.getByText('مفيش حركة ديون في الفترة دي')).toBeTruthy();
});

it('الجمعية اترفضت والديون لسه ← «بنحمّل» مش «مفيش حركة ديون»', async () => {
  setData({ transfersStatus: 'failed', loadErrors: ['gamiyas'], debtsReady: false });
  await mount();
  expect(screen.getByTestId('reports_people_loading')).toBeTruthy();
  expect(screen.queryByText('مفيش حركة ديون في الفترة دي')).toBeNull();
});

it('الديون اترفضت ← سطر صريح مش «مفيش حركة ديون»', async () => {
  setData({ transfersStatus: 'failed', loadErrors: ['debts'] });
  await mount();
  expect(screen.getByTestId('reports_people_failed').props.children).toBe(DEBTS_LOAD_FAILED);
  expect(screen.queryByText('مفيش حركة ديون في الفترة دي')).toBeNull();
});

it('فيه عمليات بايظة ← سطر بعددها (البانر نفسه)', async () => {
  setData({ brokenTransactions: [{ id: 'b', reasons: ['amount'] }] });
  await mount();
  expect(screen.getByTestId('reports_broken_note').props.children).toBe(brokenTransactionsBannerText(1));
});
