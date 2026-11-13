import AsyncStorage from '@react-native-async-storage/async-storage';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import HomeTab from '@/app/(tabs)/index';
import ReportsTab from '@/app/(tabs)/reports';
import { HIDE_AMOUNTS_KEY, PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { COLD_CACHE_VERSION } from '@/lib/coldCache';
import { MONEY_MASK } from '@/lib/money';
import { TRANSFERS_FAILED_NOTE, TRANSFERS_LOADING } from '@/lib/spending';

/**
 * كارت «صرفت الشهر ده» في الرئيسية. أهم اختبار هنا: **الكارت والرقم البطل في التقارير نفس النص** على نفس البيانات —
 * الشاشتين الحقيقيتين، مش دالة قصاد نفسها.
 */
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.c', emailVerified: true, providerData: [{ providerId: 'password' }], reload: async () => {} } }),
}));
const mockData: Record<string, unknown> = {};
let mockParams: Record<string, string> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/components/IncomeHomeCards', () => ({ __esModule: true, usePendingIncomes: () => [], default: () => null, IncomeAutoNotices: () => null }));
jest.mock('@/components/ChargeHomeCards', () => ({ __esModule: true, usePendingCharges: () => [], default: () => null, ChargeAutoNotices: () => null }));

type Row = Record<string, unknown>;
const exp = (id: string, amount: number, date: string, extra: Row = {}): Row => ({ id, type: 'expense', amount, date, walletId: 'w1', categoryId: 'c1', createdAt: `${date}T08:00:00Z`, ...extra });

function setData(over: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 100000, lowAlert: 0 }], categories: [{ id: 'c1', name: 'أكل' }],
    transactions: [], budgets: {}, subscriptions: [], gamiyas: [], incomes: [], debts: [], brokenTransactions: [], pendingTxIds: new Set(),
    serverReachable: true, setupStatus: 'done', loadErrors: [], transfersStatus: 'ready', figuresPending: [], figuresFromServer: true, coldSnapshot: null,
    ...over,
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, '0');
  mockParams = {};
  (router.push as jest.Mock).mockClear();
  // الساعة بس متثبّتة (13 نوفمبر 2026) — المؤقتات حقيقية
  jest.useFakeTimers({ now: new Date(2026, 10, 13, 12, 0, 0), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
  setData();
});
afterEach(() => jest.useRealTimers());

const ui = (el: React.ReactElement) => <ThemeProvider><PrivacyProvider>{el}</PrivacyProvider></ThemeProvider>;
async function mountHome() {
  const r = await render(ui(<HomeTab />));
  await waitFor(() => expect(screen.getByTestId('home_hide_amounts_toggle').props.accessibilityState.checked).toBe(false));
  return r;
}
const card = () => screen.getByTestId('home_month_card');
const flat = (c: unknown) => [c].flat().join('');
const textOf = (id: string) => { const el = screen.queryByTestId(id); return el ? flat(el.props.children) : undefined; };
const cardText = () => flat(within(card()).getByTestId('home_month_value').props.children);

