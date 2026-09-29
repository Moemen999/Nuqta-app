import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, render, screen } from '@testing-library/react-native';
import HomeTab from '@/app/(tabs)/index';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { todayStr } from '@/lib/finance';

/**
 * ترتيب بانرات الرئيسية (2026-09-29):
 * - **اللي بيقول إن رقم على الشاشة ممكن يكون غلط** — مفيش نت، "ما سجلناش"
 *   (التسجيل التلقائي فشل) — تحت الرصيد على طول، **قبل** آخر العمليات.
 *   و"مقدرناش نجيب بياناتك" (listener اترفض) أعلى كمان: فوق الـStack كله.
 * - الباقي (تأكيد الإيميل، "لسه ما سجلتش"، الجمعية الجاية، الرصيد اللي قرب
 *   يخلص) **بعد** آخر العمليات.
 * - ولا واحد منهم في عدّاد "مستنيين ردك".
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

describe('الباقي تحت آخر العمليات', () => {
  it('تأكيد الإيميل، "لسه ما سجلتش"، والجمعية الجاية ← بعد آخر عملية', async () => {
    mockVerified = false;
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    setData({
      gamiyas: [{
        id: 'g1', name: 'العيلة', walletId: 'w1', reminderDaysBefore: 3,
        months: [{ id: 'm2', monthIndex: 2, dueDate: soon, isPayoutMonth: true, amount: 2000, status: 'pending' }],
      }],
    });
    await mount();
    const lastTx = pos('home_tx_t1');
    expect(lastTx).toBeGreaterThan(pos('home_recent_title'));
    for (const id of ['home_banner_verify_email', 'home_banner_no_tx_today', 'home_banner_gamiya_m2']) {
      expect({ id, after: pos(id) > lastTx }).toEqual({ id, after: true });
    }
  });

  it('رصيد قرب يخلص ← بعد آخر عملية كمان (مش بيقول إن الرقم غلط)', async () => {
    setData({ wallets: [{ id: 'w1', name: 'كاش', openingBalance: 100, lowAlert: 500 }], transactions: [{ ...tx, date: today }] });
    await mount();
    expect(pos('home_banner_low_w1')).toBeGreaterThan(pos('home_tx_t1'));
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
