import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AddTransactionModal from '@/app/modal';
import IncomesView from '@/components/IncomesView';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { warmUp } from '@/test-utils/warmUp';

/**
 * الضغطتين في نفس الفريم على "حفظ" (2026-11-16، موافقة مؤمن «حط حماية»):
 * الحارس كان `useState` بس في `app/modal.tsx` (بيتحدّث بعد الـre-render)، ومفيش حارس خالص في
 * `IncomeSetupModal` — فدوسة تانية قبل الـre-render كانت بتكتب عملية/دخل مكرر. دلوقتي `useBusy`
 * (ref متزامن). `fireEvent.press` مرتين جوه `act` واحدة = نفس الـtick من غير re-render بينهم.
 */

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const wallet = { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 };
const wrap = (node: React.ReactNode) => <ThemeProvider><NoticeProvider><ConfirmProvider><PrivacyProvider>{node}</PrivacyProvider></ConfirmProvider></NoticeProvider></ThemeProvider>;
const press = (el: Parameters<typeof fireEvent.press>[0]) => act(async () => { fireEvent.press(el); });
const type = (el: Parameters<typeof fireEvent.changeText>[0], v: string) => act(async () => { fireEvent.changeText(el, v); });
/** دوسة تانية في نفس الـtick: act متزامنة، مفيش re-render بين الاتنين */
const doublePress = (el: Parameters<typeof fireEvent.press>[0]) => act(async () => { fireEvent.press(el); fireEvent.press(el); });

function seed() {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [wallet], categories: [], transactions: [], debts: [], subscriptions: [], gamiyas: [], incomes: [],
    linkSourcesReady: true, loadErrors: [], figuresPending: [], retryLoad: jest.fn(), transactionLinkWarning: () => null,
    addTransaction: jest.fn(), updateTransaction: jest.fn(), deleteTransaction: jest.fn(),
    addIncome: jest.fn(), updateIncome: jest.fn(), recordIncomePeriods: jest.fn(), setIncomeStatus: jest.fn(), deleteIncome: jest.fn(),
  });
}
beforeEach(() => { mockParams = {}; seed(); });
warmUp(() => { seed(); return wrap(<AddTransactionModal />); });

describe('حفظ عملية جديدة', () => {
  it('ضغطتين في نفس الـtick ← addTransaction مرة واحدة', async () => {
    await render(wrap(<AddTransactionModal />));
    await type(screen.getByTestId('tx_amount_input'), '50');
    await doublePress(screen.getByTestId('tx_save_button'));
    await act(async () => {});
    expect(mockData.addTransaction).toHaveBeenCalledTimes(1);
  });

  it('دوسة بعد الحفظ الناجح وقبل ما الشاشة تتشال ← مفيش كتابة تانية', async () => {
    await render(wrap(<AddTransactionModal />));
    await type(screen.getByTestId('tx_amount_input'), '50');
    await press(screen.getByTestId('tx_save_button'));
    await press(screen.getByTestId('tx_save_button')); // الشاشة لسه متركّبة (router.back مجرد mock)
    expect(mockData.addTransaction).toHaveBeenCalledTimes(1);
  });

  it('تعديل: ضغطتين في نفس الـtick ← updateTransaction مرة واحدة، ودوسة بعدها كمان', async () => {
    mockData.transactions = [{ id: 'tx_f', type: 'expense', amount: 50, walletId: 'w1', date: '2026-03-20' }];
    mockParams = { id: 'tx_f' };
    await render(wrap(<AddTransactionModal />));
    await act(async () => {});
    await type(screen.getByTestId('tx_amount_input'), '60');
    await doublePress(screen.getByTestId('tx_save_button'));
    await press(screen.getByTestId('tx_save_button'));
    expect(mockData.updateTransaction).toHaveBeenCalledTimes(1);
  });

  it('validation فاشل ← الحارس بيتفك والضغطة الجاية بتشتغل', async () => {
    await render(wrap(<AddTransactionModal />));
    await press(screen.getByTestId('tx_save_button')); // من غير مبلغ
    expect(screen.getByText('من فضلك دخّل مبلغ صحيح ومحفظة')).toBeTruthy();
    expect(mockData.addTransaction).not.toHaveBeenCalled();
    await type(screen.getByTestId('tx_amount_input'), '50');
    await press(screen.getByTestId('tx_save_button'));
    expect(mockData.addTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('حفظ دخل ثابت جديد', () => {
  const next = () => press(screen.getByTestId('income_setup_next'));
  async function toLastStep() {
    await render(wrap(<IncomesView />));
    await press(screen.getByTestId('income_add_button'));
    await type(screen.getByTestId('income_name'), 'مرتب');
    await type(screen.getByTestId('income_amount'), '5000');
    await next(); await next();
  }

  it('ضغطتين في نفس الـtick على "حفظ" ← addIncome مرة واحدة', async () => {
    await toLastStep();
    await doublePress(screen.getByTestId('income_setup_next'));
    await act(async () => {});
    expect(mockData.addIncome).toHaveBeenCalledTimes(1);
  });

  it('validation فاشل ← الحارس بيتفك والضغطة الجاية بتشتغل', async () => {
    await render(wrap(<IncomesView />));
    await press(screen.getByTestId('income_add_button'));
    await next(); // اسم ومبلغ فاضيين ← رفض
    expect(mockData.addIncome).not.toHaveBeenCalled();
    await type(screen.getByTestId('income_name'), 'مرتب');
    await type(screen.getByTestId('income_amount'), '5000');
    await next(); await next();
    await press(screen.getByTestId('income_setup_next'));
    expect(mockData.addIncome).toHaveBeenCalledTimes(1);
  });

  it('addIncome بيرمي ← المودال مبيتقفلش، الرسالة بتظهر، والمحاولة الجاية بتشتغل', async () => {
    (mockData.addIncome as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await toLastStep();
    await press(screen.getByTestId('income_setup_next'));
    expect(screen.getByText('حصل خطأ، جرب تاني')).toBeTruthy();
    expect(screen.getByTestId('income_setup_next')).toBeTruthy(); // لسه مفتوح
    await press(screen.getByTestId('income_setup_next'));
    expect(mockData.addIncome).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('income_setup_next')).toBeNull(); // نجح ← اتقفل
  });
});
