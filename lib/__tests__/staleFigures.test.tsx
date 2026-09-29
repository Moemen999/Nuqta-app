import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import HomeTab from '@/app/(tabs)/index';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { STALE_FIGURES_DELAY_MS, STALE_FIGURES_TEXT, figuresFresh } from '@/lib/staleFigures';

/**
 * بانر "النت قطع — الأرقام ممكن تكون قديمة" (2026-09-29):
 * - قطع أقصر من المهلة ← مفيش بانر
 * - بعد المهلة ← البانر
 * - النت رجع بس الأرقام لسه ما اتحدّثتش ← البانر لسه
 * - الأرقام اتحدّثت ← البانر اختفى
 * - فوق آخر العمليات، ومش في عدّاد "مستنيين ردك"
 * وحساب "اتحدّثت" نفسه (المحافظ **والعمليات**) في figuresFromServer.emulator.test.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', emailVerified: true, providerData: [], reload: async () => {} } }),
}));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/components/IncomeHomeCards', () => ({
  __esModule: true, usePendingIncomes: () => [], default: () => null, IncomeAutoNotices: () => null,
}));
jest.mock('@/components/ChargeHomeCards', () => ({
  __esModule: true, usePendingCharges: () => [], default: () => null, ChargeAutoNotices: () => null,
}));

const tx = { id: 't1', type: 'expense', amount: 50, walletId: 'w1', date: '2026-01-02', createdAt: '2026-01-02T08:00:00Z' };

function setData(over: Record<string, unknown>) {
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 1000, lowAlert: 0 }], categories: [], transactions: [tx],
    budgets: {}, subscriptions: [], gamiyas: [], incomes: [], debts: [], pendingTxIds: new Set(),
    serverReachable: true, figuresFromServer: true, setupStatus: 'done', loadErrors: [],
    ...over,
  });
}

const tree = () => <ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>;
const banner = () => screen.queryByTestId('home_banner_stale');
const advance = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); };

beforeEach(() => { jest.useFakeTimers(); setData({}); });
afterEach(() => { jest.useRealTimers(); });

it('المهلة 10 ثواني — في مكان واحد', () => {
  expect(STALE_FIGURES_DELAY_MS).toBe(10_000);
});

it('قطع قصير (أقل من المهلة) ← مفيش بانر، حتى بعد ما يرجع', async () => {
  const view = await render(tree());
  setData({ serverReachable: false, figuresFromServer: false });
  await act(async () => { view.rerender(tree()); });
  await advance(STALE_FIGURES_DELAY_MS - 1000);
  expect(banner()).toBeNull();
  setData({ serverReachable: true, figuresFromServer: true });
  await act(async () => { view.rerender(tree()); });
  await advance(STALE_FIGURES_DELAY_MS * 2);
  expect(banner()).toBeNull();
});

it('بعد المهلة ← البانر بالنص بالظبط', async () => {
  const view = await render(tree());
  setData({ serverReachable: false, figuresFromServer: false });
  await act(async () => { view.rerender(tree()); });
  await advance(STALE_FIGURES_DELAY_MS + 100);
  expect(banner()).toBeTruthy();
  expect(screen.getByText(STALE_FIGURES_TEXT)).toBeTruthy();
  expect(STALE_FIGURES_TEXT).toBe('النت قطع — الأرقام ممكن تكون قديمة');
});

it('النت رجع (serverReachable) بس الأرقام لسه ما اتحدّثتش ← البانر لسه، ولما تتحدّث يختفي', async () => {
  const view = await render(tree());
  setData({ serverReachable: false, figuresFromServer: false });
  await act(async () => { view.rerender(tree()); });
  await advance(STALE_FIGURES_DELAY_MS + 100);
  expect(banner()).toBeTruthy();

  setData({ serverReachable: true, figuresFromServer: false });
  await act(async () => { view.rerender(tree()); });
  await advance(STALE_FIGURES_DELAY_MS * 3);
  expect(banner()).toBeTruthy();

  setData({ serverReachable: true, figuresFromServer: true });
  await act(async () => { view.rerender(tree()); });
  expect(banner()).toBeNull();
});

it('من غير أرقام على الشاشة ← مش البانر ده (ده "مفيش نت" التاني)', async () => {
  setData({ wallets: [], transactions: [], serverReachable: false, figuresFromServer: false });
  await render(tree());
  await advance(STALE_FIGURES_DELAY_MS * 2);
  expect(banner()).toBeNull();
  expect(screen.getByTestId('home_banner_offline')).toBeTruthy();
});

it('فوق آخر العمليات، ومش في عدّاد "مستنيين ردك"', async () => {
  const view = await render(tree());
  setData({ serverReachable: false, figuresFromServer: false });
  await act(async () => { view.rerender(tree()); });
  await advance(STALE_FIGURES_DELAY_MS + 100);
  const ids: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as { props?: { testID?: string }; children?: unknown };
    if (node.props?.testID) ids.push(node.props.testID);
    walk(node.children);
  };
  walk(screen.toJSON());
  expect(ids.indexOf('home_banner_stale')).toBeGreaterThan(-1);
  expect(ids.indexOf('home_banner_stale')).toBeLessThan(ids.indexOf('home_recent_title'));
  expect(screen.queryByTestId('home_pending_summary')).toBeNull();
});

describe('figuresFresh — المحافظ والعمليات الاتنين من السيرفر', () => {
  it.each([
    [false, false, true],
    [false, true, false],   // المحافظ رجعت والعمليات لسه من الكاش ← لسه قديمة
    [true, false, false],
    [true, true, false],
    [false, null, true],    // العمليات لسه مرمتش (مجموعة فاضية) ← مبيمنعش
    [null, false, true],
    [null, null, false],    // ولا واحد وصل
    [true, null, false],
  ] as const)('محافظ fromCache=%s، عمليات fromCache=%s ← %s', (w, t, fresh) => {
    expect(figuresFresh(w, t)).toBe(fresh);
  });
});
