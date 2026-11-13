import AsyncStorage from '@react-native-async-storage/async-storage';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import HomeTab from '@/app/(tabs)/index';
import { HIDE_AMOUNTS_KEY, PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { dismissLabel } from '@/lib/bannerDismiss';
import { MONEY_MASK } from '@/lib/money';
import { DISMISS_KEY, resetBannerDismissForTests } from '@/lib/useBannerDismiss';
import { VERIFY_SPAM_HINT } from '@/lib/useEmailVerification';

/**
 * «حاجات محتاجة انتباهك» في الرئيسية (قرار مؤمن 2026-11-13): الإيميل، لسه ما سجلتش، رصيد قرب يخلص، ميزانية فئة،
 * اشتراك وقسط جمعية جايين — سطر واحد `home_attention_line` بيفتح شيت `attention_sheet`. بانرات «الأرقام ممكن تكون غلط»
 * و«ما سجلناش» وسطر «مستنيين ردك» زي ما هم. **الجرد الكبير في الآخر:** كل بانر قديم لسه موصول بنفس نصه ومفتاح ✕ (ووجهة الاشتراك والجمعية القديمة؛ وجهتا الرصيد والميزانية جديدتان).
 * الوقت ثابت: 2026-11-13 الساعة 9 م (بعد ساعة التذكير الافتراضية 8 م).
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const mockResend = jest.fn(async () => {});
const mockUser = { uid: 'u1', email: 'a@b.c', emailVerified: true, providerData: [{ providerId: 'password' }], reload: async () => {} };
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, resendVerificationEmail: mockResend }),
}));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

// كروت «مستنيين ردك» ليها اختباراتها — هنا بس بنقرر قد إيه مستنيين (سطر «مستنيين ردك» بيتعدّ منهم)
let mockPendingIncomes: unknown[] = [];
let mockPendingCharges: unknown[] = [];
jest.mock('@/components/IncomeHomeCards', () => ({
  __esModule: true, usePendingIncomes: () => mockPendingIncomes, default: () => null, IncomeAutoNotices: () => null,
}));
jest.mock('@/components/ChargeHomeCards', () => ({
  __esModule: true, usePendingCharges: () => mockPendingCharges, default: () => null, ChargeAutoNotices: () => null,
}));

const H = 3_600_000;
const TODAY = '2026-11-13';
const IN2 = '2026-11-15';
const exp = (id: string, amount: number, date = TODAY, categoryId?: string) =>
  ({ id, type: 'expense', amount, walletId: 'w1', categoryId, date, createdAt: `${date}T08:00:00Z` });

const LOW = { id: 'w1', name: 'كاش', openingBalance: 100, lowAlert: 500 };
const CAT = { id: 'c1', name: 'أكل' };
const SUB = { id: 's1', name: 'نتفليكس', amount: 100, walletId: 'w1', active: true, nextDueDate: IN2, reminderDaysBefore: 3 };
const GAM = {
  id: 'g1', name: 'العيلة', walletId: 'w1', reminderDaysBefore: 3,
  months: [{ id: 'm2', monthIndex: 2, dueDate: IN2, isPayoutMonth: false, amount: 500, status: 'pending' }],
};

/** من غير أي تنبيه روتيني: رصيد فوق الحد، عملية النهاردة */
function setData(over: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 9000, lowAlert: 0 }], categories: [], transactions: [exp('t0', 1)],
    budgets: {}, subscriptions: [], gamiyas: [], incomes: [], debts: [], brokenTransactions: [], pendingTxIds: new Set(),
    serverReachable: true, setupStatus: 'done', loadErrors: [], transfersStatus: 'ready', figuresPending: [], figuresFromServer: true,
    retryLoad: jest.fn(),
    ...over,
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 10, 13, 21, 0, 0));
  resetBannerDismissForTests();
  await AsyncStorage.clear();
  mockPendingIncomes = []; mockPendingCharges = [];
  mockUser.emailVerified = true;
  mockResend.mockClear();
  (router.push as jest.Mock).mockClear();
  setData();
});
// ✕ بيكتب في التخزين بعد قراية async — من غير تفريغ هنا الكتابة دي كانت بتوصل بعد `AsyncStorage.clear()` بتاع الاختبار اللي بعده
afterEach(async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  jest.clearAllTimers(); resetBannerDismissForTests(); jest.useRealTimers();
});

