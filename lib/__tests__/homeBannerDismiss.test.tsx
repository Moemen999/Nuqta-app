import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import HomeTab from '@/app/(tabs)/index';
import DataLoadErrorBanner from '@/components/DataLoadErrorBanner';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { DISMISS_KEY, INTERVALS_KEY, resetBannerDismissForTests, setBannerInterval } from '@/lib/useBannerDismiss';

/**
 * الـ✕ على بانرات الرئيسية (قرار مؤمن 2026-10-28): بيخبّي البانر ده بس، بيرجع بعد
 * المدة اللي المستخدم اختارها بالظبط، والبانر اللي حالته خلصت مبيرجعش، والقفل
 * والمدة متحفوظين على الجهاز (بيعيشوا بعد إعادة التشغيل).
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

const H = 3_600_000;
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function setData(over: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    // محفظتين تحت حد التنبيه ← بانرين "قرب يخلص" (مفاتيح لكل محفظة)
    wallets: [
      { id: 'w1', name: 'كاش', openingBalance: 100, lowAlert: 500 },
      { id: 'w2', name: 'البنك', openingBalance: 100, lowAlert: 500 },
    ],
    categories: [], transactions: [], budgets: {}, subscriptions: [], gamiyas: [], incomes: [], debts: [],
    pendingTxIds: new Set(), serverReachable: true, setupStatus: 'done', loadErrors: [], retryLoad: jest.fn(),
    ...over,
  });
}

/** الساعة 9 م من غير ما التاريخ يتغيّر — بعد ساعة التذكير الافتراضية (8 م) */
function at9pm() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 21, 0, 0);
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(at9pm());
  resetBannerDismissForTests();
  await AsyncStorage.clear();
  setData();
});
afterEach(() => { resetBannerDismissForTests(); jest.useRealTimers(); });

async function mount() {
  const r = await render(<ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>);
  await act(async () => { jest.advanceTimersByTime(3000); });
  return r;
}
const advance = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const shown = (id: string) => screen.queryByTestId(id) !== null;

describe('الـ✕', () => {
  it('بيخبّي البانر ده بس — المحفظة التانية فاضلة', async () => {
    await mount();
    expect(shown('home_banner_low_w1') && shown('home_banner_low_w2')).toBe(true);
    await act(async () => { fireEvent.press(screen.getByTestId('home_banner_dismiss_low_balance_w1')); });
    expect(shown('home_banner_low_w1')).toBe(false);
    expect(shown('home_banner_low_w2')).toBe(true);
  });

  it('بيرجع لوحده بعد المدة بالظبط (الافتراضي يوم للروتيني) — مش قبلها', async () => {
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('home_banner_dismiss_low_balance_w1')); });
    await advance(24 * H - 1000);
    expect(shown('home_banner_low_w1')).toBe(false);
    await advance(1000);
    expect(shown('home_banner_low_w1')).toBe(true);
  });

  it('المدة اللي المستخدم اختارها هي اللي بتتطبق (ساعة)', async () => {
    await act(async () => { setBannerInterval('lowBalance', '1h'); });
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('home_banner_dismiss_low_balance_w1')); });
    await advance(H - 1000);
    expect(shown('home_banner_low_w1')).toBe(false);
    await advance(1000);
    expect(shown('home_banner_low_w1')).toBe(true);
  });

  it('الحالة خلصت ← البانر مبيرجعش بعد المدة', async () => {
    const r = await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('home_banner_dismiss_low_balance_w1')); });
    // الرصيد اتظبط (فوق حد التنبيه)
    setData({ wallets: [{ id: 'w1', name: 'كاش', openingBalance: 9000, lowAlert: 500 }] });
    await advance(25 * H);
    await r.rerender(<ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>);
    expect(shown('home_banner_low_w1')).toBe(false);
  });

  it('"مفيش نت" (تحذير) ليه ✕ وبيرجع بعد ساعة (الافتراضي) لو النت لسه مش موجود', async () => {
    setData({ wallets: [], serverReachable: false });
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('home_banner_dismiss_offline')); });
    expect(shown('home_banner_offline')).toBe(false);
    await advance(H);
    expect(shown('home_banner_offline')).toBe(true);
  });
});

