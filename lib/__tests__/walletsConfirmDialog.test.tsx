import WalletsScreen from '@/app/settings-screens/wallets';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { ThemeProvider } from '@/context/ThemeContext';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

/**
 * نقل التأكيدات — الدفعة 2 (المحافظ والفئات) عن طريق المكوّن نفسه، مش الـAlert الاحتياطي:
 * تأكيد المسح بشكل التطبيق، ورسالة المنع (زرار واحد) بقت notice.
 */

const cash = { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 };
const bank = { id: 'w2', name: 'البنك', openingBalance: 0, lowAlert: 0 };

const mockData: any = {};
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

function seed(wallets: object[]) {
  Object.assign(mockData, {
    wallets, categories: [], transactions: [], brokenTransactions: [], budgets: {}, debts: [],
    subscriptions: [], gamiyas: [], incomes: [], serverReachable: true, loadErrors: [],
    updateWallet: jest.fn(), addWallet: jest.fn(), deleteWallet: jest.fn(async () => ({ outcome: 'done' })),
    archiveWallet: jest.fn(async () => ({ outcome: 'done' })), restoreWallet: jest.fn(),
  });
}
const ui = () => <ThemeProvider><NoticeProvider><ConfirmProvider><WalletsScreen /></ConfirmProvider></NoticeProvider></ThemeProvider>;

it('مسح محفظة من غير تاريخ ← تأكيد التطبيق، و"حذف" بيمسح', async () => {
  seed([cash, bank]);
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('wallet_delete_w1')); });
  expect(screen.getByTestId('confirm_title').props.children).toBe('حذف محفظة');
  expect(mockData.deleteWallet).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(mockData.deleteWallet).toHaveBeenCalledWith('w1');
});

it('"إلغاء" مبيمسحش', async () => {
  seed([cash, bank]);
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('wallet_delete_w1')); });
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_cancel')); });
  expect(mockData.deleteWallet).not.toHaveBeenCalled();
});

it('آخر محفظة شغالة ← رسالة المنع بزرار "تمام" (notice) مش تأكيد', async () => {
  seed([cash]);
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('wallet_delete_w1')); });
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
  expect(screen.getByTestId('notice_title').props.children).toBe('دي آخر محفظة شغالة');
  expect(mockData.deleteWallet).not.toHaveBeenCalled();
});

describe('سلاسل التأكيد بالمكوّن نفسه (silent-failure-hunter، دفعة 2)', () => {
  const withHistory = () => {
    seed([cash, bank]);
    mockData.transactions = [{ id: 't1', type: 'expense', amount: 0, walletId: 'w1', date: '2026-01-01' }];
  };

  it('"ليها تاريخ" ← "امسحها برضه" ← بيفتح "مسح نهائي"، ومفيش مسح لحد التأكيد التاني', async () => {
    withHistory();
    await render(ui());
    await act(async () => { fireEvent.press(screen.getByTestId('wallet_delete_w1')); });
    expect(screen.getByTestId('confirm_title').props.children).toBe('المحفظة دي ليها تاريخ');
    await act(async () => { fireEvent.press(screen.getByText('امسحها برضه')); });
    expect(screen.getByTestId('confirm_title').props.children).toBe('مسح نهائي');
    expect(mockData.deleteWallet).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByText('امسحها نهائي')); });
    expect(mockData.deleteWallet).toHaveBeenCalledWith('w1');
  });

  it('"ليها تاريخ" ← "أرشفها" ← تأكيد الأرشفة ← archiveWallet بيتنادى فعلاً', async () => {
    withHistory();
    await render(ui());
    await act(async () => { fireEvent.press(screen.getByTestId('wallet_delete_w1')); });
    await act(async () => { fireEvent.press(screen.getByText('أرشفها')); });
    // من غير حاجات شغالة تتنقل (مفيش شيت): الأرشفة بتسأل تأكيدها هي، والتأكيد الأول اتقفل
    expect(screen.getByTestId('confirm_title').props.children).toBe('أرشفة محفظة');
    expect(mockData.archiveWallet).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(mockData.archiveWallet).toHaveBeenCalledWith('w1', expect.anything());
  });
});

it('بند B: محفظة عليها عملية بايظة ← ليها تاريخ (مش حذف عادي)، والأرشفة ممنوعة برسالة', async () => {
  seed([cash, bank]);
  mockData.brokenTransactions = [{ id: 'b1', reasons: ['amount'], type: 'expense', walletId: 'w1' }];
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('wallet_delete_w1')); });
  expect(screen.getByTestId('confirm_title').props.children).toBe('المحفظة دي ليها تاريخ');
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(screen.getByTestId('notice_title').props.children).toBe('ما اتأرشفتش');
  expect(mockData.archiveWallet).not.toHaveBeenCalled();
});