const ui = () => <ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>;
async function mount() {
  const r = await render(ui());
  await act(async () => { jest.advanceTimersByTime(3000); });
  return r;
}
const advance = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const press = async (id: string) => { await act(async () => { fireEvent.press(screen.getByTestId(id)); }); };
const openSheet = () => press('home_attention_line');
const shown = (id: string) => screen.queryByTestId(id) !== null;
const hasText = (t: string | RegExp) => screen.queryAllByText(t).length > 0;

/** الـtestIDs بترتيب الرسم، بالبادئة دي */
function ids(prefix: string): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as { props?: { testID?: string }; children?: unknown };
    if (node.props?.testID?.startsWith(prefix)) out.push(node.props.testID);
    walk(node.children);
  };
  walk(screen.toJSON());
  return out;
}
const stored = async () => JSON.parse((await AsyncStorage.getItem(DISMISS_KEY)) ?? '{}') as Record<string, number>;

/** أربع حالات روتينية: رصيد قرب يخلص، ميزانية فئة، اشتراك جاي، إيميل مش مأكّد */
function fourRoutine() {
  mockUser.emailVerified = false;
  setData({
    wallets: [LOW], categories: [CAT], budgets: { c1: 100 }, transactions: [exp('t1', 85, TODAY, 'c1')], subscriptions: [SUB],
  });
}

describe('أربع حالات روتينية ← سطر واحد', () => {
  it('«عندك 4 حاجات محتاجة انتباهك» وبس — ولا بانر قديم على الشاشة، والسطر بعد «مستنيين ردك» وقبل «آخر العمليات»', async () => {
    mockPendingIncomes = [{ id: 'i1' }];
    fourRoutine();
    await mount();
    expect(screen.getByText('عندك 4 حاجات محتاجة انتباهك')).toBeTruthy();
    const all = ids('');
    for (const old of ['home_banner_low_w1', 'home_banner_budget_c1', 'home_banner_sub_s1', 'home_banner_verify_email', 'home_banner_no_tx_today']) {
      expect({ old, shown: all.includes(old) }).toEqual({ old, shown: false });
    }
    expect(all.indexOf('home_pending_summary')).toBeGreaterThan(-1);
    expect(all.indexOf('home_pending_summary')).toBeLessThan(all.indexOf('home_attention_line'));
    expect(all.indexOf('home_attention_line')).toBeLessThan(all.indexOf('home_recent_title'));
    // الشيت مقفول لحد ما تدوس
    expect(shown('attention_sheet')).toBe(false);
  });

  it('الدوسة على السطر ← صفوف الشيت بالترتيب: ميزانية ← رصيد ← اشتراك ← إيميل', async () => {
    fourRoutine();
    await mount();
    await openSheet();
    expect(ids('attention_row_')).toEqual(['attention_row_budget_c1', 'attention_row_low_w1', 'attention_row_sub_s1', 'attention_row_verify_email']);
    expect(within(screen.getByTestId('attention_sheet')).getByText('عندك 4 حاجات محتاجة انتباهك')).toBeTruthy();
  });

  it('✕ على صف ← العدد 4 ← 3، والـ✕ اتخزّن بالمفتاح القديم (lowBalance:w1)', async () => {
    fourRoutine();
    await mount();
    await openSheet();
    await press('attention_dismiss_low_w1');
    expect(screen.getAllByText('عندك 3 حاجات محتاجة انتباهك').length).toBeGreaterThan(0);
    expect(shown('attention_row_low_w1')).toBe(false);
    expect(Object.keys(await stored())).toEqual(['lowBalance:w1']);
  });

  it('حاجة اتقفلت قبل كده (subscriptionDue:s1@<معاد> متخزّن) ← مش في العدد ولا في الشيت', async () => {
    await AsyncStorage.setItem(DISMISS_KEY, JSON.stringify({ [`subscriptionDue:s1@${IN2}`]: Date.now() - H }));
    fourRoutine();
    await mount();
    expect(screen.getByText('عندك 3 حاجات محتاجة انتباهك')).toBeTruthy();
    await openSheet();
    expect(shown('attention_row_sub_s1')).toBe(false);
    expect(shown('attention_row_low_w1')).toBe(true);
  });
});

