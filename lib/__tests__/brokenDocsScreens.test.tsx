import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { BrokenTransactionsSection } from '@/components/BrokenTransactions';
import { FIX_SAVE_FAILED_TITLE } from '@/lib/brokenDocs';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/** بند B — قرار مؤمن 2026-11-06: قسم «بيانات ناقصة» في الأرشيف وورقة التصليح */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }));

const updateTransaction = jest.fn();
const deleteTransaction = jest.fn();
const retryLoad = jest.fn();
function seed(broken: object[], extra: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  updateTransaction.mockReset(); deleteTransaction.mockReset();
  deleteTransaction.mockImplementation(async () => ({ outcome: 'done' }));
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }, { id: 'old', name: 'قديمة', openingBalance: 0, lowAlert: 0, archived: true }],
    categories: [], debts: [], subscriptions: [], gamiyas: [], incomes: [],
    brokenTransactions: broken, updateTransaction, deleteTransaction, transactionLinkWarning: () => null, linkSourcesReady: true, loadErrors: [], retryLoad,
    ...extra,
  });
}
const ui = () => (
  <ThemeProvider><PrivacyProvider><NoticeProvider><ConfirmProvider><BrokenTransactionsSection /></ConfirmProvider></NoticeProvider></PrivacyProvider></ThemeProvider>
);

it('مفيش بايظة ← القسم مش موجود', async () => {
  seed([]);
  await render(ui());
  expect(screen.queryByTestId('archive_broken_section')).toBeNull();
});

it('بايظة المبلغ ← ظاهرة بالعلامة والسبب، والتصليح بيكتب المبلغ والتاريخ', async () => {
  seed([{ id: 'b1', reasons: ['amount'], type: 'expense', walletId: 'w1', date: '2026-09-01', note: 'عشا' }]);
  await render(ui());
  expect(screen.getByText('⚠️ بيانات ناقصة — مش محسوبة في أي رقم')).toBeTruthy();
  expect(screen.getByText(/المبلغ مش مقروء/)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('archive_broken_b1')); });
  await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_save')); });
  expect(screen.getByTestId('broken_fix_error').props.children).toBeTruthy();
  expect(updateTransaction).not.toHaveBeenCalled();
  await act(async () => { fireEvent.changeText(screen.getByTestId('broken_fix_amount'), '75.5'); });
  await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_save')); });
  expect(updateTransaction).toHaveBeenCalledWith('b1', { amount: 75.5, date: '2026-09-01' });
});

it('على محفظة مؤرشفة ← مفيش تصليح (من غير تسوية كان هيحرّك رصيدها)، المسح بس', async () => {
  seed([{ id: 'b2', reasons: ['date'], type: 'expense', amount: 40, walletId: 'old' }]);
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('archive_broken_b2')); });
  expect(screen.getByTestId('broken_fix_blocked')).toBeTruthy();
  expect(screen.queryByTestId('broken_fix_save')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_delete')); });
  expect(screen.getByTestId('confirm_body').props.children).toBe('العملية دي مش محسوبة في أي رقم، فمسحها مش هيغيّر أي رصيد.');
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(deleteTransaction).toHaveBeenCalledWith('b2');
});

it('مربوطة بدين ← مفيش تصليح، وتأكيد المسح بيقول هيحصل إيه للدين', async () => {
  seed([{ id: 'b3', reasons: ['amount'], type: 'expense', walletId: 'w1', date: '2026-09-01' }], {
    debts: [{ id: 'd', personName: 'س', totalAmount: 100, direction: 'i_owe', date: '2026-09-01', payments: [{ id: 'p', amount: 10, walletId: 'w1', date: '2026-09-01', transactionId: 'b3' }], increases: [] }],
    transactionLinkWarning: () => 'تحذير الدين',
  });
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('archive_broken_b3')); });
  expect(screen.queryByTestId('broken_fix_save')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_delete')); });
  expect(screen.getByTestId('confirm_body').props.children).toBe('تحذير الدين');
});

