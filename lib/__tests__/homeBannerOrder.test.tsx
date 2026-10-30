import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, render, screen } from '@testing-library/react-native';
import HomeTab from '@/app/(tabs)/index';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { todayStr } from '@/lib/finance';

/**
 * ترتيب بانرات الرئيسية — **قرار مؤمن 2026-10-28، رجوع عن 2026-09-29**:
 * - **كل** البانرات **قبل** "آخر العمليات" (مؤمن بطّل ياخد باله منها وهي تحت القايمة).
 * - جوّاهم: اللي بيقول إن رقم ممكن يكون غلط (مفيش نت، "ما سجلناش") الأول، وبعدين
 *   الباقي (تأكيد الإيميل، "لسه ما سجلتش"، الجمعية، الاشتراك، الرصيد، الميزانيات).
 *   و"مقدرناش نجيب بياناتك" (listener اترفض) أعلى كمان: فوق الـStack كله.
 * - آخر العمليات لسه 10 صفوف.
 * - ولا واحد منهم في عدّاد "مستنيين ردك".
 * - كل بانر ليه ✕ (جرد من الكود نفسه تحت).
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
let mockVerified = true;
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'u1', email: 'a@b.c', emailVerified: mockVerified,
      providerData: [{ providerId: 'password' }], reload: async () => {},
    },
    resendVerificationEmail: jest.fn(),
  }),
}));

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

// "ما سجلناش" من غير ما نشغّل التسجيل التلقائي الحقيقي — الكروت نفسها ليها اختباراتها
let mockAutoError = false;
jest.mock('@/components/IncomeHomeCards', () => {
  const { Text: T } = require('react-native');
  return {
    __esModule: true,
    usePendingIncomes: () => [],
    default: () => null,
    IncomeAutoNotices: () => (mockAutoError ? <T testID="income_notice_error">{'ما سجلناش "المرتب"'}</T> : null),
  };
});
jest.mock('@/components/ChargeHomeCards', () => ({
  __esModule: true, usePendingCharges: () => [], default: () => null, ChargeAutoNotices: () => null,
}));

const today = todayStr();
const tx = { id: 't1', type: 'expense', amount: 50, walletId: 'w1', date: '2026-01-02', createdAt: '2026-01-02T08:00:00Z' };

function setData(over: Record<string, unknown>) {
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 1000, lowAlert: 0 }], categories: [], transactions: [tx],
    budgets: {}, subscriptions: [], gamiyas: [], incomes: [], debts: [], pendingTxIds: new Set(),
    serverReachable: true, setupStatus: 'done', loadErrors: [],
    ...over,
  });
}

async function mount() {
  jest.useFakeTimers();
  // "لسه ما سجلتش" بيظهر بعد ساعة التذكير بس (الافتراضي 8 م) — نفس اليوم، الساعة 9 م
  const now = new Date();
  jest.setSystemTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0));
  await render(<ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>);
  // "مفيش نت" بيستنى 2.5 ثانية عشان ميلمعش وإحنا بنحمّل
  await act(async () => { jest.advanceTimersByTime(3000); });
  jest.useRealTimers();
}

/** ترتيب الـtestIDs زي ما بتترسم من فوق لتحت */
function order(): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as { props?: { testID?: string }; children?: unknown };
    if (node.props?.testID) out.push(node.props.testID);
    walk(node.children);
  };
  walk(screen.toJSON());
  return out;
}
const pos = (id: string) => {
  const i = order().findIndex(x => x === id);
  if (i < 0) throw new Error(`${id} مش ظاهر`);
  return i;
};

beforeEach(() => { mockAutoError = false; mockVerified = true; });

describe('بانرات "الرقم ممكن يكون غلط" فوق آخر العمليات', () => {
  it('مفيش نت ← البانر قبل "آخر العمليات"', async () => {
    setData({ wallets: [], serverReachable: false });
    await mount();
    expect(pos('home_banner_offline')).toBeLessThan(pos('home_recent_title'));
  });

  it('"ما سجلناش" (التلقائي فشل) ← قبل "آخر العمليات"', async () => {
    setData({});
    mockAutoError = true;
    await mount();
    expect(pos('income_notice_error')).toBeLessThan(pos('home_recent_title'));
  });

  it('listener اترفض ← البانر في الـlayout الجذري قبل الـStack (فوق الرصيد في كل تاب)', () => {
    const layout = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8');
    const banner = layout.indexOf('<DataLoadErrorBanner />');
    const stack = layout.indexOf('<Stack>');
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(stack);
  });
});