describe('الكارت = الرقم البطل في التقارير (نفس البيانات، الشاشتين الحقيقيتين)', () => {
  const FIXTURE = () => {
    setData({
      wallets: [
        { id: 'w1', name: 'كاش', openingBalance: 100000, lowAlert: 0 },
        { id: 'w2', name: 'قديمة', openingBalance: 0, lowAlert: 0, archived: true },
      ],
      categories: [{ id: 'c1', name: 'أكل' }, { id: 'c2', name: 'مؤرشفة', archived: true }],
      transactions: [
        exp('e1', 100.1, '2026-11-02'), exp('e2', 200.2, '2026-11-03'), exp('e3', 0.3, '2026-11-04'),
        exp('loan_tx', 5000, '2026-11-05', { categoryId: undefined }),          // سلفة (initialTransactionId)
        exp('gm_tx', 700, '2026-11-06', { categoryId: undefined }),             // قسط جمعية
        { id: 'wd', type: 'withdraw', amount: 400, date: '2026-11-07', walletId: 'w1', toWalletId: 'w2' }, // سحب/تحويل
        { id: 'inc', type: 'income', amount: 999, date: '2026-11-08', walletId: 'w1' },
        exp('future', 40, '2026-11-25'),                                         // تاريخه جاي في الشهر ده
        exp('arch_w', 15, '2026-11-09', { walletId: 'w2' }),                     // على محفظة مؤرشفة
        exp('arch_c', 25, '2026-11-10', { categoryId: 'c2' }),                   // في فئة مؤرشفة
        exp('old', 77, '2026-10-05'),                                            // شهر فات
      ],
      debts: [{ id: 'd1', direction: 'owed_to_me', initialTransactionId: 'loan_tx', payments: [], increases: [] }],
      gamiyas: [{ id: 'g1', months: [{ transactionId: 'gm_tx' }] }],
    });
  };

  // شاشتين في نفس الاختبار بيسيبوا الشجرة فاضية للاختبارات اللي بعده (RNTL)، فالاتنين اختبارين ورا بعض والنص بينهم في متغير
  let homeText: string | undefined;

  it('الرئيسية: الكارت بيعرض «380.6 ج.م»', async () => {
    FIXTURE();
    await mountHome();
    homeText = cardText();
    expect(homeText).toBe('380.6 ج.م'); // 100.1 + 200.2 + 0.3 + 40 + 15 + 25
  });

  it('التقارير على نفس البيانات: الرقم البطل نفس نص الكارت بالحرف', async () => {
    FIXTURE();
    await render(ui(<ReportsTab />));
    // الرقم البطل: الـMoney الوحيد اللي بـ«ج.م» جوه البطاقة
    const reportsText = flat(within(screen.getByTestId('reports_hero')).getAllByText(/ج.م$/)[0].props.children);
    expect(homeText).toBeDefined();
    expect(reportsText).toBe(homeText);
  });

  it('الكارت من غير ميزانية ولا مقارنة بيعرض نفس الرقم برضه لما فيه تاريخ قبل الشهر (مقارنة بس، مش بيغيّر الرقم)', async () => {
    FIXTURE();
    await mountHome();
    expect(cardText()).toBe('380.6 ج.م');
    expect(flat(screen.getByTestId('home_month_previous').props.children)).toBe('الشهر اللي فات لحد يوم 13: 77 ج.م');
  });
});