it('الجولة 2 (بند 1): مسح عملية دين بايظة ما اتمسحتش (مفيش نت) ← الورقة مفتوحة والرسالة بتقول، مش «اتمسحت»', async () => {
  const { TX_DELETE_OUTCOME_ALERT } = jest.requireActual('@/context/DataContext');
  seed([{ id: 'b3', reasons: ['amount'], type: 'expense', walletId: 'w1', date: '2026-09-01' }], {
    debts: [{ id: 'd', personName: 'س', totalAmount: 100, direction: 'i_owe', date: '2026-09-01', payments: [{ id: 'p', amount: 10, walletId: 'w1', date: '2026-09-01', transactionId: 'b3' }], increases: [] }],
    transactionLinkWarning: () => 'تحذير الدين',
  });
  deleteTransaction.mockImplementation(async () => ({ outcome: 'no-connection' }));
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('archive_broken_b3')); });
  await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_delete')); });
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  await act(async () => {});
  expect(deleteTransaction).toHaveBeenCalledWith('b3');
  expect(screen.getByText(TX_DELETE_OUTCOME_ALERT['no-connection'].title)).toBeTruthy();
  // الورقة لسه مفتوحة، وزرار المسح رجع يشتغل
  expect(screen.getByTestId('broken_fix_delete')).toBeTruthy();
  deleteTransaction.mockImplementation(async () => ({ outcome: 'done' }));
  await act(async () => { fireEvent.press(screen.getByTestId('notice_ok')); });
  await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_delete')); });
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  await act(async () => {});
  expect(deleteTransaction).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('broken_fix_delete')).toBeNull();
});

it('التاريخ ناقص ← الخانة فاضية والحفظ بيطلب تاريخ (مش النهارده ساكت)', async () => {
  seed([{ id: 'b4', reasons: ['date'], type: 'expense', amount: 40, walletId: 'w1' }]);
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('archive_broken_b4')); });
  await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_save')); });
  expect(screen.getByTestId('broken_fix_error').props.children).toBe('اختار تاريخ العملية.');
  expect(updateTransaction).not.toHaveBeenCalled();
});

it('الديون لسه ما وصلتش ← لا حفظ ولا مسح (دفعة دين كانت هتبان مش مربوطة)', async () => {
  seed([{ id: 'b5', reasons: ['amount'], type: 'expense', walletId: 'w1', date: '2026-09-01' }], { linkSourcesReady: false });
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('archive_broken_b5')); });
  expect(screen.getByTestId('broken_fix_waiting')).toBeTruthy();
  expect(screen.queryByTestId('broken_fix_save')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_delete')); });
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
  expect(deleteTransaction).not.toHaveBeenCalled();
});

it('اسم الصف لقارئ الشاشة فيه المبلغ والتاريخ', async () => {
  jest.useFakeTimers({ now: new Date(2026, 10, 13, 12, 0), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'hrtime', 'performance'] });
  seed([{ id: 'b6', reasons: ['type'], amount: 40, walletId: 'w1', date: '2026-09-01' }]);
  await render(ui());
  const label = screen.getByTestId('archive_broken_b6').props.accessibilityLabel as string;
  expect(label).toContain('1 سبتمبر');
  expect(label).not.toContain('2026-09-01');
  expect(label).toContain('40');
});

afterEach(() => jest.useRealTimers());

it('الديون ما وصلتش لأن الـlistener وقع ← رسالة + "جرّب تاني" (مش "استنى" للأبد)', async () => {
  seed([{ id: 'b7', reasons: ['amount'], type: 'expense', walletId: 'w1', date: '2026-09-01' }], { linkSourcesReady: false, loadErrors: ['debts'] });
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('archive_broken_b7')); });
  expect(screen.getByTestId('broken_fix_load_failed')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_retry')); });
  expect(retryLoad).toHaveBeenCalled();
});

