import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, render, screen } from '@testing-library/react-native';
import HomeTab from '@/app/(tabs)/index';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { todayStr } from '@/lib/finance';

/**
 * ترتيب بانرات الرئيسية — **قرار مؤمن 2026-11-13، بيعدّل 2026-10-28** (اللي كان: "كل البانرات فوق، كل واحد بـ✕"):
 * - بانر لوحده بس لـ(1) "الأرقام ممكن تكون غلط" (مفيش نت، كاش قديم، الأرقام قديمة، مسح ما خلصش، عملية/محفظة بايظة،
 *   "ما سجلناش"، "مقدرناش نجيب بياناتك") و(2) سطر "مستنيين ردك". كلهم **قبل** "آخر العمليات".
 * - الباقي (تأكيد الإيميل، "لسه ما سجلتش"، رصيد قرب يخلص، ميزانية فئة، اشتراك وجمعية جايين) **سطر واحد**
 *   `home_attention_line` بعد سطر "مستنيين ردك" وقبل "آخر العمليات" — وجرد كل واحد منهم في homeAttentionScreen.test.tsx.
 *   بانر الميزانية الإجمالية اتشال (كارت الشهر).
 * - آخر العمليات لسه 10 صفوف.
 * - ولا واحد منهم في عدّاد "مستنيين ردك".
 * - كل بانر ليه ✕ ما عدا اللي قرار مؤمن إنه من غير (جرد من الكود نفسه تحت).
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
    budgets: {}, subscriptions: [], gamiyas: [], incomes: [], debts: [], brokenTransactions: [], pendingTxIds: new Set(),
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
    const stack = layout.indexOf('<Stack ');
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(stack);
  });
});

describe('الباقي: سطر واحد فوق آخر العمليات (2026-11-13، بدل بانر لكل واحد)', () => {
  const OLD_ROUTINE_IDS = ['home_banner_verify_email', 'home_banner_no_tx_today', 'home_banner_gamiya_m2',
    'home_banner_low_w1', 'home_banner_budget_c1', 'home_banner_sub_s1', 'home_banner_budget_total'];

  it('تأكيد الإيميل، "لسه ما سجلتش"، والجمعية الجاية ← سطر واحد قبل "آخر العمليات" وقبل أول عملية، ومفيش بانراتهم القديمة', async () => {
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
    expect(pos('home_attention_line')).toBeLessThan(title);
    expect(screen.getByText('عندك 3 حاجات محتاجة انتباهك')).toBeTruthy();
    for (const id of OLD_ROUTINE_IDS) expect({ id, shown: order().includes(id) }).toEqual({ id, shown: false });
  });

  it('بند B: عملية بايظة ومحفظة رصيد بدايتها مش مقروء ← بانرين قبل "آخر العمليات"، بالعدد', async () => {
    setData({
      wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0, openingInvalid: true }],
      brokenTransactions: [{ id: 'b1', reasons: ['amount'] }, { id: 'b2', reasons: ['date'] }],
    });
    await mount();
    const title = pos('home_recent_title');
    for (const id of ['home_banner_broken_tx', 'home_banner_broken_wallet_w1']) {
      expect({ id, before: pos(id) < title }).toEqual({ id, before: true });
    }
    expect(screen.getByText('فيه عمليتين بياناتها ناقصة ومش محسوبة في أي رقم.')).toBeTruthy();
    expect(screen.getByText('رصيد البداية بتاع محفظة "كاش" مش مقروء، فاتحسب بصفر. اكتبه تاني من المحافظ.')).toBeTruthy();
  });

  it('رصيد قرب يخلص + ميزانية + اشتراك جاي ← سطر واحد قبل "آخر العمليات"، ومفيش بانراتهم القديمة', async () => {
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    setData({
      wallets: [{ id: 'w1', name: 'كاش', openingBalance: 100, lowAlert: 500 }],
      categories: [{ id: 'c1', name: 'أكل' }],
      transactions: [{ ...tx, date: today, categoryId: 'c1' }],
      budgets: { c1: 50 },
      subscriptions: [{ id: 's1', name: 'نتفليكس', amount: 100, walletId: 'w1', active: true, nextDueDate: soon, reminderDaysBefore: 3 }],
    });
    await mount();
    expect(pos('home_attention_line')).toBeLessThan(pos('home_recent_title'));
    expect(screen.getByText('عندك 3 حاجات محتاجة انتباهك')).toBeTruthy();
    for (const id of OLD_ROUTINE_IDS) expect({ id, shown: order().includes(id) }).toEqual({ id, shown: false });
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

  // قبل 2026-11-13 كان هنا كمان: budget, budget_total, gamiya, low, no_tx_today, sub, verify_email — بقوا في `AttentionSheet`
  // (جرد كل واحد فيهم في homeAttentionScreen.test.tsx)، فمينفعش يرجعوا بانرات في index.tsx
  it('فيه بانرات أصلاً (الجرد مش فاضي) — class A بس', () => {
    expect(banners.map(b => b.id).sort()).toEqual(
      ['broken_tx', 'broken_wallet', 'cold', 'delete_pending', 'offline', 'stale'].sort());
  });
  it('كلهم مكتوبين قبل "آخر العمليات"', () => {
    for (const b of banners) expect({ id: b.id, before: b.at > -1 && b.at < titleAt }).toEqual({ id: b.id, before: true });
    expect(src.indexOf('<AttentionSheet')).toBeGreaterThan(-1);
    expect(src.indexOf('<AttentionSheet')).toBeLessThan(titleAt);
    expect(src.indexOf('<PendingSummary />')).toBeLessThan(src.indexOf('<AttentionSheet'));
  });
  // **استثناء واحد: `cold`** (كاش أول فتحة): أرقام قديمة على الشاشة، و✕ كان هيسيبها من غير علامة "قديم" (قرار مؤمن
  // على الكاش). **قرار مؤمن 2026-11-03: من غير ✕** — استثناء مقصود من "كل بانر ليه ✕" (2026-10-28)
  // و`delete_pending` (مسح الحساب ما خلصش) كمان من غير ✕ — قرار مؤمن على ترشيح البحث 2026-11-03: حساب نص-ممسوح مش تنبيه عادي
  // و`broken_tx`/`broken_wallet` (بند B، قرار مؤمن 2026-11-06): عملية مش محسوبة أو رصيد بداية اتحسب صفر ← الرصيد اللي فوق
  // ناقص، فمن غير ✕ زي `cold`
  it('كل بانر ليه ✕', () => {
    const dismissIds = new Set([...src.matchAll(/home_banner_dismiss_([a-z_]+)/g)].map(m => m[1].replace(/_$/, '')));
    expect([...dismissIds].sort()).toEqual(['offline', 'stale']);
    // وكل عنصر اتنقل لـ`AttentionSheet` ليه ✕ هناك: صف الشيت والسطر الواحد بيعدّوا على نفس `dismissBtn` (testID `attention_dismiss_<id>`)
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'AttentionSheet.tsx'), 'utf8');
    expect((sheet.match(/attention_dismiss_\${/g) ?? []).length).toBe(2);
    expect((sheet.match(/dismissBtn\(/g) ?? []).length).toBeGreaterThanOrEqual(2); // السطر + الصف
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