describe('الحفظ على الجهاز', () => {
  it('الـ✕ والمدة بيتكتبوا في التخزين', async () => {
    await act(async () => { setBannerInterval('lowBalance', '7d'); });
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('home_banner_dismiss_low_balance_w1')); });
    expect(JSON.parse((await AsyncStorage.getItem(DISMISS_KEY))!)).toHaveProperty(['lowBalance:w1']);
    expect(JSON.parse((await AsyncStorage.getItem(INTERVALS_KEY))!)).toEqual({ lowBalance: '7d' });
  });

  it('فتحة جديدة للتطبيق (الذاكرة فاضية، التخزين فيه قفل من 3 أيام بمدة أسبوع) ← لسه مقفول', async () => {
    await AsyncStorage.setItem(DISMISS_KEY, JSON.stringify({ 'lowBalance:w1': Date.now() - 3 * 24 * H }));
    await AsyncStorage.setItem(INTERVALS_KEY, JSON.stringify({ lowBalance: '7d' }));
    await mount();
    expect(shown('home_banner_low_w1')).toBe(false);
    expect(shown('home_banner_low_w2')).toBe(true);
  });

  it('فتحة جديدة والمدة خلصت (قفل من 8 أيام بمدة أسبوع) ← ظاهر', async () => {
    await AsyncStorage.setItem(DISMISS_KEY, JSON.stringify({ 'lowBalance:w1': Date.now() - 8 * 24 * H }));
    await AsyncStorage.setItem(INTERVALS_KEY, JSON.stringify({ lowBalance: '7d' }));
    await mount();
    expect(shown('home_banner_low_w1')).toBe(true);
  });

  it('التخزين بايظ ← البانر بيظهر (الأأمن)', async () => {
    await AsyncStorage.setItem(DISMISS_KEY, '{bad json');
    await mount();
    expect(shown('home_banner_low_w1')).toBe(true);
  });
});

describe('"لسه ما سجلتش النهاردة" بساعة التذكير (الافتراضي 8 م)', () => {
  const noTx = () => setData({ wallets: [{ id: 'w1', name: 'كاش', openingBalance: 9000, lowAlert: 0 }], transactions: [] });
  it('7:59 م ← مش ظاهر، و8 م ← ظاهر لوحده من غير ما الشاشة تتفتح تاني', async () => {
    const n = new Date();
    jest.setSystemTime(new Date(n.getFullYear(), n.getMonth(), n.getDate(), 19, 59, 0));
    noTx();
    await mount();
    expect(shown('home_banner_no_tx_today')).toBe(false);
    await advance(60_000);
    expect(shown('home_banner_no_tx_today')).toBe(true);
  });
  it('فيه عملية النهاردة ← مش ظاهر حتى بعد الساعة', async () => {
    setData({ wallets: [{ id: 'w1', name: 'كاش', openingBalance: 9000, lowAlert: 0 }],
      transactions: [{ id: 't', type: 'expense', amount: 5, walletId: 'w1', date: day(at9pm()) }] });
    await mount();
    expect(shown('home_banner_no_tx_today')).toBe(false);
  });
});

describe('بانر "مقدرناش نجيب بياناتك" (فوق كل التابات)', () => {
  it('ليه ✕، وبيرجع بعد ساعة لو الحالة لسه موجودة', async () => {
    setData({ loadErrors: ['wallets'] });
    await render(<ThemeProvider><DataLoadErrorBanner /></ThemeProvider>);
    await act(async () => {});
    expect(shown('data_load_error_banner')).toBe(true);
    await act(async () => { fireEvent.press(screen.getByTestId('data_load_error_dismiss')); });
    expect(shown('data_load_error_banner')).toBe(false);
    await advance(H);
    expect(shown('data_load_error_banner')).toBe(true);
  });
});

/**
 * a11y-architect (BLOCKER): الـ✕ مينفعش يبقى جوه عنصر قابل للمس — قارئ الشاشة بيدمج
 * الأب وولاده في عنصر واحد فالـ✕ مبيتوصلش. الـ✕ لازم يبقى أخ للجزء اللي بيتداس.
 */