describe('الباقي كمان فوق آخر العمليات (رجوع عن 2026-09-29)', () => {
  it('تأكيد الإيميل، "لسه ما سجلتش"، والجمعية الجاية ← قبل "آخر العمليات" وقبل أول عملية', async () => {
    mockVerified = false;
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    setData({
      gamiyas: [{
        id: 'g1', name: 'العيلة', walletId: 'w1', reminderDaysBefore: 3,
        months: [{ id: 'm2', monthIndex: 2, dueDate: soon, isPayoutMonth: true, amount: 2000, status: 'pending' }],
      }],
    });
    await mount();
    const title = pos('home_recent_title');
    expect(pos('home_tx_t1')).toBeGreaterThan(title);
    for (const id of ['home_banner_verify_email', 'home_banner_no_tx_today', 'home_banner_gamiya_m2']) {
      expect({ id, before: pos(id) < title }).toEqual({ id, before: true });
    }
  });

  it('رصيد قرب يخلص + ميزانية + اشتراك جاي ← كلهم قبل "آخر العمليات"', async () => {
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    setData({
      wallets: [{ id: 'w1', name: 'كاش', openingBalance: 100, lowAlert: 500 }],
      categories: [{ id: 'c1', name: 'أكل' }],
      transactions: [{ ...tx, date: today, categoryId: 'c1' }],
      budgets: { c1: 50 },
      subscriptions: [{ id: 's1', name: 'نتفليكس', amount: 100, walletId: 'w1', active: true, nextDueDate: soon, reminderDaysBefore: 3 }],
    });
    await mount();
    const title = pos('home_recent_title');
    for (const id of ['home_banner_low_w1', 'home_banner_budget_c1', 'home_banner_sub_s1']) {
      expect({ id, before: pos(id) < title }).toEqual({ id, before: true });
    }
  });
});

/**
 * جرد من الكود نفسه (مش قايمة الاختبار بيبنيها لنفسه — tdd-guide): كل `home_banner_`
 * في الرئيسية مكتوب قبل `home_recent_title` وليه ✕ (`home_banner_dismiss_`)، وآخر
 * العمليات لسه 10. ولو حد رجّع بانر تحت القايمة الاختبار ده بيقع.
 */
describe('جرد بانرات الرئيسية في الكود', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
  const titleAt = src.indexOf('testID="home_recent_title"');
  const banners = [...src.matchAll(/testID=\{?[`"]home_banner_(?!dismiss_)([a-z_]+)/gi)].map(m => ({ id: m[1].replace(/_$/, ''), at: m.index! }));

  it('فيه بانرات أصلاً (الجرد مش فاضي)', () => {
    expect(banners.map(b => b.id).sort()).toEqual(
      ['budget', 'budget_total', 'gamiya', 'low', 'no_tx_today', 'offline', 'stale', 'sub', 'verify_email'].sort());
  });
  it('كلهم مكتوبين قبل "آخر العمليات"', () => {
    // بانر الإيميل كومبوننت لوحده تحت في الملف — المهم مكان استخدامه في الشاشة
    const at = (b: { id: string; at: number }) => (b.id === 'verify_email' ? src.indexOf('<EmailVerificationBanner />') : b.at);
    for (const b of banners) expect({ id: b.id, before: at(b) > -1 && at(b) < titleAt }).toEqual({ id: b.id, before: true });
  });
  it('كل بانر ليه ✕', () => {
    const dismissIds = new Set([...src.matchAll(/home_banner_dismiss_([a-z_]+)/g)].map(m => m[1].replace(/_$/, '')));
    expect([...dismissIds].sort()).toEqual(
      ['budget', 'budget_total', 'gamiya', 'low_balance', 'no_tx_today', 'offline', 'stale', 'sub', 'verify_email'].sort());
  });
  it('آخر العمليات لسه 10', () => {
    expect(src).toMatch(/\.slice\(0, 10\);/);
  });
});

describe('ولا بانر منهم في عدّاد "مستنيين ردك"', () => {
  it('مفيش نت + "ما سجلناش" + إيميل + جمعية جاية ومفيش كروت مستنية ← مفيش سطر', async () => {
    mockVerified = false;
    mockAutoError = true;
    setData({ wallets: [], serverReachable: false });
    await mount();
    expect(screen.queryByTestId('home_pending_summary')).toBeNull();
  });
});