describe('عنصر واحد بس', () => {
  it('نصه هو نفسه في السطر (من غير شيت)، والدوسة بتروح وجهته، والـ✕ شغال', async () => {
    setData({ wallets: [LOW], transactions: [exp('t1', 85)] });
    await mount();
    const line = screen.getByTestId('home_attention_line');
    expect(within(line).getByText('رصيد كاش قرب يخلص (15 ج.م)')).toBeTruthy();
    expect(screen.queryByText(/عندك .* محتاجة انتباهك|عندك حاجة/)).toBeNull();
    expect(shown('attention_sheet')).toBe(false);
    await act(async () => { fireEvent.press(within(line).getAllByLabelText('رصيد كاش قرب يخلص (15 ج.م)')[0]); });
    expect(router.push).toHaveBeenCalledWith('/settings-screens/wallets');
    expect(shown('attention_sheet')).toBe(false);
    await press('attention_dismiss_low_w1');
    expect(shown('home_attention_line')).toBe(false);
    expect(Object.keys(await stored())).toEqual(['lowBalance:w1']);
  });

  it('«لسه ما سجلتش»: نصه في السطر من غير وجهة (مفيش زرار بيفتح حاجة)', async () => {
    setData({ transactions: [] });
    await mount();
    expect(within(screen.getByTestId('home_attention_line')).getByText('لسه ما سجلتش مصاريف النهاردة')).toBeTruthy();
    await press('attention_dismiss_no_tx_today');
    expect(shown('home_attention_line')).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('الإيميل هو الوحيد ← السطر العام «عندك حاجة محتاجة انتباهك» والشيت فيه زرار إعادة الإرسال وسطر الـSpam', async () => {
    mockUser.emailVerified = false;
    await mount();
    expect(within(screen.getByTestId('home_attention_line')).getByText('عندك حاجة محتاجة انتباهك')).toBeTruthy();
    expect(screen.getByTestId('home_attention_line').props.accessibilityHint).toBe('بيفتح الحاجات اللي محتاجة انتباهك');
    await openSheet();
    expect(screen.getByTestId('verify_spam_hint').props.children).toBe(VERIFY_SPAM_HINT);
    await press('attention_verify_resend');
    expect(mockResend).toHaveBeenCalledTimes(1);
    expect(screen.getByText('بعتنالك رسالة تأكيد جديدة، شوف إيميلك')).toBeTruthy();
    // بعد "اتبعتت" الزرار بيروح والنصيحة فاضلة
    expect(shown('attention_verify_resend')).toBe(false);
    expect(shown('verify_spam_hint')).toBe(true);
  });

  it('إعادة الإرسال فشلت ← الرسالة والزرار فاضل (زي ما كان)', async () => {
    mockUser.emailVerified = false;
    mockResend.mockRejectedValueOnce(new Error('x'));
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    await mount();
    await openSheet();
    await press('attention_verify_resend');
    expect(screen.getByText('مقدرناش نبعت الرسالة دلوقتي، جرب كمان شوية')).toBeTruthy();
    expect(shown('attention_verify_resend')).toBe(true);
    err.mockRestore();
  });
});

describe('الميزانية الإجمالية', () => {
  it('خلصت ← مفيش بانر ولا سطر (N = 0)، وكارت الشهر هو اللي بيقول «الميزانية خلصت»', async () => {
    setData({ transactions: [exp('t1', 1000)], budgets: { total_budget: 1000 } });
    await mount();
    expect(shown('home_banner_budget_total')).toBe(false);
    expect(shown('home_attention_line')).toBe(false);
    expect(within(screen.getByTestId('home_month_card')).getByText('الميزانية خلصت')).toBeTruthy();
  });
});

describe('الطبقات التانية ما اتلخبطتش', () => {
  it('class A (مفيش نت) + «مستنيين ردك» + 3 روتيني ← التلاتة ظاهرين، والشيت مفيهوش نص class A', async () => {
    mockUser.emailVerified = false;
    mockPendingIncomes = [{ id: 'i1' }];
    setData({
      wallets: [], serverReachable: false, categories: [CAT], budgets: { c1: 100 }, transactions: [exp('t1', 85, TODAY, 'c1')], subscriptions: [SUB],
    });
    await mount();
    expect(shown('home_banner_offline')).toBe(true);
    expect(shown('home_pending_summary')).toBe(true);
    expect(screen.getByText('عندك 3 حاجات محتاجة انتباهك')).toBeTruthy();
    await openSheet();
    const sheet = within(screen.getByTestId('attention_sheet'));
    expect(sheet.queryByText(/مفيش نت دلوقتي/)).toBeNull();
    expect(ids('attention_row_')).toEqual(['attention_row_budget_c1', 'attention_row_sub_s1', 'attention_row_verify_email']);
    expect(ids('attention_').some(i => /offline|stale|cold|broken|delete/.test(i))).toBe(false);
  });

  it('ثلاث class A مع بعض (مسح ما خلصش + عملية بايظة + محفظة بايظة) ← التلاتة بنصهم كامل، من غير سطر انتباه', async () => {
    setData({
      deletionPending: true,
      brokenTransactions: [{ id: 'b1', reasons: ['amount'] }],
      wallets: [{ id: 'w1', name: 'كاش', openingBalance: 100, lowAlert: 0, openingInvalid: true }],
    });
    await mount();
    for (const id of ['home_banner_delete_pending', 'home_banner_broken_tx', 'home_banner_broken_wallet_w1']) expect(shown(id)).toBe(true);
    expect(screen.getByText(/مسح حسابك ما خلصش/)).toBeTruthy();
    expect(screen.getByText('فيه عملية واحدة بياناتها ناقصة ومش محسوبة في أي رقم.')).toBeTruthy();
    expect(shown('home_attention_line')).toBe(false);
  });

  it('اشتراك بعد يومين ← في السطر ودوسته بتروح الالتزامات', async () => {
    setData({ subscriptions: [SUB] });
    await mount();
    expect(within(screen.getByTestId('home_attention_line')).getByText('اشتراك نتفليكس بعد 2 يوم (100 ج.م)')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(within(screen.getByTestId('home_attention_line')).getAllByLabelText('اشتراك نتفليكس بعد 2 يوم (100 ج.م)')[0]); });
    expect(router.push).toHaveBeenCalledWith('/(tabs)/debts');
  });

  it('اشتراك معاده النهارده ← مش عنصر (بيروح كارت «اتخصم؟» وسطر «مستنيين ردك»)', async () => {
    mockPendingCharges = [{ kind: 'subscription', id: 's1' }]; // كارت اللي معاده النهارده (الكروت نفسها متمثّلة هنا)
    setData({ subscriptions: [{ ...SUB, nextDueDate: TODAY }] });
    await mount();
    expect(shown('home_attention_line')).toBe(false);
    expect(screen.getByText('عندك حاجة مستنية ردك')).toBeTruthy();
  });
});

describe('المبالغ مخفية (العين مقفولة)', () => {
  it('رصيد + ميزانية + اشتراك ← مبالغهم مخفية في الشيت زي ما كانت في البانر، وقارئ الشاشة بيقول «مبلغ مخفي»', async () => {
    await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, '1');
    setData({
      wallets: [LOW], categories: [CAT], budgets: { c1: 100 }, transactions: [exp('t1', 85, TODAY, 'c1')], subscriptions: [SUB],
    });
    await mount();
    await openSheet();
    const sheet = within(screen.getByTestId('attention_sheet'));
    expect(sheet.getByText(`ميزانية أكل قربت تخلص (${MONEY_MASK}/${MONEY_MASK})`)).toBeTruthy();
    expect(sheet.getByText(`رصيد كاش قرب يخلص (${MONEY_MASK} ج.م)`)).toBeTruthy();
    expect(sheet.getByText(`اشتراك نتفليكس بعد 2 يوم (${MONEY_MASK} ج.م)`)).toBeTruthy();
    expect(sheet.queryByText(/85|15 ج|\b100\b/)).toBeNull();
    expect(sheet.getAllByLabelText('رصيد كاش قرب يخلص (مبلغ مخفي ج.م)').length).toBeGreaterThan(0);
    expect(sheet.getAllByLabelText('ميزانية أكل قربت تخلص (مبلغ مخفي من مبلغ مخفي)').length).toBeGreaterThan(0);
  });
});

