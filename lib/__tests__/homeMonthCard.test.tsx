import AsyncStorage from '@react-native-async-storage/async-storage';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { requestReports, takeReportsRequest } from '@/lib/reportsRequest';
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
// useFocusEffect متقلّد: بيشغّل الـcallback في كل render يتغيّر فيه `mockFocusKey` (يعني «التاب اخد الفوكس») وأول ما يتركّب.
// ده مش فوكس حقيقي من React Navigation — توصيل الفوكس الفعلي على الجهاز مش متأكد منه
let mockFocusKey = 0;
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb, mockFocusKey]),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.c', emailVerified: true, providerData: [{ providerId: 'password' }], reload: async () => {} } }),
}));
const mockData: Record<string, unknown> = {};
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
  mockFocusKey = 0;
  takeReportsRequest();
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
    expect(homeText).toBe('380.6'); // 100.1 + 200.2 + 0.3 + 40 + 15 + 25
    // الوحدة نص لوحده جنب الرقم، مش جوه نصه (صغيرة وباهتة زي «إجمالي رصيدك»)
    expect(flat(within(card()).getByTestId('home_month_unit').props.children)).toBe('ج.م');
  });

  it('التقارير على نفس البيانات: الرقم البطل نفس نص الكارت بالحرف', async () => {
    FIXTURE();
    await render(ui(<ReportsTab />));
    // الرقم البطل: الـMoney الوحيد اللي بـ«ج.م» جوه البطاقة
    const hero = within(screen.getByTestId('reports_hero'));
    const reportsText = flat(hero.getAllByText(/^[0-9,.]+$/)[0].props.children);
    expect(flat(hero.getByTestId('reports_hero_unit').props.children)).toBe('ج.م');
    expect(homeText).toBeDefined();
    expect(reportsText).toBe(homeText);
    // قارئ الشاشة: الرقم والوحدة جملة واحدة
    expect(screen.getByLabelText('380.6 ج.م')).toBeTruthy();
    // سطر الرسم تحت «مصروفك أسبوع بأسبوع»: السنة مش بتتكرر لما الفترة كلها في السنة دي (13 نوفمبر 2026)
    expect(flat(screen.getByTestId('reports_trend_range').props.children)).toBe('من 1 نوفمبر لحد 30 نوفمبر');
  });

  it('الكارت من غير ميزانية ولا مقارنة بيعرض نفس الرقم برضه لما فيه تاريخ قبل الشهر (مقارنة بس، مش بيغيّر الرقم)', async () => {
    FIXTURE();
    await mountHome();
    expect(cardText()).toBe('380.6');
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
    expect(cardText()).toBe('123');
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

  // مهلة التحميل (2.5 ثانية) هي `loadWindowPassed` في الرئيسية — مش بنضيف مؤقت تاني
  const mountPending = async (windowPassed: boolean) => {
    setData({ figuresPending: ['transactions'], transactions: [], budgets: { total_budget: 8000 } });
    await mountHome();
    if (windowPassed) await act(async () => { await new Promise(res => setTimeout(res, 2600)); });
  };

  it('العمليات لسه ما وصلتش والمهلة ما عدّتش (ومعاها ميزانية) ← مفيش ولا رقم ولا «فاضل» ولا شريط، والتسمية «بنحمّل»', async () => {
    await mountPending(false);
    expect(within(card()).queryByText(/d/)).toBeNull();
    expect(within(card()).queryByText(/فاضل/)).toBeNull();
    expect(screen.queryByTestId('home_month_left')).toBeNull();
    expect(card().props.accessibilityLabel).toBe('صرفت الشهر ده: بنحمّل');
  });

  it('نفس الحالة بعد المهلة (حساب جديد من غير عمليات، الـlistener مرماش) ← «0 ج.م» مش «بنحمّل» للأبد', async () => {
    await mountPending(true);
    expect(cardText()).toBe('0');
    expect(flat(screen.getByTestId('home_month_left').props.children)).toBe('فاضل 8,000 ج.م');
  });

  it('العمليات وصلت (figuresPending فاضي) ← الرقم على طول', async () => {
    setData({ figuresPending: [], transactions: [exp('a', 123, '2026-11-02')] });
    await mountHome();
    expect(cardText()).toBe('123');
  });

  it('العمليات اتحرمت وهي لسه pending ← الخطأ بيكسب على «بنحمّل»', async () => {
    setData({ figuresPending: ['transactions'], loadErrors: ['transactions'] });
    await mountHome();
    expect(within(card()).getByText('مقدرناش نجيب عملياتك')).toBeTruthy();
  });

  it('الميزانية اتحرمت ← الرقم بس: مفيش ميزانية ولا مقارنة', async () => {
    setData({ loadErrors: ['budgets'], budgets: {}, transactions: [exp('o', 50, '2026-10-02'), exp('a', 123, '2026-11-02')] });
    await mountHome();
    expect(cardText()).toBe('123');
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
    expect(cardText()).toBe('0');
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
    expect(cardText()).toBe(MONEY_MASK);
    expect(flat(within(card()).getByTestId('home_month_unit').props.children)).toBe('ج.م');
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
    expect(router.push).toHaveBeenCalledWith('/(tabs)/reports');
    expect(takeReportsRequest()).toEqual({ preset: 'thisMonth', clearFilter: true });
  });

  it('الدوسة: الطلب بيتسجّل ثم التنقل للتاب من غير أي باراميترز', async () => {
    await mountHome();
    await fireEvent.press(card());
    expect(router.push).toHaveBeenCalledTimes(1);
    expect((router.push as jest.Mock).mock.calls[0]).toEqual(['/(tabs)/reports']);
    expect(takeReportsRequest()).toEqual({ preset: 'thisMonth', clearFilter: true });
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

describe('التقارير: الطلب المعلّق من الكارت (فوكس متقلّد — الفوكس الحقيقي مش متأكد منه برّه الجهاز)', () => {
  const press = (id: string) => fireEvent.press(screen.getByTestId(id));
  const selected = (id: string) => screen.getByTestId(id).props.accessibilityState?.checked ?? screen.getByTestId(id).props.accessibilityState?.selected;
  const refocus = (r: { rerender: (e: React.ReactElement) => unknown }) => { mockFocusKey++; return r.rerender(ui(<ReportsTab />)); };
  const twoCats = () => setData({ categories: [{ id: 'c1', name: 'أكل' }, { id: 'c2', name: 'مواصلات' }], transactions: [exp('a', 10, '2026-11-02', { categoryId: 'c1' }), exp('b', 20, '2026-11-03', { categoryId: 'c2' })] });
  const userPicks = async () => {
    await press('reports_preset_last7');
    if (!screen.queryByTestId('reports_filter_chip_c1')) await press('reports_filter_toggle'); // الفلتر مطوي افتراضيًا
    await fireEvent.press(screen.getAllByText(/أكل/)[0]);
    expect(screen.getByText('مسح الفلتر')).toBeTruthy();
  };

  it('طلب معلّق + فوكس ← «الشهر ده» والفلتر يتمسح والطلب يتاخد مرة', async () => {
    twoCats();
    const r = await render(ui(<ReportsTab />));
    await userPicks();
    requestReports({ preset: 'thisMonth', clearFilter: true });
    await refocus(r);
    expect(selected('reports_preset_thisMonth')).toBe(true);
    expect(screen.queryByText('مسح الفلتر')).toBeNull();
    expect(takeReportsRequest()).toBeNull();
  });

  it('فوكس تاني من غير طلب ← اختيار المستخدم بعد كده متلمسش', async () => {
    twoCats();
    const r = await render(ui(<ReportsTab />));
    requestReports({ preset: 'thisMonth', clearFilter: true });
    await refocus(r);
    await userPicks();
    await refocus(r);
    await refocus(r);
    expect(selected('reports_preset_last7')).toBe(true);
    expect(screen.getByText('مسح الفلتر')).toBeTruthy();
  });

  it('زيارة عادية من غير طلب ← الافتراضي ومفيش تغيير', async () => {
    twoCats();
    await render(ui(<ReportsTab />));
    expect(selected('reports_preset_thisMonth')).toBe(true);
    expect(screen.queryByText('مسح الفلتر')).toBeNull();
  });

  it('التقارير اتشالت واتركّبت تاني من غير طلب ← مفيش تطبيق قديم', async () => {
    twoCats();
    const first = await render(ui(<ReportsTab />));
    requestReports({ preset: 'thisMonth', clearFilter: true });
    await refocus(first);
    // key جديد = الشاشة تتشال وتتركّب تاني (unmount + render تاني في نفس الاختبار بيبوّظ شجرة RNTL)
    await first.rerender(ui(<ReportsTab key="remounted" />));
    expect(selected('reports_preset_thisMonth')).toBe(true);
    await userPicks();
    mockFocusKey++;
    await first.rerender(ui(<ReportsTab key="remounted" />));
    expect(selected('reports_preset_last7')).toBe(true);
    expect(screen.getByText('مسح الفلتر')).toBeTruthy();
  });

  it('طلب معلّق قبل أول فتح للتاب ← بيتطبّق عند التركيب', async () => {
    twoCats();
    requestReports({ preset: 'thisMonth', clearFilter: true });
    await render(ui(<ReportsTab />));
    expect(selected('reports_preset_thisMonth')).toBe(true);
    expect(takeReportsRequest()).toBeNull();
  });
});