describe('حالات الكارت', () => {
  it('بنحمّل (transfersStatus=loading) ← مفيش ولا رقم في الكارت', async () => {
    setData({ transfersStatus: 'loading', transactions: [exp('a', 123, '2026-11-02')], budgets: { total_budget: 1000 } });
    await mountHome();
    expect(within(card()).queryByText(/\d/)).toBeNull();
    expect(within(card()).getByText(TRANSFERS_LOADING)).toBeTruthy();
    expect(card().props.accessibilityLabel).toBe('صرفت الشهر ده: بنحمّل');
  });

  it('الديون فشلت ← الرقم + سطر التقارير', async () => {
    setData({ transfersStatus: 'failed', transactions: [exp('a', 123, '2026-11-02')] });
    await mountHome();
    expect(cardText()).toBe('123 ج.م');
    expect(within(card()).getByTestId('home_month_transfers_failed').props.children).toBe(TRANSFERS_FAILED_NOTE);
    expect(card().props.accessibilityLabel).toContain(TRANSFERS_FAILED_NOTE);
  });

  it('كاش بارد ← مفيش كارت', async () => {
    setData({
      wallets: [], transactions: [], serverReachable: false, figuresFromServer: false,
      coldSnapshot: { v: COLD_CACHE_VERSION, uid: 'u1', savedAt: Date.parse('2026-11-01T18:30:00Z'), wallets: [{ id: 'w1', name: 'كاش', balance: 1200 }], recent: [], categories: [] },
    });
    await mountHome();
    expect(screen.queryByTestId('home_month_card')).toBeNull();
  });

  it('مفيش نت وفاضي، ومفيش محفظة ← مفيش كارت', async () => {
    setData({ wallets: [], serverReachable: false });
    await mountHome();
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(screen.queryByTestId('home_month_card')).toBeNull();
    setData({ wallets: [{ id: 'w1', name: 'قديمة', openingBalance: 0, lowAlert: 0, archived: true }] });
    await screen.rerender(ui(<HomeTab />));
    expect(screen.queryByTestId('home_month_card')).toBeNull();
  });

  it('العمليات اتحرمت (loadErrors) ← مفيش رقم', async () => {
    setData({ loadErrors: ['transactions'], transactions: [exp('a', 123, '2026-11-02')] });
    await mountHome();
    expect(within(card()).queryByText(/\d/)).toBeNull();
    expect(within(card()).getByText('مقدرناش نجيب عملياتك')).toBeTruthy();
  });

  it('listener العمليات لسه ما رماش حاجة (figuresPending) وحساب من غير عمليات ← «0 ج.م» مش «بنحمّل» للأبد', async () => {
    setData({ figuresPending: ['transactions'], transactions: [] });
    await mountHome();
    expect(cardText()).toBe('0 ج.م');
  });

  it('الميزانية اتحرمت ← الرقم بس: مفيش ميزانية ولا مقارنة', async () => {
    setData({ loadErrors: ['budgets'], budgets: {}, transactions: [exp('o', 50, '2026-10-02'), exp('a', 123, '2026-11-02')] });
    await mountHome();
    expect(cardText()).toBe('123 ج.م');
    expect(screen.queryByTestId('home_month_previous')).toBeNull();
    expect(screen.queryByTestId('home_month_budget_line')).toBeNull();
    expect(screen.queryByTestId('home_month_left')).toBeNull();
  });

  it('أول شهر في الاستخدام ← مفيش سطر مقارنة ولا دعوة لتحديد ميزانية', async () => {
    setData({ transactions: [exp('a', 123, '2026-11-02')] });
    await mountHome();
    expect(screen.queryByTestId('home_month_previous')).toBeNull();
    expect(within(card()).queryByText(/ميزانية/)).toBeNull();
  });

  it('صفر مصروف ← «0 ج.م»', async () => {
    await mountHome();
    expect(cardText()).toBe('0 ج.م');
  });

  it('مفيش ولا «أكتر/أقل» ولا نسبة على الكارت', async () => {
    setData({ transactions: [exp('o', 100, '2026-10-02'), exp('a', 300, '2026-11-02')] });
    await mountHome();
    expect(within(card()).queryByText(/أكتر|أقل|%|بالمية/)).toBeNull();
  });
});

