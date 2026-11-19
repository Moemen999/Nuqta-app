import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import HomeTab from '@/app/(tabs)/index';
import { HIDE_AMOUNTS_KEY, PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { COLD_CACHE_VERSION } from '@/lib/coldCache';
import { STALE_FIGURES_DELAY_MS } from '@/lib/staleFigures';
import { resetBannerDismissForTests } from '@/lib/useBannerDismiss';

/**
 * مراجعة التطبيق كله، الميزة 7 (الرئيسية): الرقم البطل والشرايح عمرهم ما يتعرضوا غلط من غير علامة متتقفلش.
 * - العمليات لسه بتوصل ← الكاش «(قديم)» لو موجود، وإلا «بنحمّل…» مكان الرقم (مش الرصيد الافتتاحي).
 * - المحافظ أو العمليات وقعت ← «(ناقص)» + «مقدرناش نجيب …» مكان الرقم.
 * - «الأرقام اتحدّثت» بس لما الاتنين وصلوا من السيرفر ومفيش حاجة وقعت.
 * - النت قطع ← «(ممكن يكون قديم)» جنب الإجمالي حتى لو البانر اتقفل بـ✕.
 * - عمليات في الطابور ولسه ما اترفعتش ← سطر من غير ✕.
 * - قارئ الشاشة: عقدة واحدة لكل شريحة ولكل صف، و«جنيه».
 */
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.c', emailVerified: true, providerData: [{ providerId: 'password' }], reload: async () => {} } }),
}));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/components/IncomeHomeCards', () => ({ __esModule: true, usePendingIncomes: () => [], default: () => null, IncomeAutoNotices: () => null }));
jest.mock('@/components/ChargeHomeCards', () => ({ __esModule: true, usePendingCharges: () => [], default: () => null, ChargeAutoNotices: () => null }));

const tx = { id: 't1', type: 'expense', amount: 50, walletId: 'w1', date: '2026-11-13', createdAt: '2026-11-13T08:00:00Z', note: '' };
const cold = {
  v: COLD_CACHE_VERSION, uid: 'u1', savedAt: Date.parse('2026-11-12T18:30:00Z'),
  wallets: [{ id: 'w1', name: 'كاش', balance: 1200 }], recent: [], categories: [],
};

function setData(over: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 1000, lowAlert: 0 }], categories: [], transactions: [tx],
    budgets: {}, subscriptions: [], gamiyas: [], incomes: [], debts: [], brokenTransactions: [], pendingTxIds: new Set(),
    serverReachable: true, figuresFromServer: true, setupStatus: 'done', loadErrors: [], figuresPending: [], outboxCount: 0,
    coldSnapshot: null, transfersStatus: 'ready',
    ...over,
  });
}

const ui = () => <ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>;
async function mount(ms = 3000) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 10, 13, 12, 0, 0));
  const r = await render(ui());
  await act(async () => { jest.advanceTimersByTime(ms); });
  return r;
}

beforeEach(async () => { resetBannerDismissForTests(); await AsyncStorage.clear(); await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, '0'); setData(); });
afterEach(() => { jest.useRealTimers(); resetBannerDismissForTests(); });

describe('العمليات لسه بتوصل', () => {
  it('من غير كاش ← «بنحمّل…» مكان الرقم، من غير شرايح، ومن غير «لسه ما سجلتش أي عملية»', async () => {
    setData({ transactions: [], figuresPending: ['transactions'], figuresFromServer: false });
    await mount();
    expect(screen.getByTestId('home_hero_loading')).toBeTruthy();
    expect(screen.queryByText('1,000')).toBeNull();
    expect(screen.queryByText('كاش')).toBeNull();
    expect(screen.queryByText('لسه ما سجلتش أي عملية')).toBeNull();
  });
  it('بعد ما وصلت ← الرقم، والحالة الفاضية «لسه ما سجلتش أي عملية»', async () => {
    setData({ transactions: [] });
    await mount();
    expect(screen.queryByTestId('home_hero_loading')).toBeNull();
    expect(screen.getAllByText('1,000').length).toBeGreaterThan(0);
    expect(screen.getByText('لسه ما سجلتش أي عملية')).toBeTruthy();
  });
  it('قبل مهلة التحميل ← مفيش حالة فاضية خالص (كانت بتلمع)', async () => {
    setData({ transactions: [] });
    await mount(1000);
    expect(screen.queryByText('لسه ما سجلتش أي عملية')).toBeNull();
  });
});

describe('listener وقع', () => {
  it('العمليات وقعت ← «(ناقص)» و«مقدرناش نجيب العمليات» مكان الرقم، والقايمة الفاضية بتقول ما وصلتش، ومفيش «قرب يخلص»', async () => {
    setData({
      transactions: [], loadErrors: ['transactions'], figuresPending: ['transactions'], figuresFromServer: false,
      wallets: [{ id: 'w1', name: 'كاش', openingBalance: 100, lowAlert: 500 }],
    });
    await mount();
    expect(screen.getByText('إجمالي رصيدك (ناقص)')).toBeTruthy();
    expect(screen.getByTestId('home_hero_failed').props.children).toBe('مقدرناش نجيب العمليات');
    expect(screen.queryByText('100')).toBeNull();
    expect(screen.getByText(/عملياتك ما وصلتش من السيرفر/)).toBeTruthy();
    expect(screen.queryByText(/قرب يخلص/)).toBeNull();
  });
  it('المحافظ وقعت ← «مقدرناش نجيب المحافظ» مش 0', async () => {
    setData({ wallets: [], loadErrors: ['wallets'], figuresPending: ['wallets'] });
    await mount();
    expect(screen.getByTestId('home_hero_failed').props.children).toBe('مقدرناش نجيب المحافظ');
    expect(screen.queryByText('0')).toBeNull();
  });
  it('الديون وقعت بس ← الرقم زي ما هو (مش جوه الرصيد)', async () => {
    setData({ loadErrors: ['debts'] });
    await mount();
    expect(screen.queryByTestId('home_hero_failed')).toBeNull();
    expect(screen.getByText('إجمالي رصيدك')).toBeTruthy();
  });
});