describe('إعلان قارئ الشاشة', () => {
  it('مش في أول فتحة، ولما العدد يزيد بعد مهلة التحميل بيتقال مرة', async () => {
    const { AccessibilityInfo } = jest.requireActual('react-native');
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const said = () => spy.mock.calls.map(c => c[0]).filter(t => /محتاجة انتباهك|محتاجين انتباهك/.test(String(t)));
    setData({ wallets: [LOW], transactions: [exp('t1', 85)] });
    const r = await mount();
    expect(said()).toEqual([]);
    setData({ wallets: [LOW], transactions: [exp('t1', 85)], subscriptions: [SUB] });
    await r.rerender(ui());
    expect(said()).toEqual(['عندك حاجتين محتاجين انتباهك']);
    await advance(1000);
    expect(said()).toHaveLength(1);
    spy.mockRestore();
  });
});

describe('الشيت بيتقفل لما العدد يوصل صفر', () => {
  it('آخر ✕ ← السطر والشيت يختفوا', async () => {
    setData({ wallets: [LOW], transactions: [exp('t1', 85)], subscriptions: [SUB] });
    await mount();
    await openSheet();
    await press('attention_dismiss_low_w1');
    await press('attention_dismiss_sub_s1');
    expect(shown('attention_sheet')).toBe(false);
    expect(shown('home_attention_line')).toBe(false);
  });
});