describe('الجمل', () => {
  const lines = () => ({
    of: textOf('home_month_of'),
    left: textOf('home_month_left'),
    budget: screen.queryByTestId('home_month_budget_line')?.props.children,
    prev: textOf('home_month_previous'),
  });

  it('تحت الميزانية: «من 8,000 ج.م» و«فاضل 2,350 ج.م» والشريط', async () => {
    setData({ budgets: { total_budget: 8000 }, transactions: [exp('a', 5650, '2026-11-02')] });
    await mountHome();
    expect(lines()).toMatchObject({ of: 'من 8,000 ج.م', left: 'فاضل 2,350 ج.م' });
    expect(card().props.accessibilityLabel).toBe('صرفت الشهر ده 5,650 جنيه، من 8,000 جنيه، فاضل 2,350 جنيه');
    // من غير مقارنة لما فيه ميزانية
    expect(lines().prev).toBeUndefined();
  });

  it('قربت: «فاضل 1,200 ج.م — قربت تخلص»', async () => {
    setData({ budgets: { total_budget: 8000 }, transactions: [exp('a', 6800, '2026-11-02')] });
    await mountHome();
    expect(within(card()).getByText('فاضل 1,200 ج.م — قربت تخلص')).toBeTruthy();
  });

  it('خلصت: «الميزانية خلصت» حتى بفرق تحت القرش', async () => {
    setData({ budgets: { total_budget: 8000 }, transactions: [exp('a', 7999.996, '2026-11-02')] });
    await mountHome();
    expect(within(card()).getByText('الميزانية خلصت')).toBeTruthy();
  });

  it('عدّيت: «عدّيت الميزانية بـ 450 ج.م»', async () => {
    setData({ budgets: { total_budget: 8000 }, transactions: [exp('a', 8450, '2026-11-02')] });
    await mountHome();
    expect(within(card()).getByText('عدّيت الميزانية بـ 450 ج.م')).toBeTruthy();
    expect(card().props.accessibilityLabel).toContain('عدّيت الميزانية بـ 450 جنيه');
  });

  it('من غير ميزانية: «الشهر اللي فات لحد يوم 13: 3,775 ج.م»', async () => {
    setData({ transactions: [exp('o1', 1000, '2026-10-05'), exp('o2', 2775, '2026-10-13'), exp('o3', 9999, '2026-10-20'), exp('a', 10, '2026-11-02')] });
    await mountHome();
    expect(lines().prev).toBe('الشهر اللي فات لحد يوم 13: 3,775 ج.م');
    expect(card().props.accessibilityLabel).toContain('الشهر اللي فات لحد يوم 13: 3,775 جنيه');
  });

  it('الشهر اللي فات صفر وفيه تاريخ أقدم: «مصرفتش حاجة»', async () => {
    setData({ transactions: [exp('old', 10, '2026-08-05'), exp('a', 10, '2026-11-02')] });
    await mountHome();
    expect(lines().prev).toBe('الشهر اللي فات لحد يوم 13: مصرفتش حاجة');
  });

  it('آخر يوم في الشهر: «الشهر اللي فات كله» (31 أكتوبر ← سبتمبر)', async () => {
    jest.setSystemTime(new Date(2026, 9, 31, 12, 0, 0));
    setData({ transactions: [exp('s', 500, '2026-09-10'), exp('a', 10, '2026-10-02')] });
    await mountHome();
    expect(lines().prev).toBe('الشهر اللي فات كله: 500 ج.م');
  });
});