describe('الـ✕ مش جوه زرار تاني', () => {
  it('بانر الاشتراك والجمعية', async () => {
    const soon = new Date(Date.now() + 2 * 86400000);
    const iso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    setData({
      subscriptions: [{ id: 's1', name: 'نتفليكس', amount: 100, walletId: 'w1', active: true, nextDueDate: iso, reminderDaysBefore: 3 }],
      gamiyas: [{ id: 'g1', name: 'العيلة', walletId: 'w1', reminderDaysBefore: 3,
        months: [{ id: 'm2', monthIndex: 2, dueDate: iso, isPayoutMonth: false, amount: 500, status: 'pending' }] }],
    });
    await mount();
    for (const id of ['home_banner_dismiss_sub_s1', 'home_banner_dismiss_gamiya_m2']) {
      let p = screen.getByTestId(id).parent;
      const pressableAncestors: string[] = [];
      while (p) {
        if (p.props?.accessible === true || typeof p.props?.onClick === 'function') pressableAncestors.push(p.props?.testID ?? '?');
        p = p.parent;
      }
      expect({ id, pressableAncestors }).toEqual({ id, pressableAncestors: [] });
    }
  });
});

/** a11y-architect: كل ✕ اسمه بيقول أنهي تنبيه، وبعد الدوسة بيتقال إنه اتقفل وهيرجع */
describe('اسم الـ✕ وإعلانه', () => {
  it('محفظتين ← اسمين مختلفين فيهم اسم المحفظة', async () => {
    await mount();
    const a = screen.getByTestId('home_banner_dismiss_low_balance_w1').props.accessibilityLabel;
    const b = screen.getByTestId('home_banner_dismiss_low_balance_w2').props.accessibilityLabel;
    expect(a).not.toBe(b);
    expect(a).toContain('كاش');
    expect(b).toContain('البنك');
  });
  it('الدوسة بتعلن إنه اتقفل وهيرجع', async () => {
    const { AccessibilityInfo } = jest.requireActual('react-native');
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('home_banner_dismiss_low_balance_w1')); });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('اتقفل التنبيه'));
    spy.mockRestore();
  });
});

/** react-reviewer: ✕ أو مدة قبل ما التخزين يتقري متمسحش اللي كان متخزّن */
it('✕ قبل القراية ← القديم والجديد الاتنين في التخزين', async () => {
  await AsyncStorage.setItem(DISMISS_KEY, JSON.stringify({ 'lowBalance:w2': Date.now() - H }));
  await AsyncStorage.setItem(INTERVALS_KEY, JSON.stringify({ offline: '15m' }));
  const { dismissBanner } = jest.requireActual('@/lib/useBannerDismiss');
  await act(async () => { dismissBanner('lowBalance', 'w1'); setBannerInterval('stale', '3h'); });
  const d = JSON.parse((await AsyncStorage.getItem(DISMISS_KEY))!);
  expect(Object.keys(d).sort()).toEqual(['lowBalance:w1', 'lowBalance:w2']);
  expect(JSON.parse((await AsyncStorage.getItem(INTERVALS_KEY))!)).toEqual({ offline: '15m', stale: '3h' });
});

/** react-reviewer: قبل ما ساعة التذكير تتقري البانر مبيظهرش بالافتراضي (8 م) */
describe('"لسه ما سجلتش" قبل ما الإعداد يتقري', () => {
  const { NotificationsContext } = jest.requireActual('@/context/NotificationsContext');
  const wrapWith = (value: object) => (
    <NotificationsContext.Provider value={value}><ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider></NotificationsContext.Provider>
  );
  const base = { enabled: false, dailyEnabled: true, enableNotifications: jest.fn(), disableNotifications: jest.fn(),
    setDailyEnabled: jest.fn(), setDailyHour: jest.fn(), refreshPermission: jest.fn() };
  const noTx = () => setData({ wallets: [{ id: 'w1', name: 'كاش', openingBalance: 9000, lowAlert: 0 }], transactions: [] });
  it('لسه بيتقري (الساعة 9 م) ← مش ظاهر', async () => {
    noTx();
    await render(wrapWith({ ...base, loading: true, dailyHour: 20 }));
    await advance(3000);
    expect(shown('home_banner_no_tx_today')).toBe(false);
  });
  it('اتقري واختار 10 م ← مش ظاهر الساعة 9؛ واختار 8 م ← ظاهر', async () => {
    noTx();
    const r = await render(wrapWith({ ...base, loading: false, dailyHour: 22 }));
    await advance(3000);
    expect(shown('home_banner_no_tx_today')).toBe(false);
    await r.rerender(wrapWith({ ...base, loading: false, dailyHour: 20 }));
    expect(shown('home_banner_no_tx_today')).toBe(true);
  });
});

