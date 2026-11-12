import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import HomeTab from '@/app/(tabs)/index';
import ReportsTab from '@/app/(tabs)/reports';
import ArchiveScreen from '@/app/archive';
import BudgetView from '@/components/BudgetView';
import ShakhbataView from '@/components/ShakhbataView';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { currentMonth, todayStr } from '@/lib/finance';
import { TRANSFERS_FAILED_NOTE, TRANSFERS_LOADING, TRANSFERS_SLOW, transfersStatusFrom } from '@/lib/spending';

/**
 * بند 11 (قرار مؤمن 2026-11-05): العمليات ممكن توصل قبل الديون والجمعية، وفي الثواني دي السلفة وقسط الجمعية
 * بيتعدّوا مصروف. **الرقم الغلط عمره ما يظهر:** وهو بيحمّل مكان الرقم "بنحمّل…"، ولو الديون/الجمعية اترفضوا
 * الرقم بيظهر ومعاه سطر إنه ممكن يكون فيه سلف. بانر "الميزانية قربت تخلص" مبيولّعش وهو بيحمّل.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.c', emailVerified: true, providerData: [{ providerId: 'password' }], reload: async () => {} },
    resendVerificationEmail: jest.fn(),
  }),
}));
jest.mock('@/components/IncomeHomeCards', () => ({
  __esModule: true, usePendingIncomes: () => [], default: () => null, IncomeAutoNotices: () => null,
}));
jest.mock('@/components/ChargeHomeCards', () => ({
  __esModule: true, usePendingCharges: () => [], default: () => null, ChargeAutoNotices: () => null,
}));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const today = todayStr();
// سلفة 2000 (لسه الدين ما وصلش، فبتتعدّ مصروف) + مصروف عادي 100 — الاتنين على الفئة c1 عشان الميزانية
const lend = { id: 't_lend', type: 'expense', amount: 2000, date: today, walletId: 'w', categoryId: 'c1', createdAt: `${today}T08:00:00Z` };
const food = { id: 'food', type: 'expense', amount: 100, date: today, walletId: 'w', categoryId: 'c1', createdAt: `${today}T09:00:00Z` };

function setData(transfersStatus: 'loading' | 'ready' | 'failed') {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 5000, lowAlert: 0 }],
    categories: [{ id: 'c1', name: 'خروجات', bucket: 'wants' }],
    transactions: [lend, food],
    budgets: { c1: 1000, total_budget: 2000 },
    // الدين "لسه ما وصلش" ← قايمة فاضية (زي الحقيقة وهو بيحمّل)
    debts: [], gamiyas: [], subscriptions: [], incomes: [],
    brokenTransactions: [], pendingTxIds: new Set(), serverReachable: true, setupStatus: 'done', loadErrors: [],
    shakhbataIncome: { [currentMonth()]: 10000 }, shakhbataPercents: { needs: 50, wants: 30, future: 20 },
    setBudget: jest.fn(), updateCategory: jest.fn(), setMonthlyIncome: jest.fn(), setShakhbataPercents: jest.fn(),
    transfersStatus,
  });
}

const wrap = (el: React.ReactElement) => <ThemeProvider><PrivacyProvider>{el}</PrivacyProvider></ThemeProvider>;
// النص الظاهر بس — FlatList فيها props دايرية فـJSON.stringify للشجرة كلها بيقع
const rendered = () => {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === 'string') { out.push(n); return; }
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    walk((n as { children?: unknown }).children);
  };
  walk(screen.toJSON());
  return out.join(' ');
};

describe('transfersStatusFrom', () => {
  it('الاتنين وصلوا ← ready، واحد بس ← loading، أي واحد اترفض ← failed حتى لو وصل قبل كده', () => {
    expect(transfersStatusFrom(new Set(['debts', 'gamiyas']), [])).toBe('ready');
    expect(transfersStatusFrom(new Set(['debts']), [])).toBe('loading');
    expect(transfersStatusFrom(new Set(['gamiyas']), [])).toBe('loading');
    expect(transfersStatusFrom(new Set(), [])).toBe('loading');
    expect(transfersStatusFrom(new Set(['debts', 'gamiyas']), ['gamiyas'])).toBe('failed');
    expect(transfersStatusFrom(new Set(), ['debts'])).toBe('failed');
  });
});

describe('التقارير', () => {
  it('بيحمّل ← "بنحمّل…" مكان الرقم والأعمدة والاتجاه، و2,100 مش ظاهرة', async () => {
    setData('loading');
    await render(wrap(<ReportsTab />));
    expect(screen.getByTestId('reports_period_loading').props.children).toBe(TRANSFERS_LOADING);
    expect(screen.getByTestId('reports_bars_loading')).toBeTruthy();
    expect(screen.getByTestId('reports_trend_loading')).toBeTruthy();
    expect(screen.queryByTestId('reports_bars')).toBeNull();
    expect(rendered()).not.toContain('2,100');
  });

  it('فشل ← الرقم ظاهر ومعاه السطر', async () => {
    setData('failed');
    await render(wrap(<ReportsTab />));
    expect(screen.queryByTestId('reports_period_loading')).toBeNull();
    expect(screen.getByTestId('reports_transfers_failed').props.children).toBe(TRANSFERS_FAILED_NOTE);
    expect(screen.getByTestId('reports_bars')).toBeTruthy();
  });

  it('وصلوا ← الرقم من غير سطر', async () => {
    setData('ready');
    await render(wrap(<ReportsTab />));
    expect(screen.queryByTestId('reports_period_loading')).toBeNull();
    expect(screen.queryByTestId('reports_transfers_failed')).toBeNull();
  });
});

describe('الميزانية', () => {
  it('بيحمّل ← مفيش مصروف ولا توقع، "بنحمّل…" تحت الفئة والإجمالي', async () => {
    setData('loading');
    await render(wrap(<BudgetView />));
    expect(screen.getByTestId('budget_loading_c1')).toBeTruthy();
    expect(screen.getByTestId('budget_total_loading')).toBeTruthy();
    expect(screen.queryAllByTestId(/^budget_forecast_/)).toHaveLength(0);
    expect(rendered()).not.toContain('2,100');
  });

  it('فشل ← المصروف ظاهر والسطر فوق', async () => {
    setData('failed');
    await render(wrap(<BudgetView />));
    expect(screen.queryByTestId('budget_loading_c1')).toBeNull();
    expect(screen.getByTestId('budget_transfers_failed')).toBeTruthy();
  });
});

describe('الأرشيف', () => {
  it('بيحمّل ← الإجماليات "بنحمّل…"', async () => {
    setData('loading');
    await render(wrap(<ArchiveScreen />));
    expect(screen.getByTestId('archive_income_loading')).toBeTruthy();
    expect(rendered()).not.toContain('2,100');
  });

  it('فشل ← السطر', async () => {
    setData('failed');
    await render(wrap(<ArchiveScreen />));
    expect(screen.getByTestId('archive_transfers_failed')).toBeTruthy();
  });
});

describe('شخبطة', () => {
  it('بيحمّل ← "اتصرف" مش ظاهر', async () => {
    setData('loading');
    await render(wrap(<ShakhbataView />));
    expect(screen.getByTestId('shakhbata_loading_wants')).toBeTruthy();
    expect(screen.queryByText(/اتصرف/)).toBeNull();
  });
});

describe('الرئيسية', () => {
  async function mount() {
    jest.useFakeTimers();
    await render(wrap(<HomeTab />));
    await act(async () => { jest.advanceTimersByTime(3000); });
    jest.useRealTimers();
  }

  it('بيحمّل ← بانرات الميزانية (الفئة والإجمالي) مبتولّعش على السلفة', async () => {
    setData('loading');
    await mount();
    expect(screen.queryByTestId('home_banner_budget_total')).toBeNull();
    expect(screen.queryByTestId('home_banner_budget_c1')).toBeNull();
  });

  it('فشل ← البانرات بتظهر (وبانر "مقدرناش نجيب بياناتك" بيقول السبب)', async () => {
    setData('failed');
    await mount();
    expect(screen.getByTestId('home_banner_budget_total')).toBeTruthy();
    expect(screen.getByTestId('home_banner_budget_c1')).toBeTruthy();
  });
});

describe('تصليحات جولة 1', () => {
  it('لسه بيحمّل بعد 10 ثواني ← "لسه بنحمّل — اتأكد إن النت شغال" (مش "بنحمّل…" للأبد)', async () => {
    setData('loading');
    jest.useFakeTimers();
    await render(wrap(<ReportsTab />));
    expect(screen.getByTestId('reports_period_loading').props.children).toBe(TRANSFERS_LOADING);
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(screen.getByTestId('reports_period_loading').props.children).toBe(TRANSFERS_SLOW);
    jest.useRealTimers();
  });

  it('الرئيسية: فشل وفيه بانر ميزانية ← السطر تحتها', async () => {
    setData('failed');
    jest.useFakeTimers();
    await render(wrap(<HomeTab />));
    await act(async () => { jest.advanceTimersByTime(3000); });
    jest.useRealTimers();
    expect(screen.getByTestId('home_budget_transfers_failed').props.children).toBe(TRANSFERS_FAILED_NOTE);
  });

  it('الرئيسية: البانرات اتقفلت بـ✕ ← السطر بيمشي معاها (جولة 2)', async () => {
    setData('failed');
    jest.useFakeTimers();
    await render(wrap(<HomeTab />));
    await act(async () => { jest.advanceTimersByTime(3000); });
    // المؤقتات وهمية لحد الآخر: ✕ بيجدول رجوع البانر بعد المدة، ومؤقت حقيقي كان بيسيب jest مفتوح
    await act(async () => { fireEvent.press(screen.getByTestId('home_banner_dismiss_budget_total')); });
    expect(screen.getByTestId('home_budget_transfers_failed')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('home_banner_dismiss_budget_c1')); });
    expect(screen.queryByTestId('home_budget_transfers_failed')).toBeNull();
    jest.clearAllTimers();
    jest.useRealTimers();
  });
});
