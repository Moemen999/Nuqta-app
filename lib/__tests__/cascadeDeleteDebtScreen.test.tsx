import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import DebtsTabScreen from '@/app/(tabs)/debts';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * زرار "حذف" على كارت الدين — نفس اختبارات الاشتراك والجمعية
 * (`cascadeDeleteScreens.test.tsx`): محفظة مؤرشفة ← منع قبل التأكيد، ومحفظة
 * شغالة ← التأكيد بيقول العدد وإن الأرصدة هتتغيّر.
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/components/useDeviceContacts', () => ({ useDeviceContacts: () => ({}) }));

const ACTIVE = { id: 'w1', name: 'الكاش', openingBalance: 0, lowAlert: 0 };
const ARCHIVED = { id: 'w_old', name: 'المحفظة القديمة', openingBalance: 0, lowAlert: 0, archived: true };

// قرض 1000 خرج من المحفظة، ورجع منه 400 على نفس المحفظة — الفرق 600
const debt = {
  id: 'd1', personName: 'أحمد', direction: 'owed_to_me', totalAmount: 1000, isInstallment: false,
  date: '2026-07-01', createdAt: '2026-07-01', initialTransactionId: 't_lend',
  payments: [{ id: 'p1', date: '2026-08-01', amount: 400, walletId: 'X', transactionId: 't_pay' }],
  increases: [],
};
const txOn = (walletId: string) => [
  { id: 't_lend', type: 'expense', amount: 1000, walletId, date: '2026-07-01' },
  { id: 't_pay', type: 'income', amount: 400, walletId, date: '2026-08-01' },
];

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    debts: [debt], wallets: [ACTIVE, ARCHIVED], categories: [], loadErrors: [], figuresPending: [],
    subscriptions: [], gamiyas: [],
    deleteDebt: jest.fn(async () => ({ outcome: 'done' })),
    deleteDebtPayment: jest.fn(), deleteDebtIncrease: jest.fn(),
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

async function pressDelete() {
  await render(<ThemeProvider><NoticeProvider><PrivacyProvider><DebtsTabScreen /></PrivacyProvider></NoticeProvider></ThemeProvider>);
  // زرار الحذف جوه الكارت المفتوح — بندوس على الاسم الأول
  await act(async () => { fireEvent.press(screen.getByText('أحمد')); });
  await act(async () => { fireEvent.press(screen.getByText('حذف')); });
}

it('عمليات الدين على محفظة مؤرشفة ← رسالة المنع، ومفيش تأكيد ولا مسح', async () => {
  mockData.transactions = txOn(ARCHIVED.id);
  await pressDelete();
  expect(alertSpy).not.toHaveBeenCalled();
  expect(mockData.deleteDebt).not.toHaveBeenCalled();
  expect(screen.getByTestId('notice_title').props.children).toBe('المحفظة دي مؤرشفة');
  expect(screen.getByTestId('notice_body').props.children).toContain('دين "أحمد"');
});

it('محفظة شغالة ← التأكيد بيقول العدد وإن الأرصدة هتتغيّر، و"حذف" بيمسح', async () => {
  mockData.transactions = txOn(ACTIVE.id);
  await pressDelete();
  expect(alertSpy).toHaveBeenCalledTimes(1);
  const [title, body, buttons] = alertSpy.mock.calls[0];
  expect(title).toBe('مسح الدين');
  expect(body).toBe('متأكد إنك عايز تمسح دين "أحمد"؟ (هيتمسح معاه عمليتين كمان، وده هيغيّر أرصدة المحافظ المرتبطة)');
  const destructive = (buttons as { text: string; onPress?: () => unknown }[]).find(b => b.text === 'حذف');
  await act(async () => { await destructive?.onPress?.(); });
  expect(mockData.deleteDebt).toHaveBeenCalledWith('d1');
});

it('اتمنع لحظة الدوسة ← رسالة المنع بتظهر', async () => {
  mockData.transactions = txOn(ACTIVE.id);
  mockData.deleteDebt = jest.fn(async () => ({
    outcome: 'blocked', reason: 'wallet-archived', title: 'المحفظة دي مؤرشفة', body: 'اتأرشفت من جهاز تاني',
  }));
  await pressDelete();
  const destructive = (alertSpy.mock.calls[0][2] as { text: string; onPress?: () => unknown }[]).find(b => b.text === 'حذف');
  await act(async () => { await destructive?.onPress?.(); });
  expect(screen.getByTestId('notice_body').props.children).toBe('اتأرشفت من جهاز تاني');
});