describe('الخصوصية والوصولية والتنقل', () => {
  it('المبالغ مخفية ← القناع في الكل، والتسمية «مبلغ مخفي»، والرقم الحقيقي مش على الشاشة', async () => {
    await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, '1');
    setData({ budgets: { total_budget: 8000 }, transactions: [exp('a', 5650, '2026-11-02')] });
    await render(ui(<HomeTab />));
    await waitFor(() => expect(within(card()).getByTestId('home_month_value')).toBeTruthy());
    expect(cardText()).toBe(`${MONEY_MASK} ج.م`);
    expect(flat(within(card()).getByTestId('home_month_of').props.children)).toBe(`من ${MONEY_MASK} ج.م`);
    expect(within(card()).queryByText(/5,650|8,000|2,350/)).toBeNull();
    const label = card().props.accessibilityLabel as string;
    expect(label).toContain('مبلغ مخفي');
    expect(label).not.toContain(MONEY_MASK);
    expect(label).not.toMatch(/5,650|8,000|2,350/);
  });

  it('مفيش حاجة بتتداس جوه الكارت (مفيش زرار جوه زرار) — حتى والمبالغ مخفية، والدوسة على الكارت بتفتح التقارير', async () => {
    await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, '1');
    setData({ transactions: [exp('a', 123, '2026-11-02')] });
    await render(ui(<HomeTab />));
    await waitFor(() => expect(within(card()).getByTestId('home_month_value')).toBeTruthy());
    const inner = within(card()).queryAllByRole('button');
    expect(inner).toHaveLength(0);
    expect(card().props.accessibilityRole).toBe('button');
    expect(card().props.accessibilityHint).toBe('بيفتح التقارير');
    await fireEvent.press(card());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/reports', params: { preset: 'thisMonth', at: expect.any(String) } });
  });

  it('الدوسة: كل مرة `at` جديد (بيتقاس بالوقت)', async () => {
    await mountHome();
    await fireEvent.press(card());
    jest.setSystemTime(new Date(2026, 10, 13, 12, 0, 5));
    await fireEvent.press(card());
    const ats = (router.push as jest.Mock).mock.calls.map(c => c[0].params.at);
    expect(ats).toHaveLength(2);
    expect(ats[0]).not.toBe(ats[1]);
  });

  it('الكارت مش بانر: testID مش home_banner_*، وفوق «آخر العمليات» تحت الرصيد', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
    expect(src).toContain('testID="home_month_card"');
    expect(src).not.toMatch(/home_banner_month/);
    expect(src.indexOf('testID="home_month_card"')).toBeGreaterThan(src.indexOf('home_hide_amounts_toggle'));
    expect(src.indexOf('testID="home_month_card"')).toBeLessThan(src.indexOf('testID="home_recent_title"'));
    const card = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'MonthSummaryCard.tsx'), 'utf8');
    expect(card).not.toMatch(/<Money\b/);
    expect(card).toContain('speakable(');
  });
});

describe('التقارير: باراميتر الكارت', () => {
  const press = (id: string) => fireEvent.press(screen.getByTestId(id));
  const selected = (id: string) => screen.getByTestId(id).props.accessibilityState?.checked ?? screen.getByTestId(id).props.accessibilityState?.selected;

  it('`at` جديد ← «الشهر ده» والفلتر يتمسح؛ والزيارة العادية والـrerender بنفس `at` ملهمش أثر', async () => {
    setData({ categories: [{ id: 'c1', name: 'أكل' }, { id: 'c2', name: 'مواصلات' }], transactions: [exp('a', 10, '2026-11-02', { categoryId: 'c1' }), exp('b', 20, '2026-11-03', { categoryId: 'c2' })] });
    const r = await render(ui(<ReportsTab />));
    // زيارة عادية من غير باراميترز: الافتراضي
    expect(selected('reports_preset_thisMonth')).toBe(true);
    await press('reports_preset_last7');
    await fireEvent.press(screen.getAllByText(/أكل/)[0]);
    expect(screen.getByText('مسح الفلتر')).toBeTruthy();
    expect(selected('reports_preset_last7')).toBe(true);

    // rerender عادي من غير تغيير باراميترز ← مفيش تطبيق
    await r.rerender(ui(<ReportsTab />));
    expect(selected('reports_preset_last7')).toBe(true);
    expect(screen.getByText('مسح الفلتر')).toBeTruthy();

    // دوسة على الكارت ← باراميترز جديدة
    mockParams = { preset: 'thisMonth', at: '1000' };
    await r.rerender(ui(<ReportsTab />));
    expect(selected('reports_preset_thisMonth')).toBe(true);
    expect(screen.queryByText('مسح الفلتر')).toBeNull();

    // المستخدم غيّر تاني، ورجع للتاب من غير دوسة جديدة (نفس `at`) ← فضل على اختياره
    await press('reports_preset_last7');
    await r.rerender(ui(<ReportsTab />));
    expect(selected('reports_preset_last7')).toBe(true);

    // دوسة تانية ← `at` جديد ← بيتطبق تاني
    mockParams = { preset: 'thisMonth', at: '2000' };
    await r.rerender(ui(<ReportsTab />));
    expect(selected('reports_preset_thisMonth')).toBe(true);
  });
});