describe('الميزة 8 (مراجعة التطبيق كله)', () => {
  it('L: الحفظ رمى ← الورقة مفتوحة ورسالة، مش «العملية اتحفظت»', async () => {
    const { AccessibilityInfo } = require('react-native');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    announce.mockClear();
    seed([{ id: 'b1', reasons: ['amount'], type: 'expense', walletId: 'w1', date: '2026-09-01' }]);
    updateTransaction.mockImplementation(async () => { throw new Error('stage'); });
    await render(ui());
    await act(async () => { fireEvent.press(screen.getByTestId('archive_broken_b1')); });
    await act(async () => { fireEvent.changeText(screen.getByTestId('broken_fix_amount'), '75'); });
    await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_save')); });
    expect(screen.getByTestId('broken_fix_save')).toBeTruthy();
    expect(screen.getByTestId('broken_fix_error').props.children).toBe('التعديل ما اتحفظش والعملية زي ما كانت، جرب تاني');
    expect(announce).not.toHaveBeenCalledWith('العملية اتحفظت');
    announce.mockRestore();
  });

  it('صف من غير أي تفاصيل ← «عملية من غير تفاصيل» مش «—»', async () => {
    seed([{ id: 'b9', reasons: ['type'] }]);
    await render(ui());
    expect(screen.getByText('عملية من غير تفاصيل')).toBeTruthy();
  });
});

describe('الجولة 2 (الأخيرة) على f0badf9 — ورقة «صلّح العملية»', () => {
  const { AccessibilityInfo } = require('react-native');
  let announce: jest.SpyInstance;
  beforeEach(async () => {
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    // إعلانات متأخرة (`announceAfterLeave`) من اختبارات قبل كده تخلص الأول
    await new Promise(r => setTimeout(r, 800));
    announce.mockClear();
  });
  afterEach(() => announce.mockRestore());
  const openSheet = async (id = 'b1') => {
    seed([{ id, reasons: ['amount'], type: 'expense', walletId: 'w1', date: '2026-09-01' }]);
    await render(ui());
    await act(async () => { fireEvent.press(screen.getByTestId(`archive_broken_${id}`)); });
  };

  it('L7: الورقة اتقفلت قبل ما الحفظ يخلص والحفظ فشل ← رسالة التطبيق (مش ساكت)', async () => {
    let fail!: (e: Error) => void;
    await openSheet();
    updateTransaction.mockImplementation(() => new Promise((_, rej) => { fail = rej; }));
    await act(async () => { fireEvent.changeText(screen.getByTestId('broken_fix_amount'), '75'); });
    await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_save')); });
    await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_cancel')); });
    expect(screen.queryByTestId('broken_fix_save')).toBeNull();
    await act(async () => { fail(new Error('stage')); });
    expect(screen.getByTestId('notice_title').props.children).toBe(FIX_SAVE_FAILED_TITLE);
  });

  it('L7: الورقة اتقفلت قبل ما الحفظ ينجح ← مفيش «اتحفظت» على ورقة مش موجودة', async () => {
    let ok!: () => void;
    await openSheet();
    updateTransaction.mockImplementation(() => new Promise<void>(r => { ok = r; }));
    await act(async () => { fireEvent.changeText(screen.getByTestId('broken_fix_amount'), '75'); });
    await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_save')); });
    await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_cancel')); });
    await act(async () => { ok(); });
    await act(async () => { await new Promise(r => setTimeout(r, 1000)); });
    expect(announce).not.toHaveBeenCalledWith('العملية اتحفظت');
  });

  it('L8: «اتحفظت» بتتقال بعد ما الورقة تتقفل بشوية', async () => {
    await openSheet();
    updateTransaction.mockImplementation(async () => {});
    await act(async () => { fireEvent.changeText(screen.getByTestId('broken_fix_amount'), '75'); });
    await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_save')); });
    expect(announce).not.toHaveBeenCalledWith('العملية اتحفظت');
    await act(async () => { await new Promise(r => setTimeout(r, 1000)); });
    expect(announce).toHaveBeenCalledWith('العملية اتحفظت');
  });

  it('M3: سطر الخطأ متركّب دايمًا، ونفس الخطأ مرتين اسمه بيتغيّر (منطقة أندرويد الحية تتقري تاني)', async () => {
    await openSheet();
    const line = () => screen.getByTestId('broken_fix_error');
    expect(line().props.children).toBe('');
    expect(line().props.accessibilityLiveRegion).toBe('polite');
    await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_save')); });
    const first = line().props.accessibilityLabel;
    await act(async () => { fireEvent.press(screen.getByTestId('broken_fix_save')); });
    expect(line().props.accessibilityLabel).not.toBe(first);
    expect(line().props.children).toBeTruthy();
  });
});