describe('«الأرقام اتحدّثت»', () => {
  it('الكاش اختفى والعمليات لسه بتوصل أو واقعة ← مفيش إعلان؛ وصلت ← بيتقال', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    setData({ wallets: [], transactions: [], coldSnapshot: cold, figuresFromServer: false, figuresPending: ['wallets', 'transactions'] });
    const r = await mount();
    announce.mockClear();
    setData({ figuresFromServer: true, figuresPending: ['transactions'], transactions: [] });
    await act(async () => { r.rerender(ui()); });
    setData({ figuresFromServer: true, loadErrors: ['transactions'], figuresPending: ['transactions'], transactions: [] });
    await act(async () => { r.rerender(ui()); });
    expect(announce.mock.calls.map(c => c[0])).not.toContain('الأرقام اتحدّثت');
    setData({ figuresFromServer: true });
    await act(async () => { r.rerender(ui()); });
    expect(announce.mock.calls.map(c => c[0])).toContain('الأرقام اتحدّثت');
    announce.mockRestore();
  });
});

it('النت قطع والأرقام قديمة ← «(ممكن يكون قديم)» جنب الإجمالي، وبيفضل بعد ✕ البانر', async () => {
  setData({ figuresFromServer: false, serverReachable: false });
  await mount(STALE_FIGURES_DELAY_MS + 100);
  expect(screen.getByTestId('home_banner_stale')).toBeTruthy();
  expect(screen.getByText('إجمالي رصيدك (ممكن يكون قديم)')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('home_banner_dismiss_stale')); });
  expect(screen.queryByTestId('home_banner_stale')).toBeNull();
  expect(screen.getByText('إجمالي رصيدك (ممكن يكون قديم)')).toBeTruthy();
});

describe('عمليات في الطابور ولسه ما اترفعتش', () => {
  it('من غير نت ← سطر من غير ✕ بالعدد', async () => {
    setData({ outboxCount: 3, serverReachable: false, figuresFromServer: false });
    await mount();
    const line = screen.getByTestId('home_outbox_line');
    expect(within(line).getByText('عندك 3 عمليات متسجلة على الموبايل ولسه ما اترفعتش')).toBeTruthy();
    expect(within(line).queryByLabelText(/اقفل|✕/)).toBeNull();
  });
  it('مفيش ← مفيش سطر', async () => {
    setData({ outboxCount: 0, serverReachable: false });
    await mount();
    expect(screen.queryByTestId('home_outbox_line')).toBeNull();
  });
});

describe('الرصيد بيتقرّب للقرش', () => {
  it('-0.001 ← «0» مش «-0»، والشريحة والإجمالي نفس الرقم', async () => {
    setData({ wallets: [{ id: 'w1', name: 'كاش', openingBalance: 49.999, lowAlert: 0 }] });
    await mount();
    expect(screen.queryByText(/-0/)).toBeNull();
    expect(screen.queryByText(/بالسالب/)).toBeNull();
  });
  it('رصيد بالسالب ← «بالسالب» مش «قرب يخلص»', async () => {
    setData({ wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }] });
    await mount();
    expect(screen.getByText('رصيد كاش بالسالب (-50 ج.م)')).toBeTruthy();
  });
});

describe('قارئ الشاشة', () => {
  it('شريحة المحفظة عقدة واحدة «الاسم، المبلغ جنيه»، والإجمالي بـ«جنيه»، والعناوين header', async () => {
    await mount();
    expect(screen.getByLabelText('كاش، 950 جنيه')).toBeTruthy();
    expect(screen.getByLabelText('950 جنيه')).toBeTruthy();
    expect(screen.getByText('إجمالي رصيدك').props.accessibilityRole).toBe('header');
    expect(screen.getByTestId('home_recent_title').props.accessibilityRole).toBe('header');
  });
  it('العين مقفولة ← «الاسم: مبلغ مخفي»', async () => {
    await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, '1');
    await mount();
    expect(screen.getByLabelText('كاش: مبلغ مخفي')).toBeTruthy();
    expect(screen.queryByLabelText('950 جنيه')).toBeNull();
  });
  it('صف العملية عقدة واحدة: النوع والمبلغ بـ«جنيه» والعلامات، وتلميح بيفتح التعديل', async () => {
    setData({ pendingTxIds: new Set(['t1']) });
    await mount();
    const row = screen.getByTestId('home_tx_t1');
    expect(row.props.accessibilityLabel).toMatch(/^مصروف، كاش، 50 جنيه، النهاردة[^،]*، لسه بترفع$/);
    expect(row.props.accessibilityHint).toBe('بيفتح تعديل العملية');
  });
});