/** silent-failure-hunter: المؤقّت اشتغل بدري والساعة زي ما هي ← بيتعاد ومبيقفش */
it('الساعة اترجعت لورا والمؤقّت اشتغل بدري ← البانر لسه بيظهر الساعة 8', async () => {
  const n = new Date();
  jest.setSystemTime(new Date(n.getFullYear(), n.getMonth(), n.getDate(), 19, 59, 0));
  setData({ wallets: [{ id: 'w1', name: 'كاش', openingBalance: 9000, lowAlert: 0 }], transactions: [] });
  await mount(); // الساعة بقت 19:59:03، والمؤقّت على 20:00
  jest.setSystemTime(new Date(n.getFullYear(), n.getMonth(), n.getDate(), 19, 58, 0));
  await advance(57_000); // المؤقّت بيشتغل والساعة 19:58:57 — لسه 7
  expect(shown('home_banner_no_tx_today')).toBe(false);
  await advance(64_000); // 20:00:01
  expect(shown('home_banner_no_tx_today')).toBe(true);
});

/** silent-failure-hunter: انقطاع جديد بعد ما الأول خلص بيظهر حتى جوه المدة */
describe('تحذيرات الأرقام: الحالة خلصت ← القفل اتشال', () => {
  const ui = () => <ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>;
  it('مفيش نت ← ✕ ← النت رجع ← قطع تاني بعد 10 دقايق ← البانر ظاهر', async () => {
    setData({ wallets: [], serverReachable: false });
    const r = await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('home_banner_dismiss_offline')); });
    setData({ wallets: [], serverReachable: true });
    await r.rerender(ui());
    await advance(5 * 60_000);
    setData({ wallets: [], serverReachable: false });
    await r.rerender(ui());
    await advance(5 * 60_000);
    expect(shown('home_banner_offline')).toBe(true);
  });
  it('مقدرناش نجيب بياناتك: listener تاني وقع بعد الـ✕ ← البانر ظاهر', async () => {
    setData({ loadErrors: ['wallets'] });
    const r = await render(<ThemeProvider><DataLoadErrorBanner /></ThemeProvider>);
    await act(async () => {});
    await act(async () => { fireEvent.press(screen.getByTestId('data_load_error_dismiss')); });
    expect(shown('data_load_error_banner')).toBe(false);
    setData({ loadErrors: ['wallets', 'debts'] });
    await r.rerender(<ThemeProvider><DataLoadErrorBanner /></ThemeProvider>);
    expect(shown('data_load_error_banner')).toBe(true);
  });
});

/** silent-failure-hunter: ✕ على "قربت تخلص" ميخبّيش "خلصت" */
it('ميزانية: ✕ على "قربت تخلص" ← الصرف عدّى الحد ← البانر ظاهر', async () => {
  const today = day(at9pm());
  const tx = (id: string, amount: number) => ({ id, type: 'expense', amount, walletId: 'w1', categoryId: 'c1', date: today });
  const data = (txs: object[]) => setData({ wallets: [{ id: 'w1', name: 'كاش', openingBalance: 9000, lowAlert: 0 }],
    categories: [{ id: 'c1', name: 'أكل' }], budgets: { c1: 100 }, transactions: txs });
  data([tx('a', 85)]);
  const r = await mount();
  await act(async () => { fireEvent.press(screen.getByTestId('home_banner_dismiss_budget_c1')); });
  expect(shown('home_banner_budget_c1')).toBe(false);
  data([tx('a', 85), tx('b', 30)]);
  await r.rerender(<ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>);
  expect(shown('home_banner_budget_c1')).toBe(true);
});

/** silent-failure-hunter (BLOCKER، الجولة التانية): المسح بالنوع كان مبيلمسش مفتاح "loadError:<أسامي>" */
it('مقدرناش نجيب بياناتك: ✕ ← كله رجع ← نفس الـlistener وقع تاني جوه الساعة ← البانر ظاهر', async () => {
  setData({ loadErrors: ['wallets'] });
  const r = await render(<ThemeProvider><DataLoadErrorBanner /></ThemeProvider>);
  await act(async () => {});
  await act(async () => { fireEvent.press(screen.getByTestId('data_load_error_dismiss')); });
  setData({ loadErrors: [] });
  await r.rerender(<ThemeProvider><DataLoadErrorBanner /></ThemeProvider>);
  await advance(60_000);
  setData({ loadErrors: ['wallets'] });
  await r.rerender(<ThemeProvider><DataLoadErrorBanner /></ThemeProvider>);
  await advance(10);
  expect(shown('data_load_error_banner')).toBe(true);
});