/**
 * جرد: كل بانر قديم من صفوف 10–17 (الإيميل، لسه ما سجلتش، رصيد قرب يخلص، ميزانية فئة، اشتراك، جمعية + سطر «التحويلات فشلت»)
 * لسه موجود في الهيكل الجديد بنفس النص ومفتاح الـ✕ (والوجهة القديمة للاشتراك والجمعية؛ الرصيد والميزانية وجهتهم جديدة). النصوص دي مكتوبة بإيد من JSX الرئيسية القديم (مش من الكود الجديد).
 */
describe('جرد البانرات اللي اتلمّت', () => {
  const TEXT = {
    budget: 'ميزانية أكل قربت تخلص (85/100)',
    low: 'رصيد كاش قرب يخلص (15 ج.م)',
    sub: 'اشتراك نتفليكس بعد 2 يوم (100 ج.م)',
    gamiya: 'جمعية العيلة — القسط بعد 2 يوم (500 ج.م)',
    verify: 'إيميلك (a@b.c) لسه مش مأكّد — أكّده عشان تأمّن حسابك',
  };
  const ROWS: { row: string; type: 'budget' | 'lowBalance' | 'subscriptionDue' | 'gamiyaDue' | 'verifyEmail' | 'noTxToday'; name?: string; key: string; route?: string; label: string }[] = [
    { row: 'budget_c1', type: 'budget', name: 'أكل', key: 'budget:c1:near', route: '/(tabs)/planning', label: 'ميزانية أكل قربت تخلص (85 من 100)' },
    { row: 'low_w1', type: 'lowBalance', name: 'كاش', key: 'lowBalance:w1', route: '/settings-screens/wallets', label: TEXT.low },
    { row: 'gamiya_m2', type: 'gamiyaDue', name: 'العيلة', key: 'gamiyaDue:m2', route: '/(tabs)/debts', label: TEXT.gamiya },
    { row: 'sub_s1', type: 'subscriptionDue', name: 'نتفليكس', key: `subscriptionDue:s1@${IN2}`, route: '/(tabs)/debts', label: TEXT.sub },
    { row: 'verify_email', type: 'verifyEmail', key: 'verifyEmail', label: TEXT.verify },
    { row: 'no_tx_today', type: 'noTxToday', key: 'noTxToday', label: 'لسه ما سجلتش مصاريف النهاردة' },
  ];
  function allSix() {
    mockUser.emailVerified = false;
    setData({
      wallets: [LOW], categories: [CAT], budgets: { c1: 100 },
      // عملية قديمة في نفس الشهر (مش النهارده) عشان «لسه ما سجلتش» يظهر
      transactions: [exp('t1', 85, '2026-11-02', 'c1')], subscriptions: [SUB], gamiyas: [GAM], transfersStatus: 'failed',
    });
  }

  it('الستة موجودين في الشيت بنصهم القديم بالحرف، بالترتيب، وكل واحد بـ✕ بنفس الاسم القديم', async () => {
    allSix();
    await mount();
    expect(screen.getByText('عندك 6 حاجات محتاجة انتباهك')).toBeTruthy();
    await openSheet();
    expect(ids('attention_row_')).toEqual(['budget_c1', 'low_w1', 'sub_s1', 'gamiya_m2', 'verify_email', 'no_tx_today'].map(x => `attention_row_${x}`)); // نفس اليوم: الاشتراك قبل الجمعية (الترتيب الأصلي ثابت)
    const sheet = within(screen.getByTestId('attention_sheet'));
    for (const t of [TEXT.budget, TEXT.low, TEXT.sub, TEXT.gamiya, TEXT.verify, 'لسه ما سجلتش مصاريف النهاردة']) expect(sheet.getByText(t)).toBeTruthy();
    for (const r of ROWS) {
      expect(screen.getByTestId(`attention_dismiss_${r.row}`).props.accessibilityLabel).toBe(dismissLabel(r.type, r.name));
      if (r.route) expect(within(screen.getByTestId(`attention_row_${r.row}`)).getAllByLabelText(r.label).length).toBeGreaterThan(0);
    }
    // صف 15: سطر «التحويلات فشلت» تحت صفوف الميزانية في الشيت
    expect(shown('home_budget_transfers_failed')).toBe(true);
  });

  it('كل ✕ بيخزّن المفتاح القديم بالظبط، وكلهم بيرجعوا بعد 24 ساعة (الافتراضي)', async () => {
    allSix();
    await mount();
    await openSheet();
    for (const r of ROWS) await press(`attention_dismiss_${r.row}`);
    expect(Object.keys(await stored()).sort()).toEqual(ROWS.map(r => r.key).sort());
    expect(shown('home_attention_line')).toBe(false);
    // سطر التحويلات اتشال مع آخر صف ميزانية (مفيش حاجة ظاهرة)
    expect(shown('home_budget_transfers_failed')).toBe(false);
    await advance(24 * H);
    expect(screen.getByText('عندك 6 حاجات محتاجة انتباهك')).toBeTruthy();
  });

  it('الدوسة على كل صف ليه وجهة ← بتقفل الشيت وبتروح لوجهتها: الاشتراك والجمعية لوجهتهم القديمة (الديون)، والرصيد (المحافظ) والميزانية (التخطيط) وجهة جديدة', async () => {
    allSix();
    await mount();
    for (const r of ROWS.filter(x => x.route)) {
      (router.push as jest.Mock).mockClear();
      if (!shown('attention_sheet')) await openSheet();
      const target = within(screen.getByTestId(`attention_row_${r.row}`)).getAllByLabelText(r.label)[0];
      await act(async () => { fireEvent.press(target); });
      expect(router.push).toHaveBeenCalledWith(r.route);
      expect({ row: r.row, sheetOpen: shown('attention_sheet') }).toEqual({ row: r.row, sheetOpen: false });
    }
  });

  it('صف الإيميل: الجسم القديم كله جوه الصف (زرار إعادة الإرسال + سطر الـSpam)', async () => {
    allSix();
    await mount();
    await openSheet();
    const row = within(screen.getByTestId('attention_row_verify_email'));
    expect(row.getByText('أعد إرسال رسالة التأكيد')).toBeTruthy();
    expect(row.getByText(VERIFY_SPAM_HINT)).toBeTruthy();
  });
});

