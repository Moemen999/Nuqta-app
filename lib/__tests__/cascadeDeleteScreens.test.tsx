import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import GamiyaView from '@/components/GamiyaView';
import SubscriptionsView from '@/components/SubscriptionsView';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * زرار "حذف" في شاشة الاشتراكات والجمعية:
 * - عملية مربوطة على محفظة مؤرشفة ← رسالة المنع (NoticeProvider)، ومفيش تأكيد
 *   ولا نداء للمسح خالص
 * - كل العمليات على محفظة شغالة ← التأكيد بيقول العدد وإن الأرصدة هتتغيّر،
 *   و"حذف" بينادي المسح
 * - المسح اتمنع لحظة الدوسة (المحفظة اتأرشفت والتأكيد مفتوح) ← رسالة المنع
 *
 * الشاشة بس — إن الدفعة فعلاً ما اتبعتتش لفايرستور محتاج المحاكي
 * (`npm run test:db`). الدين: `cascadeDeleteDebtScreen.test.tsx`.
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const ACTIVE = { id: 'w1', name: 'الكاش', openingBalance: 0, lowAlert: 0 };
const ARCHIVED = { id: 'w_old', name: 'المحفظة القديمة', openingBalance: 0, lowAlert: 0, archived: true };

const sub = {
  id: 's1', name: 'نتفليكس', amount: 150, walletId: ACTIVE.id, frequency: 'monthly', nextDueDate: '2099-01-01',
  reminderDaysBefore: 1, history: [
    { id: 'h1', date: '2026-07-01', amount: 150, transactionId: 't1' },
    { id: 'h2', date: '2026-08-01', amount: 150, transactionId: 't2' },
  ],
};
const gam = {
  id: 'g1', name: 'جمعية الشغل', monthlyAmount: 1000, totalMonths: 3, payoutMonthIndex: 3, payoutAmount: 3000,
  walletId: ACTIVE.id, startDate: '2026-07-01', reminderDaysBefore: 1, createdAt: '2026-07-01',
  months: [
    { id: 'm1', monthIndex: 1, dueDate: '2026-07-01', amount: 1000, status: 'done', isPayoutMonth: false, transactionId: 't1' },
    { id: 'm2', monthIndex: 2, dueDate: '2026-08-01', amount: 1000, status: 'done', isPayoutMonth: false, transactionId: 't2' },
    { id: 'm3', monthIndex: 3, dueDate: '2099-09-01', amount: 3000, status: 'pending', isPayoutMonth: true },
  ],
};
const txOn = (walletId: string) => [
  { id: 't1', type: 'expense', amount: 150, walletId, date: '2026-07-01' },
  { id: 't2', type: 'expense', amount: 150, walletId, date: '2026-08-01' },
];

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [ACTIVE, ARCHIVED], categories: [], loadErrors: [], figuresPending: [],
    subscriptions: [sub], gamiyas: [gam],
    deleteSubscription: jest.fn(async () => ({ outcome: 'done' })),
    deleteGamiya: jest.fn(async () => ({ outcome: 'done' })),
    markSubscriptionPaid: jest.fn(), markGamiyaMonthDone: jest.fn(),
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

const SCREENS = [
  { kind: 'الاشتراك', Screen: SubscriptionsView, expand: null, button: 'حذف', del: 'deleteSubscription', id: 's1', name: 'نتفليكس' },
  // زرار حذف الجمعية جوه الكارت المفتوح — بندوس على الاسم الأول
  { kind: 'الجمعية', Screen: GamiyaView, expand: 'جمعية الشغل', button: 'حذف الجمعية', del: 'deleteGamiya', id: 'g1', name: 'جمعية الشغل' },
] as const;

let current: (typeof SCREENS)[number];
async function pressDelete(Screen: React.ComponentType, button: string) {
  await render(<ThemeProvider><NoticeProvider><PrivacyProvider><Screen /></PrivacyProvider></NoticeProvider></ThemeProvider>);
  if (current.expand) await act(async () => { fireEvent.press(screen.getByText(current.expand!)); });
  await act(async () => { fireEvent.press(screen.getByText(button)); });
}

/** بيدوس زرار "حذف" جوه الـAlert اللي اتفتح */
async function confirmAlert() {
  const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => unknown }[];
  const destructive = buttons.find(b => b.text === 'حذف');
  await act(async () => { await destructive?.onPress?.(); });
}

describe.each(SCREENS)('$kind — زرار الحذف', (cfg) => {
  const { Screen, button, del, id, name } = cfg;
  beforeEach(() => { current = cfg; });
  it('عملية على محفظة مؤرشفة ← رسالة المنع، ومفيش تأكيد ولا مسح', async () => {
    mockData.transactions = txOn(ARCHIVED.id);
    await pressDelete(Screen, button);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockData[del]).not.toHaveBeenCalled();
    expect(screen.getByTestId('notice_title').props.children).toBe('المحفظة دي مؤرشفة');
    expect(screen.getByTestId('notice_body').props.children).toContain(`"${ARCHIVED.name}"`);
  });

  it('محفظة شغالة ← التأكيد بيقول العدد وإن الأرصدة هتتغيّر، و"حذف" بيمسح', async () => {
    mockData.transactions = txOn(ACTIVE.id);
    await pressDelete(Screen, button);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [, body] = alertSpy.mock.calls[0];
    expect(body).toContain(`"${name}"`);
    expect(body).toContain('عمليتين');
    expect(body).toContain('هيغيّر أرصدة المحافظ');
    await confirmAlert();
    expect(mockData[del]).toHaveBeenCalledWith(id);
    expect(screen.queryByTestId('notice_dialog')).toBeNull();
  });

  it('بيانات العمليات ما وصلتش ← ممنوع، ومفيش تأكيد', async () => {
    mockData.transactions = [];
    mockData.loadErrors = ['transactions'];
    await pressDelete(Screen, button);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockData[del]).not.toHaveBeenCalled();
    expect(screen.getByTestId('notice_title').props.children).toBe('استنى البيانات توصل');
  });

  it('المحافظ لسه بتوصل (أول ثواني بعد الفتح) ← ممنوع، ومفيش تأكيد', async () => {
    mockData.transactions = txOn(ACTIVE.id);
    mockData.figuresPending = ['wallets'];
    await pressDelete(Screen, button);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockData[del]).not.toHaveBeenCalled();
    expect(screen.getByTestId('notice_body').props.children).toContain('لسه بتوصل');
  });

  it('اتمنع لحظة الدوسة (اتأرشفت والتأكيد مفتوح) ← رسالة المنع بتظهر', async () => {
    mockData.transactions = txOn(ACTIVE.id);
    mockData[del] = jest.fn(async () => ({
      outcome: 'blocked', reason: 'wallet-archived', title: 'المحفظة دي مؤرشفة', body: 'اتأرشفت من جهاز تاني',
    }));
    await pressDelete(Screen, button);
    await confirmAlert();
    expect(mockData[del]).toHaveBeenCalledWith(id);
    expect(screen.getByTestId('notice_title').props.children).toBe('المحفظة دي مؤرشفة');
    expect(screen.getByTestId('notice_body').props.children).toBe('اتأرشفت من جهاز تاني');
  });
});