describe('الرصيد الابتدائي بيسأل قبل ما يتغيّر (الاختبار العنيف 2026-11-07، قرار مؤمن)', () => {
  const type = async (v: string) => {
    await act(async () => { fireEvent.changeText(screen.getByTestId('wallet_opening_input_w1'), v); });
  };
  it('مبيتحفظش لوحده بعد ثانية، والتأكيد بالرقمين، و«أيوه» بتكتب', async () => {
    seed([{ ...cash, openingBalance: 5000 }, bank]);
    await render(ui());
    await type('15000');
    await act(async () => { await new Promise(r => setTimeout(r, 1300)); });
    expect(mockData.updateWallet).not.toHaveBeenCalled();
    await act(async () => { fireEvent(screen.getByTestId('wallet_opening_input_w1'), 'blur'); });
    expect(screen.getByTestId('confirm_title').props.children).toBe('تغيّر الرصيد الابتدائي؟');
    expect(screen.getByTestId('confirm_body').props.children).toContain('من 5,000 لـ15,000');
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(mockData.updateWallet).toHaveBeenCalledWith('w1', { openingBalance: 15000 });
  });
  it('«سيبه زي ما هو» ← مفيش كتابة', async () => {
    seed([{ ...cash, openingBalance: 5000 }, bank]);
    await render(ui());
    await type('15000');
    await act(async () => { fireEvent(screen.getByTestId('wallet_opening_input_w1'), 'blur'); });
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_cancel')); });
    expect(mockData.updateWallet).not.toHaveBeenCalled();
  });
  it('حد التنبيه لسه بيتحفظ لوحده (مبيغيّرش رصيد)', async () => {
    seed([cash, bank]);
    await render(ui());
    await act(async () => { fireEvent.changeText(screen.getByTestId('wallet_alert_input_w1'), '300'); });
    await act(async () => { await new Promise(r => setTimeout(r, 1300)); });
    expect(mockData.updateWallet).toHaveBeenCalledWith('w1', { lowAlert: 300 });
  });
});

describe('الرصيد الابتدائي — تصليحات المراجعين (2026-11-07)', () => {
  const type = async (v: string) => {
    await act(async () => { fireEvent.changeText(screen.getByTestId('wallet_opening_input_w1'), v); });
  };
  it('سطر «لسه ما اتحفظش» طول ما الرقم مستني تأكيد', async () => {
    seed([{ ...cash, openingBalance: 5000 }, bank]);
    await render(ui());
    expect(screen.queryByTestId('wallet_opening_pending_w1')).toBeNull();
    await type('6000');
    expect(screen.getByTestId('wallet_opening_pending_w1')).toBeTruthy();
  });
  it('خرجت من الشاشة والرقم مستني ← رسالة «ما اتغيّرش» ومفيش كتابة', async () => {
    seed([{ ...cash, openingBalance: 5000 }, bank]);
    const r = await render(ui());
    await type('6000');
    await act(async () => { r.unmount(); });
    expect(mockData.updateWallet).not.toHaveBeenCalled();
  });
  it('الرقم اتغيّر من جهاز تاني والتأكيد مفتوح ← «أيوه» مبتكتبش', async () => {
    seed([{ ...cash, openingBalance: 5000 }, bank]);
    const r = await render(ui());
    await type('6000');
    await act(async () => { fireEvent(screen.getByTestId('wallet_opening_input_w1'), 'blur'); });
    mockData.wallets = [{ ...cash, openingBalance: 7000 }, bank];
    await r.rerender(ui());
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(mockData.updateWallet).not.toHaveBeenCalled();
    // ومش ساكت: رسالة
    expect(screen.getByTestId('notice_title').props.children).toBe('ما اتحفظش');
    expect(screen.getByTestId('wallet_opening_pending_w1')).toBeTruthy();
  });
});

it('planWalletOpeningCommit: متقرّب لقرشين، ونفس الرقم بعد التقريب مبيسألش', () => {
  const { planWalletOpeningCommit } = require('@/lib/finance');
  expect(planWalletOpeningCommit('15000.456', 5000)).toEqual({ action: 'confirm', value: 15000.46 });
  expect(planWalletOpeningCommit('5000.001', 5000)).toEqual({ action: 'none' });
  expect(planWalletOpeningCommit('100', NaN)).toEqual({ action: 'confirm', value: 100 });
});