/** جرد المصدر: اللي اتلمّ مبقاش بانر في index.tsx، والتسجيل التلقائي لسه متركّب */
describe('جرد المصدر', () => {
  const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
  const home = read('app', '(tabs)', 'index.tsx');
  it('index.tsx مفيهوش home_banner_(low|budget|sub|gamiya|no_tx_today|verify_email)', () => {
    expect(home).not.toMatch(/home_banner_(low|budget|sub|gamiya|no_tx_today|verify_email)/);
  });
  it('لسه بيركّب <IncomeAutoNotices /> و<ChargeAutoNotices /> (هما اللي بيشغّلوا التسجيل التلقائي)', () => {
    expect(home).toContain('<IncomeAutoNotices />');
    expect(home).toContain('<ChargeAutoNotices />');
  });
  it('الشيت مش بيستورد class A ولا «ما سجلناش»، وسطر «مستنيين ردك» ما اتلمسش', () => {
    const sheet = read('components', 'AttentionSheet.tsx');
    expect(sheet).not.toMatch(/IncomeHomeCards|ChargeHomeCards|DataLoadErrorBanner|staleFigures|brokenDocs|coldCache/);
    expect(home).toContain('<PendingSummary />');
  });
});

/** شرح الدوسة لقارئ الشاشة: وجهة واحدة = جملة واحدة، في السطر الفردي وفي صفوف الشيت */
describe('accessibilityHint للصفوف اللي بتتداس', () => {
  it('السطر الفردي (رصيد) ← «بيفتح المحافظ»', async () => {
    setData({ wallets: [LOW], transactions: [exp('t1', 85)] });
    await mount();
    const btn = within(screen.getByTestId('home_attention_line')).getAllByLabelText('رصيد كاش قرب يخلص (15 ج.م)')[0];
    expect(btn.props.accessibilityHint).toBe('بيفتح المحافظ');
  });

  it('صفوف الشيت: ميزانية ← التخطيط، رصيد ← المحافظ، اشتراك ← الديون، والإيميل من غير شرح', async () => {
    fourRoutine();
    await mount();
    await openSheet();
    const hintOf = (row: string) => {
      const r = within(screen.getByTestId(`attention_row_${row}`));
      return r.getAllByRole('button').find(b => b.props.accessibilityLabel && !/^اقفل/.test(b.props.accessibilityLabel))?.props.accessibilityHint;
    };
    expect(hintOf('budget_c1')).toBe('بيفتح الميزانية');
    expect(hintOf('low_w1')).toBe('بيفتح المحافظ');
    expect(hintOf('sub_s1')).toBe('بيفتح الديون والاشتراكات والجمعية');
    expect(within(screen.getByTestId('attention_row_verify_email')).queryAllByRole('button').some(b => b.props.accessibilityHint === 'بيفتح الديون والاشتراكات والجمعية')).toBe(false);
  });

  it('جمعية ← نفس شرح الديون', async () => {
    setData({ gamiyas: [GAM] });
    await mount();
    const btn = within(screen.getByTestId('home_attention_line')).getAllByRole('button').find(b => /جمعية/.test(b.props.accessibilityLabel ?? ''));
    expect(btn?.props.accessibilityHint).toBe('بيفتح الديون والاشتراكات والجمعية');
  });
});
